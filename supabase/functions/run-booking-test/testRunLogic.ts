// ============================================================================
// Pure, side-effect-free logic for the controlled AI-chat booking test runner.
// Kept separate so step definitions, phase transitions, slot pre-selection and
// derived authorization values are unit-testable without hitting Supabase or
// Jobber. The coordinator (index.ts) imports these helpers and performs the
// actual effects by delegating to existing edge functions and RPCs.
// ============================================================================

export const APPROVED_TEST_EMAIL = "blmillen@gmail.com";
export const APPROVED_TEST_PHONE = "+14692150144";
export const APPROVED_TEST_NAME = "BluLadder Booking Test";
export const APPROVED_TEST_ADDRESS = "720 Parkland Dr, Aubrey, TX 76227";

// Deterministic property details for the canonical residential window quote.
// Chosen to yield a firm (non-manual-review) quote from the pricing engine.
export const CANONICAL_PROPERTY = {
  services: ["window_cleaning"] as const,
  squareFootage: 2500,
  stories: 2,
  windowCleaningType: "exterior",
  condition: "maintenance",
};

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "requires_admin_action";
export type RunPhase = "prepare" | "checkpoint" | "execute" | "duplicate" | "cancel_cleanup" | "complete" | "failed";
export type RunAction = "prepare" | "execute" | "duplicate" | "cancel_cleanup" | "resume" | "status";

export interface RunStep {
  key: string;
  label: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  reason?: string;
}

// Canonical, ordered step catalog. The coordinator flips status/reason as it
// runs; the UI renders directly from this list.
export const PREPARE_STEPS: RunStep[] = [
  { key: "geocode_eligible", label: "Geocode returns eligible", status: "pending" },
  { key: "schedule_fresh", label: "Jobber schedule freshness OK", status: "pending" },
  { key: "sync_safe", label: "No unsafe sync in progress", status: "pending" },
  { key: "test_suppression_active", label: "Permanent test suppression active", status: "pending" },
  { key: "global_suppression_off", label: "Global suppression is off", status: "pending" },
  { key: "no_prior_unresolved", label: "No unresolved prior test booking", status: "pending" },
  { key: "clean_conversation", label: "Clean test conversation created", status: "pending" },
  { key: "quote_requested", label: "Residential window quote requested", status: "pending" },
  { key: "property_details", label: "Approved property details supplied", status: "pending" },
  { key: "quote_firm", label: "Canonical quote is firm", status: "pending" },
  { key: "availability", label: "Weekday availability retrieved", status: "pending" },
  { key: "slot_selected", label: "First valid production slot selected", status: "pending" },
  { key: "slot_stored", label: "Selected slot stored on conversation", status: "pending" },
  { key: "state_ready", label: "State advanced to awaiting_booking_confirmation", status: "pending" },
  { key: "ambiguous_no_booking", label: "Ambiguous confirmation does not book", status: "pending" },
  { key: "no_prior_booking", label: "No booking tool or Jobber write occurred", status: "pending" },
  { key: "authorization_values", label: "Scoped authorization values prepared", status: "pending" },
];

export const EXECUTE_STEPS: RunStep[] = [
  { key: "auth_authorized", label: "Authorization is authorized and scoped", status: "pending" },
  { key: "explicit_confirmation", label: "Explicit booking confirmation submitted", status: "pending" },
  { key: "booking_payload_validation", label: "Booking payload built from canonical quote and slot", status: "pending" },
  { key: "reservation", label: "One reservation created", status: "pending" },
  { key: "jobber_client", label: "One Jobber client matched or created", status: "pending" },
  { key: "jobber_job", label: "One Jobber job created", status: "pending" },
  { key: "jobber_visit", label: "One Jobber visit created with valid id", status: "pending" },
  { key: "central_time", label: "Time correct in America/Chicago", status: "pending" },
  { key: "technician", label: "Technician matches selected slot", status: "pending" },
  { key: "line_items", label: "Line items and total match canonical quote", status: "pending" },
  { key: "state_booked", label: "Conversation state = booked", status: "pending" },
  { key: "auth_consumed", label: "Authorization consumed (single-use)", status: "pending" },
  { key: "no_messages", label: "No SMS, email, campaign, CallRail or alert delivered", status: "pending" },
];

export const DUPLICATE_STEPS: RunStep[] = [
  { key: "replay_returns_original", label: "Duplicate replay returns original result", status: "pending" },
  { key: "no_second_booking", label: "No second booking, job, visit or reservation", status: "pending" },
];

export const CANCEL_STEPS: RunStep[] = [
  { key: "visit_removed", label: "Jobber visit removed", status: "pending" },
  { key: "booking_cancelled", label: "Local booking cancelled", status: "pending" },
  { key: "busy_block_cancelled", label: "Busy block cancelled", status: "pending" },
  { key: "reservation_released", label: "Reservation released", status: "pending" },
  { key: "slot_returned", label: "Slot returned to availability", status: "pending" },
  { key: "queued_messages_cancelled", label: "Suppressed queued messages cancelled", status: "pending" },
  { key: "enrollments_stopped", label: "Temporary campaign enrollments stopped", status: "pending" },
  { key: "auth_cleared", label: "One-time authorization cleared", status: "pending" },
  { key: "identity_preserved", label: "Protected test identity still active + protected", status: "pending" },
  { key: "temp_cleanup", label: "Temporary conversation/messages/events cleaned up", status: "pending" },
];

