// ============================================================================
// ai-chat — public HTTP boundary for the BluLadder website chat widget.
// The ONLY thing the browser talks to. It:
//   * rate-limits and validates input
//   * loads/creates a conversation scoped to the caller's session token
//   * persists messages
//   * runs the channel-independent orchestrator (shared with future voice)
//   * returns only customer-safe state (no internal IDs, no prices it invented)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runOrchestrator } from "../_shared/aiOrchestrator.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGE_LEN = 2000;
const MAX_MESSAGES_PER_CONVO = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = rateLimit(req, { limit: 20, windowMs: 60000 });
  if (!rl.allowed) return json({ error: "Too many messages, please slow down." }, 429);

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid request" }, 400);

    const sessionToken = String((body as any).sessionToken || "").slice(0, 100);
    const rawMessage = (body as any).message;
    if (!sessionToken || !/^[A-Za-z0-9_-]{8,100}$/.test(sessionToken)) {
      return json({ error: "Invalid session" }, 400);
    }
    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
      return json({ error: "Empty message" }, 400);
    }
    const message = rawMessage.slice(0, MAX_MESSAGE_LEN);

    // Explicit, opt-in-only marketing consent from the on-screen checkbox. It is
    // NEVER preselected in the UI and is recorded through the canonical consent
    // service (record_consent), not just the transcript.
    const marketingConsent = (body as any).marketingConsent === true;
    const consentLanguage = typeof (body as any).consentLanguage === "string"
      ? String((body as any).consentLanguage).slice(0, 500)
      : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let { data: convo } = await supabase
      .from("chat_conversations")
      .select("id, session_token")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (!convo) {
      const { data: created, error } = await supabase
        .from("chat_conversations")
        .insert({ session_token: sessionToken, channel: "web", campaign_status: "chat_lead_created" })
        .select("id, session_token")
        .single();
      if (error || !created) return json({ error: "Could not start chat" }, 500);
      convo = created;
    }

    const { data: msgRows } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convo.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(MAX_MESSAGES_PER_CONVO);

    const history = (msgRows ?? [])
      .filter((m) => typeof m.content === "string" && m.content.length > 0)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));

    if (history.length >= MAX_MESSAGES_PER_CONVO) {
      return json({ error: "This conversation is quite long — let me connect you with the team.", conversationEnded: true }, 200);
    }

    await supabase.from("chat_messages").insert({ conversation_id: convo.id, role: "user", content: message });

    const result = await runOrchestrator({
      supabase, conversationId: convo.id, sessionToken, channel: "web", history, userMessage: message,
    });

    await supabase.from("chat_messages").insert({ conversation_id: convo.id, role: "assistant", content: result.reply });
    await supabase.from("chat_conversations").update({ last_activity_at: new Date().toISOString() }).eq("id", convo.id);

    // chat_lead_created — emitted ONCE per conversation, only after the chat has
    // captured usable contact info (email or phone). Idempotency is keyed on the
    // conversation id, so repeated messages never re-raise the lead event.
    try {
      const { data: lead } = await supabase
        .from("chat_conversations")
        .select("prospect_email, prospect_phone, services_discussed, service_area_status, booking_status")
        .eq("id", convo.id)
        .maybeSingle();
      if (lead && (lead.prospect_email || lead.prospect_phone)) {
        await emitCampaignEvent({
          eventName: "chat_lead_created",
          idempotencyKey: `chat_lead_created:${convo.id}`,
          email: lead.prospect_email ?? null,
          phone: lead.prospect_phone ?? null,
          conversationId: convo.id,
          source: "ai_chat",
          metadata: {
            lead_source: "ai_chat",
            service_types: Array.isArray(lead.services_discussed) ? lead.services_discussed : [],
            service_area_status: lead.service_area_status ?? null,
            quote_status: lead.booking_status ?? null,
          },
        });
      }
    } catch (e) {
      console.error("chat_lead_created emit failed:", e);
    }

    // Record explicit marketing consent (if the visitor ticked the box) against
    // whatever contact details the conversation has captured. Absence of the box
    // is never treated as consent.
    if (marketingConsent) {
      const { data: c } = await supabase
        .from("chat_conversations")
        .select("prospect_email, prospect_phone, marketing_consent")
        .eq("id", convo.id)
        .maybeSingle();
      await supabase.from("chat_conversations").update({ marketing_consent: true }).eq("id", convo.id);
      const lang = consentLanguage || "Send me occasional promotions and offers from BluLadder.";
      try {
        if (c?.prospect_email) {
          await supabase.rpc("record_consent", {
            p_channel: "email", p_consent_type: "marketing", p_status: "granted",
            p_email: c.prospect_email, p_language_shown: lang, p_source: "chat_checkbox",
            p_conversation_id: convo.id, p_session_id: sessionToken,
          });
        }
        if (c?.prospect_phone) {
          await supabase.rpc("record_consent", {
            p_channel: "sms", p_consent_type: "marketing", p_status: "granted",
            p_phone: c.prospect_phone, p_language_shown: lang, p_source: "chat_checkbox",
            p_conversation_id: convo.id, p_session_id: sessionToken,
          });
        }
      } catch (e) {
        console.error("marketing consent record failed:", e);
      }
    }

    return json({ reply: result.reply, events: result.events });
  } catch (e) {
    console.error("ai-chat error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
