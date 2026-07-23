// ============================================================================
// presentation.ts — write/read helpers for `sms_availability_presentations`.
//
// This layer records the EXACT appointment options the customer was shown over
// SMS, plus the full context fingerprint required to safely interpret their
// reply later. It is intentionally minimal:
//
//   * No reservation, no slot hold, no booking side-effect.
//   * No client-facing read path — the table has no anon/authenticated grants.
//   * Idempotency: recording a new presentation atomically supersedes any
//     prior ACTIVE presentation on the same conversation so there is always
//     at most ONE valid option set to interpret against.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AvailabilitySlot } from "./availabilityLookup.ts";

export const PRESENTATION_TTL_MS = 15 * 60 * 1000; // matches slotOffer.OFFER_TTL_MS

export interface RecordPresentationInput {
  conversationId: string;
  quoteSessionId?: string | null;
  propertyId?: string | null;
  inputsKey?: string | null;
  pricingVersion?: string | null;
  quoteSignature?: string | null;
  authoritativeDurationMinutes?: number | null;
  canonicalTotalCents?: number | null;
  slots: AvailabilitySlot[];
  outboundSmsId?: string | null;
  outboundMessagePreview?: string | null;
  ttlMs?: number;
}

export interface PresentationRow {
  id: string;
  conversation_id: string;
  quote_session_id: string | null;
  property_id: string | null;
  inputs_key: string | null;
  pricing_version: string | null;
  options: Array<AvailabilitySlot & { option_number: number }>;
  status: "active" | "superseded" | "expired" | "consumed" | "cancelled";
  created_at: string;
  expires_at: string;
  outbound_sms_id: string | null;
}

/** Write a new presentation and supersede any prior active row for the same
 *  conversation. Returns the inserted row (or null on failure). */
export async function recordPresentation(
  supabase: SupabaseClient,
  input: RecordPresentationInput,
): Promise<PresentationRow | null> {
  if (!input.conversationId || !Array.isArray(input.slots) || input.slots.length === 0) {
    return null;
  }
  const ttl = input.ttlMs ?? PRESENTATION_TTL_MS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl).toISOString();

  // Assign option_number 1..N in the ORDER shown to the customer. Callers
  // must pass slots already in the display order.
  const options = input.slots.map((s, i) => ({ ...s, option_number: i + 1 }));

  // Insert first; on success, mark any previously-active presentation as
  // superseded. Doing it in this order guarantees there is never a window
  // where zero presentations are active but a customer reply is in flight.
  const { data: inserted, error } = await supabase
    .from("sms_availability_presentations")
    .insert({
      conversation_id: input.conversationId,
      quote_session_id: input.quoteSessionId ?? null,
      property_id: input.propertyId ?? null,
      inputs_key: input.inputsKey ?? null,
      pricing_version: input.pricingVersion ?? null,
      quote_signature: input.quoteSignature ?? null,
      authoritative_duration_minutes: input.authoritativeDurationMinutes ?? null,
      canonical_total_cents: input.canonicalTotalCents ?? null,
      options,
      outbound_sms_id: input.outboundSmsId ?? null,
      outbound_message_preview: input.outboundMessagePreview ?? null,
      status: "active",
      expires_at: expiresAt,
    })
    .select("*")
    .maybeSingle();

  if (error || !inserted) return null;

  await supabase
    .from("sms_availability_presentations")
    .update({ status: "superseded", superseded_by: (inserted as any).id, superseded_at: now.toISOString() })
    .eq("conversation_id", input.conversationId)
    .eq("status", "active")
    .neq("id", (inserted as any).id);

  return inserted as PresentationRow;
}

/** Return the single most-recent ACTIVE presentation for a conversation, or
 *  null if none exists / all are expired. Also returns `expired: true` when
 *  the newest active row's expires_at has passed (so the parser can respond
 *  with `expired_options`). */
export async function getActivePresentation(
  supabase: SupabaseClient,
  conversationId: string,
  now: Date = new Date(),
): Promise<{ row: PresentationRow | null; expired: boolean }> {
  if (!conversationId) return { row: null, expired: false };
  const { data } = await supabase
    .from("sms_availability_presentations")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data ?? null) as PresentationRow | null;
  if (!row) return { row: null, expired: false };
  const expired = new Date(row.expires_at).getTime() <= now.getTime();
  return { row, expired };
}