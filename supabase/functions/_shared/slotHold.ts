// ============================================================================
// slotHold.ts — Phase 5 orchestration for 8-minute temporary slot holds.
//
// STRICT SEPARATION OF CONCERNS (per Phase 5 spec):
//
//   1. revalidateSelectedSlot()   READ-ONLY. Re-runs the authoritative
//                                 availability engine and confirms the
//                                 customer's selected start_at / end_at is
//                                 still bookable. Returns the crew_ids that
//                                 the engine currently anchors the slot to.
//
//   2. reserveAuthoritativeSlot() RESERVATION RPC ONLY. Thin wrapper over
//                                 public.reserve_booking_slot. Never writes
//                                 to sms_availability_presentations. Never
//                                 mutates any other table.
//
//   3. persistHoldState()         LOCAL PERSISTENCE ONLY. Called ONLY after
//                                 the reservation RPC returned ok. Writes
//                                 the hold columns on the presentation row.
//
//   4. releaseHold() / expireAbandonedHolds()  release + expiration paths.
//
// HARD RULES
//   * No booking, no confirmation, no Jobber write.
//   * No customer-facing SMS is sent from this module. Callers own outbound.
//   * The eight-minute TTL is fixed at RESERVATION time by the RPC's
//     p_ttl_minutes argument and mirrored on the presentation row so callers
//     never need to guess.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getAvailableSlots,
  type AvailabilityFetcher,
  type AvailabilityLookupInput,
  type AvailabilitySlot,
} from "./availabilityLookup.ts";
import type { PresentationRow } from "./presentation.ts";
import {
  markHoldReleased,
  persistHoldStateOnPresentation,
} from "./presentation.ts";

export const HOLD_TTL_MINUTES = 8;

// ---------------------------------------------------------------------------
// 1. revalidateSelectedSlot — READ-ONLY.
// ---------------------------------------------------------------------------

export type RevalidationReason =
  | "no_selection"
  | "not_ready"
  | "gate_blocked"
  | "schedule_drifted"
  | "engine_error"
  | "slot_unavailable";

export interface RevalidationResult {
  ok: boolean;
  reason?: RevalidationReason;
  detail?: string | null;
  /** The slot as returned by the CURRENT engine call (fresh crew anchoring). */
  slot?: AvailabilitySlot | null;
  /** Crew ids the engine currently anchors this slot to. */
  crewIds?: string[];
}

export interface RevalidateDeps {
  fetcher?: AvailabilityFetcher;
  /** Raw engine passthrough — supplies technicianId / assistant tech ids for
   *  the matching slot. Only used when the standard fetcher path is used and
   *  we need to map an AvailabilitySlot back to concrete crew ids. */
  rawSlotResolver?: (startAtIso: string) => Promise<string[] | null>;
}

/** Re-query availability for the presentation's selected date and confirm the
 *  selected start_at is still present. Also returns the crew ids currently
 *  anchoring that slot so the caller can pass them to the reservation RPC. */
export async function revalidateSelectedSlot(
  supabase: SupabaseClient,
  presentation: Pick<
    PresentationRow,
    "conversation_id" | "selected_slot_id" | "selected_start_at" | "selected_end_at" | "options"
  >,
  deps: RevalidateDeps = {},
): Promise<RevalidationResult> {
  if (
    !presentation.selected_start_at ||
    !presentation.selected_end_at ||
    !presentation.selected_slot_id
  ) {
    return { ok: false, reason: "no_selection" };
  }

  // Narrow the engine query to the selected date so revalidation is cheap
  // and deterministic.
  const preferredDate = String(presentation.selected_start_at).slice(0, 10);
  const input: AvailabilityLookupInput = { preferred_date: preferredDate, max_options: 4 };

  const result = await getAvailableSlots(
    supabase,
    presentation.conversation_id,
    input,
    { fetcher: deps.fetcher },
  );

  if (result.status === "gate_blocked") {
    return { ok: false, reason: "gate_blocked", detail: result.gate_reason ?? null };
  }
  if (result.status === "not_ready") {
    return { ok: false, reason: "not_ready", detail: result.next_action ?? null };
  }
  if (result.status === "schedule_drifted") {
    return { ok: false, reason: "schedule_drifted", detail: result.detail ?? null };
  }
  if (result.status === "engine_error") {
    return { ok: false, reason: "engine_error", detail: result.detail ?? null };
  }
  if (result.status !== "ok" || result.slots.length === 0) {
    return { ok: false, reason: "slot_unavailable" };
  }

  const match = result.slots.find(
    (s) => s.start_at === presentation.selected_start_at &&
           s.end_at === presentation.selected_end_at,
  );
  if (!match) return { ok: false, reason: "slot_unavailable" };

  const crewIds = deps.rawSlotResolver
    ? ((await deps.rawSlotResolver(match.start_at)) ?? [])
    : ((match as any).crew_ids ?? []);

  return { ok: true, slot: match, crewIds };
}

