export interface ProtectedBookingTestRun {
  id: string;
  phase: string;
  status: string;
  conversation_id: string | null;
  slot_id: string | null;
  idempotency_key: string | null;
  auth_key: string | null;
}

export interface ProtectedBookingTestIdentity {
  email: string;
  protected: boolean;
  active: boolean;
  live_jobber_test_enabled: boolean;
  authorized_conversation_id: string | null;
  authorized_slot_id: string | null;
  authorized_idempotency_key: string | null;
  authorization_expires_at: string | null;
  authorization_consumed_at: string | null;
}

export type ProtectedBookingTestBypassReason =
  | "authorized"
  | "untrusted_caller"
  | "invalid_run"
  | "run_scope_mismatch"
  | "identity_scope_mismatch"
  | "authorization_inactive"
  | "authorization_expired"
  | "authorization_not_consumed";

export function evaluateProtectedBookingTestBypass(input: {
  callerIsServiceRole: boolean;
  requestedRunId: string | null;
  bookingEmail: string;
  bookingIdempotencyKey: string;
  run: ProtectedBookingTestRun | null;
  identity: ProtectedBookingTestIdentity | null;
  now?: Date;
}): { authorized: boolean; reason: ProtectedBookingTestBypassReason } {
  if (!input.callerIsServiceRole) {
    return { authorized: false, reason: "untrusted_caller" };
  }
  if (
    !input.requestedRunId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.requestedRunId) ||
    !input.run ||
    input.run.id !== input.requestedRunId
  ) {
    return { authorized: false, reason: "invalid_run" };
  }
  if (
    input.run.status !== "running" ||
    !["execute", "duplicate"].includes(input.run.phase) ||
    input.run.idempotency_key !== input.bookingIdempotencyKey ||
    !input.run.conversation_id ||
    !input.run.slot_id ||
    !input.run.auth_key
  ) {
    return { authorized: false, reason: "run_scope_mismatch" };
  }
  const identity = input.identity;
  if (
    !identity ||
    !identity.protected ||
    !identity.active ||
    identity.email.toLowerCase() !== input.bookingEmail.toLowerCase() ||
    identity.authorized_conversation_id !== input.run.conversation_id ||
    identity.authorized_slot_id !== input.run.slot_id ||
    identity.authorized_idempotency_key !== input.run.auth_key
  ) {
    return { authorized: false, reason: "identity_scope_mismatch" };
  }
  if (!identity.live_jobber_test_enabled) {
    return { authorized: false, reason: "authorization_inactive" };
  }
  const expiresAt = Date.parse(identity.authorization_expires_at ?? "");
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= (input.now ?? new Date()).getTime()
  ) {
    return { authorized: false, reason: "authorization_expired" };
  }
  if (!identity.authorization_consumed_at) {
    return { authorized: false, reason: "authorization_not_consumed" };
  }
  return { authorized: true, reason: "authorized" };
}
