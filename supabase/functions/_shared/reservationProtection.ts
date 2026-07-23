// ============================================================================
// reservationProtection — Phase 6B.2 wrappers around the reservation-state
// protection RPCs. Called from executeSmsBooking before/after invoking the
// external booking creator.
//
// The underlying rows in `slot_reservations` normally have `status = 'held'`
// with an 8-minute `expires_at`. If a booking-creator round-trip stretches
// past that expiration, the periodic `expire_stale_reservations` job would
// flip the row to 'expired' and release capacity — while Jobber may already
// be committing the visit. `protect_reservation_for_execution` flips the
// rows to a new 'executing' status that is (a) excluded from expiration and
// (b) still blocks overlapping reservations via the exclusion constraint.
//
// On failure paths the executor calls `unprotectReservationAfterFailure`
// to return the reservation to 'held' (safe retry / reconciliation) or
// 'released' (verified_not_created — capacity returned to the pool).
// ============================================================================
// deno-lint-ignore-file no-explicit-any

export interface ProtectResult {
  ok: boolean;
  updated?: number;
  total?: number;
  reason?: string;
}

/**
 * Extend the reservation lifespan and mark it 'executing' for the given
 * hold group. Idempotent — safe to call multiple times.
 *
 * @param minExpiresAt Minimum expiration timestamp. The RPC bumps
 *   `expires_at` to at least this value (never shortens it).
 */
export async function protectReservationForExecution(
  supabase: any,
  groupId: string,
  minExpiresAt: Date,
): Promise<ProtectResult> {
  const { data, error } = await supabase.rpc("protect_reservation_for_execution", {
    p_group_id: groupId,
    p_min_expires_at: minExpiresAt.toISOString(),
  });
  if (error) return { ok: false, reason: error.message ?? "rpc_error" };
  return (data ?? { ok: false, reason: "no_result" }) as ProtectResult;
}

/**
 * Return protected reservations to either 'held' (allow safe retry / let the
 * reconciliation runner resolve) or 'released' (verified no external write,
 * return capacity immediately).
 */
export async function unprotectReservationAfterFailure(
  supabase: any,
  groupId: string,
  target: "held" | "released",
  holdTtlMinutes = 8,
): Promise<ProtectResult> {
  const { data, error } = await supabase.rpc("unprotect_reservation_after_failure", {
    p_group_id: groupId,
    p_new_status: target,
    p_hold_ttl_minutes: holdTtlMinutes,
  });
  if (error) return { ok: false, reason: error.message ?? "rpc_error" };
  return (data ?? { ok: false, reason: "no_result" }) as ProtectResult;
}