// ---------------------------------------------------------------------------
// 2. reserveAuthoritativeSlot — RESERVATION RPC ONLY.
// ---------------------------------------------------------------------------

export interface ReserveInput {
  crewIds: string[];
  startAt: string;
  endAt: string;
  sessionId?: string | null;
  idempotencyKey: string;
  ttlMinutes?: number;
}

export interface ReserveResult {
  ok: boolean;
  groupId: string | null;
  status: "held" | "conflict" | "error";
  reason?: string;
  /** Present when the RPC returned an idempotent replay of a prior success. */
  idempotent?: boolean;
  expiresAtIso: string | null;
}

export async function reserveAuthoritativeSlot(
  supabase: SupabaseClient,
  input: ReserveInput,
): Promise<ReserveResult> {
  if (!Array.isArray(input.crewIds) || input.crewIds.length === 0) {
    return { ok: false, groupId: null, status: "error", reason: "no_crew", expiresAtIso: null };
  }
  const ttl = input.ttlMinutes ?? HOLD_TTL_MINUTES;
  const { data, error } = await supabase.rpc("reserve_booking_slot", {
    p_crew_ids: input.crewIds,
    p_start: input.startAt,
    p_end: input.endAt,
    p_session: input.sessionId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_ttl_minutes: ttl,
  });
  if (error) {
    return { ok: false, groupId: null, status: "error", reason: String(error.message ?? error), expiresAtIso: null };
  }
  const res = (data ?? {}) as {
    ok?: boolean;
    group_id?: string;
    status?: string;
    reason?: string;
    idempotent?: boolean;
    expires_at?: string;
  };
  if (res.ok === false) {
    return { ok: false, groupId: null, status: "conflict", reason: res.reason ?? "conflict", expiresAtIso: null };
  }
  // Compute a client-side expiresAt fallback if the RPC didn't echo one
  // (idempotent replays return { status, result } only).
  const expiresAt = res.expires_at
    ?? new Date(Date.now() + ttl * 60_000).toISOString();
  return {
    ok: true,
    groupId: res.group_id ?? null,
    status: "held",
    idempotent: !!res.idempotent,
    expiresAtIso: expiresAt,
  };
}

// ---------------------------------------------------------------------------
// 3. persistHoldState — LOCAL PERSISTENCE ONLY. Called AFTER a successful
//    reservation. Delegates the actual UPDATE to presentation.ts so this
//    module stays free of raw table access.
// ---------------------------------------------------------------------------

export interface PersistHoldInput {
  presentationId: string;
  holdGroupId: string;
  crewIds: string[];
  startAt: string;
  endAt: string;
  expiresAtIso: string;
  idempotencyKey: string;
}

export async function persistHoldState(
  supabase: SupabaseClient,
  input: PersistHoldInput,
): Promise<PresentationRow | null> {
  return await persistHoldStateOnPresentation(supabase, {
    presentationId: input.presentationId,
    holdGroupId: input.holdGroupId,
    crewIds: input.crewIds,
    startAt: input.startAt,
    endAt: input.endAt,
    expiresAt: input.expiresAtIso,
    idempotencyKey: input.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// 4. Release + expiration.
// ---------------------------------------------------------------------------

export async function releaseHold(
  supabase: SupabaseClient,
  presentationId: string,
  holdGroupId: string | null,
  reason: string,
): Promise<void> {
  if (holdGroupId) {
    try {
      await supabase.rpc("release_booking_slot", { p_group_id: holdGroupId });
    } catch (_e) {
      // Best-effort — expire_stale_reservations will retire it eventually.
    }
  }
  await markHoldReleased(supabase, presentationId, "released", reason);
}

/** Sweep abandoned holds past the 8-minute window. Delegates to the atomic
 *  RPC which releases the underlying slot_reservations group AND flips the
 *  presentation row to hold_status='expired'. Returns the count expired. */
export async function expireAbandonedHolds(
  supabase: SupabaseClient,
): Promise<{ expired: number; error?: string }> {
  const { data, error } = await supabase.rpc("expire_stale_presentation_holds");
  if (error) return { expired: 0, error: String(error.message ?? error) };
  const n = typeof data === "number" ? data : Number(data ?? 0);
  return { expired: Number.isFinite(n) ? n : 0 };
}