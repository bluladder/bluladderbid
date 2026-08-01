// ============================================================================
// workflowSession.ts — reload-before-decide wrapper around quote_sessions.
//
// Every turn calls reloadSession() before the controller runs. This is the
// single defense against the "stale in-memory session" bug that caused
// repeated questions in call 019f8a84-...: even if two turns interleave, both
// see the latest persisted facts.
// ============================================================================

import {
  findOrCreateForConversation,
  type QuoteSession,
  type QuoteSessionChannel,
} from "../quoteSession.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export async function reloadSession(
  supabase: SB,
  args: {
    sessionId?: string | null;
    conversationId: string;
    channel: QuoteSessionChannel;
    phone?: string | null;
    email?: string | null;
    resolvedOrganizationId?: string | null;
  },
): Promise<QuoteSession> {
  const organizationId = args.resolvedOrganizationId ?? null;
  if (args.channel === "voice" && !organizationId) {
    throw new Error("voice_organization_authority_required");
  }
  if (args.sessionId) {
    let query = supabase.from("quote_sessions").select("*").eq(
      "id",
      args.sessionId,
    );
    query = organizationId
      ? query.eq("organization_id", organizationId)
      : query.is("organization_id", null);
    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      // An explicit session capability must resolve inside the same authority
      // boundary. Falling back to a conversation would mask stale/cross-tenant
      // lineage and could create a competing quote session.
      throw new Error("quote_session_explicit_session_unavailable");
    }
    if (data) {
      return {
        id: data.id,
        organizationId: data.organization_id ?? null,
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
        updatedAt: data.updated_at ?? null,
      };
    }
  }
  return findOrCreateForConversation(supabase, {
    conversationId: args.conversationId,
    channel: args.channel,
    phone: args.phone,
    email: args.email,
    resolvedOrganizationId: organizationId,
  });
}
