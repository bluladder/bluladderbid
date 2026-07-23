// ============================================================================
// presentation.ts — lifecycle helpers for `sms_availability_presentations`.
//
// PHASE 4C LIFECYCLE
//
//   createPendingPresentation      → status = "pending_send"
//   activatePresentationAfterSend  → status = "active"; atomically supersedes
//                                    the prior active presentation.
//   markPresentationSendFailed     → status = "send_failed"; prior active
//                                    presentation (if any) STAYS active so the
//                                    customer never loses their interpretable
//                                    option set on a failed retry.
//   recordSelection                → writes parser result / selected slot to
//                                    the exact presentation the customer
//                                    replied to.
//
// HARD RULES
//   * No reservation, no slot hold, no booking side-effect.
//   * No client-facing read path — the table has no anon/authenticated grants.
//   * Idempotency: keyed on (conversation_id, idempotency_key). A duplicate
//     call returns the existing row instead of creating a second option set.
//   * Options are persisted BEFORE the SMS is sent, and are never mutated
//     afterwards. The formatter builds the customer-visible message from the
//     persisted `options` array, so the model cannot reorder, add, or omit.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AvailabilitySlot } from "./availabilityLookup.ts";

export const PRESENTATION_TTL_MS = 15 * 60 * 1000; // matches slotOffer.OFFER_TTL_MS

export type PresentationStatus =
  | "pending_send"
  | "active"
  | "superseded"
  | "expired"
  | "consumed"
  | "cancelled"
  | "send_failed";

export interface CreatePendingPresentationInput {
  conversationId: string;
  idempotencyKey: string;
  quoteSessionId?: string | null;
  propertyId?: string | null;
  inputsKey?: string | null;
  pricingVersion?: string | null;
  quoteSignature?: string | null;
  authoritativeDurationMinutes?: number | null;
  canonicalTotalCents?: number | null;
  slots: AvailabilitySlot[];
  outboundMessagePreview?: string | null;
  ttlMs?: number;
  /** Canonical backend identity anchored at presentation time. Persisted so
   *  the selection handler can prove deterministic equality of "same
   *  customer" without hashing anything on this backend-only table. */
  resolvedCustomerId?: string | null;
  identityResolutionMethod?: string | null;
}

export interface PresentationRow {
  id: string;
  conversation_id: string;
  quote_session_id: string | null;
  property_id: string | null;
  inputs_key: string | null;
  pricing_version: string | null;
  quote_signature: string | null;
  options: Array<AvailabilitySlot & { option_number: number }>;
  status: PresentationStatus;
  created_at: string;
  expires_at: string;
  activated_at: string | null;
  outbound_sms_id: string | null;
  outbound_message_preview: string | null;
  idempotency_key: string | null;
  selection_inbound_sms_id: string | null;
  selection_status: string | null;
  selection_option_number: number | null;
  selected_slot_id: string | null;
  selected_start_at: string | null;
  selected_end_at: string | null;
  selection_ack_sms_id: string | null;
  selection_invalidation_reason: string | null;
  resolved_customer_id: string | null;
  identity_resolution_method: string | null;
  hold_status:
    | "none"
    | "held"
    | "released"
    | "expired"
    | "revalidation_failed"
    | "conflict"
    | "superseded";
  hold_group_id: string | null;
  held_crew_ids: string[] | null;
  held_start_at: string | null;
  held_end_at: string | null;
  hold_expires_at: string | null;
  held_at: string | null;
  hold_released_at: string | null;
  hold_release_reason: string | null;
  hold_idempotency_key: string | null;
}

/** Result of a create attempt. `reused=true` means we returned an existing
 *  row with the same idempotency key and did NOT insert a new one. */
export interface CreatePendingResult {
  row: PresentationRow | null;
  reused: boolean;
  error?: string;
}

/** Insert a `pending_send` presentation. Idempotent on
 *  (conversation_id, idempotency_key): a duplicate call returns the existing
 *  row without inserting again. Does NOT supersede any prior active row —
 *  supersession happens on activation, after the SMS actually sends. */
export async function createPendingPresentation(
  supabase: SupabaseClient,
  input: CreatePendingPresentationInput,
): Promise<CreatePendingResult> {
  if (
    !input.conversationId ||
    !input.idempotencyKey ||
    !Array.isArray(input.slots) ||
    input.slots.length === 0
  ) {
    return { row: null, reused: false, error: "invalid_input" };
  }

  // Fast idempotent path: return existing row if this key was used before.
  const { data: existing } = await supabase
    .from("sms_availability_presentations")
    .select("*")
    .eq("conversation_id", input.conversationId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) {
    return { row: existing as PresentationRow, reused: true };
  }

  const ttl = input.ttlMs ?? PRESENTATION_TTL_MS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl).toISOString();
  const options = input.slots.map((s, i) => ({ ...s, option_number: i + 1 }));

  const { data: inserted, error } = await supabase
    .from("sms_availability_presentations")
    .insert({
      conversation_id: input.conversationId,
      idempotency_key: input.idempotencyKey,
      quote_session_id: input.quoteSessionId ?? null,
      property_id: input.propertyId ?? null,
      inputs_key: input.inputsKey ?? null,
      pricing_version: input.pricingVersion ?? null,
      quote_signature: input.quoteSignature ?? null,
      authoritative_duration_minutes: input.authoritativeDurationMinutes ?? null,
      canonical_total_cents: input.canonicalTotalCents ?? null,
      options,
      outbound_message_preview: input.outboundMessagePreview ?? null,
      status: "pending_send",
      expires_at: expiresAt,
      resolved_customer_id: input.resolvedCustomerId ?? null,
      identity_resolution_method: input.identityResolutionMethod ?? null,
      hold_status: "none",
    })
    .select("*")
    .maybeSingle();

  if (error) {
    // Unique-index race: another concurrent worker won the insert. Fetch it.
    const { data: raced } = await supabase
      .from("sms_availability_presentations")
      .select("*")
      .eq("conversation_id", input.conversationId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (raced) return { row: raced as PresentationRow, reused: true };
    return { row: null, reused: false, error: String(error.message ?? error) };
  }
  if (!inserted) return { row: null, reused: false, error: "insert_returned_null" };
  return { row: inserted as PresentationRow, reused: false };
}