export function initialSteps(): RunStep[] {
  return [
    ...PREPARE_STEPS,
    ...EXECUTE_STEPS,
    ...DUPLICATE_STEPS,
    ...CANCEL_STEPS,
  ].map((s) => ({ ...s }));
}

export function markStep(steps: RunStep[], key: string, patch: Partial<RunStep>): RunStep[] {
  return steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

// Scoped authorization key MUST match the value the booking tool uses:
//   chat|<conversationId>|<opaqueSlotId>
export function buildAuthKey(conversationId: string, slotId: string): string {
  return `chat|${conversationId}|${slotId}`;
}

// Robust booking idempotency key uses the resolved slot start time so a real
// re-book of a different time creates a new booking while a genuine retry of
// the same booking de-duplicates.
export function buildIdempotencyKey(conversationId: string, slotStart: string): string {
  return `chat|${conversationId}|${slotStart}`;
}

// A candidate slot offered by jobber-availability, with optional ranking hints
// used to mirror production selection priority.
export interface OfferedSlot {
  slotId: string;
  startTime: string;
  endTime?: string;
  displayTime?: string;
  durationMinutes?: number;
  isRecommended?: boolean;
  whyLabel?: string;
}

/**
 * Choose the slot the runner will book, mirroring real customer behavior.
 *
 * Priority:
 *   1. Best Recommended slot (whyLabel === "best_recommended" or isRecommended).
 *   2. Earliest compacted slot (whyLabel === "minimizes_gaps").
 *   3. Earliest valid offered slot.
 *
 * jobber-availability already enforces every real booking rule upstream
 * (weekday-only, mirror freshness, reservations, lead time, route compaction,
 * quote signature), so any slot returned here is inherently valid. We do not
 * add artificial floors like "must be N days ahead" — that would defeat the
 * runner's purpose of simulating a real customer booking.
 */
export function pickProductionSlot(slots: OfferedSlot[]): OfferedSlot | null {
  if (slots.length === 0) return null;
  const byStart = (a: OfferedSlot, b: OfferedSlot) =>
    Date.parse(a.startTime) - Date.parse(b.startTime);
  const parseable = slots.filter((s) => Number.isFinite(Date.parse(s.startTime)));
  if (parseable.length === 0) return null;

  const recommended = parseable
    .filter((s) => s.whyLabel === "best_recommended" || s.isRecommended === true)
    .sort(byStart);
  if (recommended[0]) return recommended[0];

  const compacted = parseable
    .filter((s) => s.whyLabel === "minimizes_gaps")
    .sort(byStart);
  if (compacted[0]) return compacted[0];

  return [...parseable].sort(byStart)[0] ?? null;
}

// Auth precondition evaluator for `execute`. The coordinator only proceeds
// with the live write when this returns `ok: true` — never on its own decision.
export interface AuthGate {
  live_jobber_test_enabled?: boolean | null;
  authorized_conversation_id?: string | null;
  authorized_slot_id?: string | null;
  authorized_idempotency_key?: string | null;
  authorization_expires_at?: string | null;
  authorization_consumed_at?: string | null;
}

export function evaluateAuthGate(
  gate: AuthGate | null,
  expected: { conversationId: string; slotId: string; authKey: string },
  now: Date = new Date(),
): { ok: boolean; reason: string } {
  if (!gate || gate.live_jobber_test_enabled !== true) return { ok: false, reason: "not_authorized" };
  if (gate.authorization_consumed_at) return { ok: false, reason: "already_consumed" };
  const expiresAt = gate.authorization_expires_at ? Date.parse(gate.authorization_expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) return { ok: false, reason: "expired" };
  if (
    gate.authorized_conversation_id !== expected.conversationId ||
    gate.authorized_slot_id !== expected.slotId ||
    gate.authorized_idempotency_key !== expected.authKey
  ) return { ok: false, reason: "mismatch" };
  return { ok: true, reason: "authorized" };
}

// Human-readable safe-stage label for the UI when a run halts.
export function safeStageLabel(phase: RunPhase, stepKey?: string | null): string {
  const p =
    phase === "prepare" ? "Preparation" :
    phase === "checkpoint" ? "Awaiting operations-admin authorization" :
    phase === "execute" ? "Live Jobber write" :
    phase === "duplicate" ? "Duplicate-replay check" :
    phase === "cancel_cleanup" ? "Cancellation & cleanup" :
    phase === "complete" ? "Complete" :
    "Failed";
  return stepKey ? `${p} → ${stepKey}` : p;
}