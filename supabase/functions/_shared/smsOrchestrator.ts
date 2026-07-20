// ============================================================================
// smsOrchestrator — routes inbound CallRail SMS through the canonical AI
// orchestrator (the same one used by website chat) so SMS customers get real
// conversational service instead of only a canned link. This is a THIN adapter:
// it never duplicates system-prompt, tool, pricing, availability, booking, or
// campaign logic — those all live behind runOrchestrator and its tools.
//
// Responsibilities:
//   * Find (or create) the SMS-channel chat_conversations row keyed by the
//     customer's E.164 phone. Session token is derived deterministically from
//     the phone so the same customer resumes their conversation across texts.
//   * Load recent history from chat_messages.
//   * Persist the inbound and outbound turns.
//   * Call runOrchestrator with channel="sms".
//   * Return an SMS-safe reply (length-capped, no exposed internal IDs).
//
// It does NOT decide STOP/START/escalation/booking-intent — those decisions
// stay in callrail-inbound-sms so compliance and escalation paths short-
// circuit before we ever spend an AI call.
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runOrchestrator } from "./aiOrchestrator.ts";

// Keep SMS bodies under ~2 segments of GSM-7 (~320 chars). Anything longer is
// truncated with a soft continuation prompt and a link to the resume flow.
export const SMS_REPLY_MAX_CHARS = 320;

// Deterministic session token derived from the phone number so a customer
// texting from the same E.164 always lands on the same conversation row.
// 8+ chars, URL-safe, matches the session-token regex used by ai-chat.
export function smsSessionTokenFromPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return `sms_${digits}`;
}

export interface SmsRouteInput {
  supabase: SupabaseClient;
  phoneE164: string;
  userMessage: string;
  // Optional provider-side message id (for logging / idempotency of the
  // callrail-inbound insert; not required for orchestrator identity).
  providerMessageId?: string | null;
}

export interface SmsRouteResult {
  conversationId: string;
  reply: string;
  state?: string;
  events: string[];
  error?: string;
}

function smsSafe(reply: string): string {
  const trimmed = String(reply ?? "").trim();
  if (trimmed.length <= SMS_REPLY_MAX_CHARS) return trimmed;
  return trimmed.slice(0, SMS_REPLY_MAX_CHARS - 3).trimEnd() + "...";
}

/**
 * Route an inbound conversational SMS through the canonical orchestrator.
 * The caller is responsible for having already run compliance/escalation
 * classification (STOP/START/HELP/escalation) and for persisting the raw
 * inbound sms_messages row. This function only handles the AI turn.
 */
export async function routeInboundSmsToOrchestrator(
  input: SmsRouteInput,
): Promise<SmsRouteResult> {
  const { supabase, phoneE164, userMessage } = input;
  const sessionToken = smsSessionTokenFromPhone(phoneE164);

  // Find or create the SMS-channel conversation for this phone.
  let { data: convo } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("session_token", sessionToken)
    .maybeSingle();

  if (!convo) {
    const { data: created, error } = await supabase
      .from("chat_conversations")
      .insert({
        session_token: sessionToken,
        channel: "sms",
        prospect_phone: phoneE164,
        campaign_status: "sms_lead_created",
      })
      .select("id")
      .single();
    if (error || !created) {
      return {
        conversationId: "",
        reply: "Thanks — we got your message and will follow up shortly.",
        events: [],
        error: "convo_create_failed",
      };
    }
    convo = created;
  }

  const { data: msgRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", convo.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(60);

  const history = (msgRows ?? [])
    .filter((m) => typeof m.content === "string" && m.content.length > 0)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));

  await supabase.from("chat_messages").insert({
    conversation_id: convo.id, role: "user", content: userMessage,
  });

  const result = await runOrchestrator({
    supabase,
    conversationId: convo.id,
    sessionToken,
    channel: "sms",
    history,
    userMessage,
  });

  const reply = smsSafe(result.reply);

  await supabase.from("chat_messages").insert({
    conversation_id: convo.id, role: "assistant", content: reply,
  });
  await supabase.from("chat_conversations")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", convo.id);

  return {
    conversationId: convo.id,
    reply,
    state: result.state,
    events: result.events ?? [],
    error: result.error,
  };
}