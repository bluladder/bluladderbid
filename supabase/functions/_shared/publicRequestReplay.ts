const encoder = new TextEncoder();

export async function fingerprintPublicRequest(
  value: Record<string, unknown>,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function publicReplayResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { _requestFingerprint: _internal, ...publicResult } = value;
  return publicResult;
}

export function requestFingerprintMatches(
  value: unknown,
  expected: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>)._requestFingerprint === expected;
}

export interface BookingReservationResult {
  ok?: boolean;
  idempotent?: boolean;
  status?: string | null;
  group_id?: string | null;
  result?: Record<string, unknown> | null;
}

export type BookingReservationDecision =
  | { action: "replay"; result: Record<string, unknown> }
  | { action: "idempotency_key_reused" }
  | { action: "in_progress_or_uncertain" }
  | { action: "conflict" }
  | { action: "protection_unavailable" }
  | { action: "execute"; groupId: string };

/**
 * Single execution decision shared by every booking attempt. A durable result
 * always replays; an idempotent request without one never repeats provider
 * writes. Only an exact service-role continuation may resume a pre-reserved
 * executing hold.
 */
export function decideBookingReservationExecution(
  reservation: BookingReservationResult | null | undefined,
  expectedFingerprint: string,
  options: {
    serviceRoleCaller: boolean;
    preReservedGroupId?: string | null;
  },
): BookingReservationDecision {
  if (reservation?.idempotent && reservation.result) {
    return requestFingerprintMatches(reservation.result, expectedFingerprint)
      ? { action: "replay", result: publicReplayResult(reservation.result) }
      : { action: "idempotency_key_reused" };
  }
  const mayContinueProtectedReservation = reservation?.idempotent === true &&
    !reservation.result &&
    options.serviceRoleCaller && reservation.status === "executing" &&
    !!options.preReservedGroupId &&
    options.preReservedGroupId === reservation.group_id;
  if (reservation?.idempotent && !mayContinueProtectedReservation) {
    return { action: "in_progress_or_uncertain" };
  }
  if (reservation?.ok === false) return { action: "conflict" };
  if (!reservation?.group_id) return { action: "protection_unavailable" };
  return { action: "execute", groupId: reservation.group_id };
}
