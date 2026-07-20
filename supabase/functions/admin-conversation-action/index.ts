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
import { verifyAdmin, getBearer } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action =
  | "takeover" | "release"
  | "pause_campaign" | "resume_campaign" | "stop_campaign"
  | "send_reply" | "mark_resolved" | "request_callback";

const VALID: readonly Action[] = [
  "takeover","release","pause_campaign","resume_campaign","stop_campaign",
  "send_reply","mark_resolved","request_callback",
] as const;

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  const adminId = await verifyAdmin(getBearer(req), "operations_admin");
  if (!adminId) return j({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({})) as {
    conversation_id?: string; action?: Action; note?: string;
    reply_body?: string; reply_channel?: "sms" | "email";
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
    .select("id, staff_takeover_at, campaign_status, resolved")
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
  }

  const { error } = await supabase
    .from("chat_conversations").update(update).eq("id", conversationId);
  if (error) return j({ error: error.message }, 500);

  return j({ ok: true, action, conversation_id: conversationId });
});