/** Activate a `pending_send` presentation after its outbound SMS succeeded,
 *  and atomically supersede whatever presentation was previously active on
 *  the same conversation. Returns the activated row, or null if the row was
 *  not in `pending_send` status (e.g. already activated by another worker). */
export async function activatePresentationAfterSend(
  supabase: SupabaseClient,
  presentationId: string,
  args: { outboundSmsId?: string | null; outboundMessagePreview?: string | null } = {},
): Promise<PresentationRow | null> {
  // Phase 5: single-transaction activation. The RPC atomically:
  //   * retires the prior active presentation on this conversation,
  //   * releases any 8-minute hold that presentation was carrying,
  //   * flips this pending_send row to active.
  // A partial unique index guarantees at most one active row per
  // conversation at any moment.
  await supabase.rpc("activate_presentation_atomic", {
    p_id: presentationId,
    p_outbound_sms_id: args.outboundSmsId ?? null,
    p_outbound_message_preview: args.outboundMessagePreview ?? null,
  });
  const { data: row } = await supabase
    .from("sms_availability_presentations")
    .select("*")
    .eq("id", presentationId)
    .maybeSingle();
  return (row as PresentationRow | null) ?? null;
}

/** Mark a `pending_send` presentation as `send_failed`. The prior active
 *  presentation on the same conversation is UNTOUCHED so the customer still
 *  has a valid option set to reply against. */
export async function markPresentationSendFailed(
  supabase: SupabaseClient,
  presentationId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("sms_availability_presentations")
    .update({
      status: "send_failed",
      send_failed_at: new Date().toISOString(),
      send_failure_reason: reason.slice(0, 200),
    })
    .eq("id", presentationId)
    .eq("status", "pending_send");
}

/** Persist parser result + selected authoritative slot on the exact
 *  presentation the customer replied to. Idempotent per inbound_sms_id
 *  (the unique partial index prevents duplicate parse rows). The selected
 *  start/end are read from the persisted `options` — never from model input. */
export interface RecordSelectionInput {
  presentationId: string;
  inboundSmsId: string;
  replyText: string;
  status: "selected" | "ambiguous" | "no_match" | "expired_options" | "gate_blocked" | "context_invalidated";
  matchedOptionNumber?: number | null;
  invalidationReason?: string | null;
}
export async function recordSelection(
  supabase: SupabaseClient,
  input: RecordSelectionInput,
): Promise<PresentationRow | null> {
  // Read the current row to look up authoritative start/end from `options`.
  const { data: row } = await supabase
    .from("sms_availability_presentations")
    .select("*")
    .eq("id", input.presentationId)
    .maybeSingle();
  if (!row) return null;

  let selectedSlotId: string | null = null;
  let selectedStart: string | null = null;
  let selectedEnd: string | null = null;
  if (input.status === "selected" && input.matchedOptionNumber != null) {
    const opt = (row.options as any[]).find(
      (o) => Number(o.option_number) === input.matchedOptionNumber,
    );
    if (opt) {
      selectedSlotId = String(opt.slot_id);
      selectedStart = String(opt.start_at);
      selectedEnd = String(opt.end_at);
    }
  }

  const patch: Record<string, unknown> = {
    selection_inbound_sms_id: input.inboundSmsId,
    selection_reply_text: input.replyText.slice(0, 2000),
    selection_status: input.status,
    selection_option_number: input.matchedOptionNumber ?? null,
    selected_slot_id: selectedSlotId,
    selected_start_at: selectedStart,
    selected_end_at: selectedEnd,
    selection_parsed_at: new Date().toISOString(),
    selection_invalidation_reason: input.invalidationReason ?? null,
  };

  const { data: updated } = await supabase
    .from("sms_availability_presentations")
    .update(patch)
    .eq("id", input.presentationId)
    // Dedupe: only write if we haven't already parsed this exact inbound.
    .is("selection_inbound_sms_id", null)
    .select("*")
    .maybeSingle();

  // If already parsed (duplicate delivery), return the existing row.
  if (!updated) return row as PresentationRow;
  return updated as PresentationRow;
}

/** Attach the outbound acknowledgment SMS id to a selection. */
export async function attachSelectionAckSms(
  supabase: SupabaseClient,
  presentationId: string,
  ackSmsId: string,
): Promise<void> {
  await supabase
    .from("sms_availability_presentations")
    .update({ selection_ack_sms_id: ackSmsId })
    .eq("id", presentationId)
    .is("selection_ack_sms_id", null);
}

// Legacy alias so any prior imports still work. New code should call the
// explicit lifecycle helpers above.
export async function recordPresentation(
  supabase: SupabaseClient,
  input: CreatePendingPresentationInput & { outboundSmsId?: string | null },
): Promise<PresentationRow | null> {
  const pending = await createPendingPresentation(supabase, input);
  if (!pending.row) return null;
  return await activatePresentationAfterSend(supabase, pending.row.id, {
    outboundSmsId: input.outboundSmsId ?? null,
    outboundMessagePreview: input.outboundMessagePreview ?? null,
  });
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