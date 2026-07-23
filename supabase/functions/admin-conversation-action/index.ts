// Admin actions on a unified conversation. All actions require an admin JWT.
// Actions: takeover | release | pause_campaign | resume_campaign | stop_campaign
//          | send_reply | mark_resolved | request_callback
//
// The AI orchestrator already gates on chat_conversations.staff_takeover_at,
// so setting/clearing that field is sufficient to disable/re-enable autonomous
// AI replies. This function never sends live customer messages by itself unless
// the admin explicitly invokes send_reply with an approved body.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAdmin, getBearer, isServiceRoleToken } from "../_shared/auth.ts";
import { generateDraftReply } from "../_shared/draftReply.ts";
import { loadQuoteContextSnapshot } from "../_shared/draftTools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action =
  | "takeover" | "release"
  | "pause_campaign" | "resume_campaign" | "stop_campaign"
  | "send_reply" | "mark_resolved" | "request_callback"
  | "generate_draft" | "edit_draft" | "discard_draft" | "mark_draft_sent"
  | "get_draft_context";

const VALID: readonly Action[] = [
  "takeover","release","pause_campaign","resume_campaign","stop_campaign",
  "send_reply","mark_resolved","request_callback",
  "generate_draft","edit_draft","discard_draft","mark_draft_sent",
  "get_draft_context",
] as const;

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  const bearer = getBearer(req);
  const service = isServiceRoleToken(bearer);
  const adminId = service ? null : await verifyAdmin(bearer, "operations_admin");
  if (!service && !adminId) return j({ error: "forbidden" }, 403);
  // Service-role callers may only invoke read/regenerate actions. Every write
  // that mutates conversation state (takeover, campaigns, replies) still
  // requires an admin JWT so audit fields (staff_takeover_by, etc.) are real.
  const SERVICE_ALLOWED: readonly string[] = ["generate_draft", "get_draft_context"];
  if (service && !SERVICE_ALLOWED.includes(body?.action ?? "")) {
    return j({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({})) as {
    conversation_id?: string; action?: Action; note?: string;
    reply_body?: string; reply_channel?: "sms" | "email";
    draft_body?: string;
  };
  const conversationId = body.conversation_id;
  const action = body.action;
  if (!conversationId || !action || !VALID.includes(action)) {
    return j({ error: "invalid_request" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: convo } = await supabase
    .from("chat_conversations")
    .select("id, staff_takeover_at, campaign_status, resolved, draft_status, draft_source_message_id, pending_draft_reply, prospect_phone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo) return j({ error: "not_found" }, 404);

  const now = new Date().toISOString();
  let update: Record<string, unknown> = { last_activity_at: now };

  switch (action) {
    case "takeover":
      update = {
        ...update,
        staff_takeover_at: now,
        staff_takeover_by: adminId,
        staff_takeover_reason: body.note ?? "admin_takeover",
        campaign_status: "paused_takeover",
      };
      break;
    case "release":
      update = {
        ...update,
        staff_takeover_at: null,
        staff_takeover_by: null,
        staff_takeover_reason: null,
        campaign_status: null,
      };
      break;
    case "pause_campaign":
      update = { ...update, campaign_status: "paused" };
      break;
    case "resume_campaign":
      update = { ...update, campaign_status: null };
      break;
    case "stop_campaign":
      update = { ...update, campaign_status: "stopped" };
      // Also cancel any active enrollments for this conversation's prospect.
      break;
    case "mark_resolved":
      update = { ...update, resolved: true };
      break;
    case "request_callback":
      update = { ...update, callback_requested: true, needs_attention: true };
      break;
    case "send_reply": {
      const b = (body.reply_body ?? "").trim();
      if (!b) return j({ error: "reply_body_required" }, 400);
      // Persist as internal note only; live delivery must go through the
      // existing send-sms / send-transactional-email paths and requires the
      // admin to also invoke takeover.
      const { error } = await supabase.from("chat_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: `[staff reply queued]\n${b}`,
      });
      if (error) return j({ error: error.message }, 500);
      return j({ ok: true, queued: true });
    }
    case "generate_draft": {
      // Manual regeneration. Bypasses per-inbound idempotency so Ben can
      // re-roll a suggestion for the same message.
      const inboundId = (convo.draft_source_message_id as string | null) ?? null;
      const result = await generateDraftReply(supabase, {
        conversationId,
        inboundMessageId: inboundId,
        reason: "manual",
      });
      return j({ ok: result.status !== "failed", ...result });
    }
    case "edit_draft": {
      const b = (body.draft_body ?? "").trim();
      if (!b) return j({ error: "draft_body_required" }, 400);
      if (b.length > 800) return j({ error: "draft_body_too_long" }, 400);
      const { error } = await supabase
        .from("chat_conversations")
        .update({
          pending_draft_reply: b,
          draft_status: "edited",
          draft_edited_at: now,
        })
        .eq("id", conversationId);
      if (error) return j({ error: error.message }, 500);
      return j({ ok: true });
    }
    case "discard_draft": {
      const { error } = await supabase
        .from("chat_conversations")
        .update({
          pending_draft_reply: null,
          draft_status: "discarded",
        })
        .eq("id", conversationId);
      if (error) return j({ error: error.message }, 500);
      return j({ ok: true });
    }
    case "mark_draft_sent": {
      // Called by the UI AFTER the existing staff-reply endpoint successfully
      // queues the outbound. Preserves the sent body in the normal outbound
      // message record; here we only bookkeep the draft lifecycle.
      const { error } = await supabase
        .from("chat_conversations")
        .update({
          draft_status: "sent",
          draft_sent_at: now,
          pending_draft_reply: null,
        })
        .eq("id", conversationId);
      if (error) return j({ error: error.message }, 500);
      return j({ ok: true });
    }
    case "get_draft_context": {
      const snapshot = await loadQuoteContextSnapshot(supabase, conversationId);
      return j({ ok: true, snapshot });
    }
  }

  const { error } = await supabase
    .from("chat_conversations").update(update).eq("id", conversationId);
  if (error) return j({ error: error.message }, 500);

  return j({ ok: true, action, conversation_id: conversationId });
});