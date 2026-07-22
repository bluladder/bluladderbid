// ============================================================================
// workflowSession.ts — reload-before-decide wrapper around quote_sessions.
//
// Every turn calls reloadSession() before the controller runs. This is the
// single defense against the "stale in-memory session" bug that caused
// repeated questions in call 019f8a84-...: even if two turns interleave, both
// see the latest persisted facts.
// ============================================================================

import { findOrCreateForConversation, type QuoteSession, type QuoteSessionChannel } from "../quoteSession.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export async function reloadSession(
  supabase: SB,
  args: { sessionId?: string | null; conversationId: string; channel: QuoteSessionChannel; phone?: string | null; email?: string | null },
): Promise<QuoteSession> {
  if (args.sessionId) {
    const { data } = await supabase.from("quote_sessions").select("*").eq("id", args.sessionId).maybeSingle();
    if (data) {
      return {
        id: data.id,
        channel: data.channel,
        conversationIds: data.conversation_ids ?? [],
        customerId: data.customer_id ?? null,
        quoteId: data.quote_id ?? null,
        fields: data.fields ?? {},
        fieldStatus: data.field_status ?? {},
        requiredRemaining: data.required_remaining ?? [],
        lastStep: data.last_step ?? null,
        quoteStatus: data.quote_status ?? "none",
        bookingReady: !!data.booking_ready,
        phoneE164: data.phone_e164 ?? null,
        emailNormalized: data.email_normalized ?? null,
      };
    }
  }
  return findOrCreateForConversation(supabase, {
    conversationId: args.conversationId,
    channel: args.channel,
    phone: args.phone,
    email: args.email,
  });
}
