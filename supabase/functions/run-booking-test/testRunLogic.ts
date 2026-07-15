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
  // Historical failure attempts for this step. Populated by `applyPass`
  // whenever a previously-failed attempt transitions to `passed` after
  // `Resume from safe checkpoint`, so the current step reflects only the
  // live state (no stale red failure reason) while the audit trail of every
  // prior failure remains available for diagnostics.
  history?: Array<{
    status: StepStatus;
    reason?: string;
    startedAt?: string;
    finishedAt?: string;
  }>;
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

/**
 * Transition a step to `passed`, clearing any stale failure reason from a
 * prior attempt and preserving that attempt in `history`. Pure — safe to
 * unit-test without hitting Supabase.
 */
export function applyPass(step: RunStep, now: string): RunStep {
  const history = Array.isArray(step.history) ? [...step.history] : [];
  if (step.status === "failed" && (step.reason || step.startedAt || step.finishedAt)) {
    history.push({
      status: "failed",
      reason: step.reason,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    });
  }
  // Strip stale failure fields from the current step. `reason` is the only
  // failure surface today; we deliberately drop it (not set it to undefined
  // via spread) so the persisted JSON does not carry the old red text.
  const { reason: _staleReason, ...rest } = step;
  const next: RunStep = {
    ...rest,
    status: "passed",
    finishedAt: now,
  };
  if (history.length > 0) next.history = history;
  return next;
}

export function markStepPass(steps: RunStep[], key: string, now: string): RunStep[] {
  return steps.map((s) => (s.key === key ? applyPass(s, now) : s));
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

// ---------------------------------------------------------------------------
// Booking payload construction & validation (runner-only).
//
// The runner reuses the production `jobber-create-booking` edge function
// exactly as-is. That function requires the same full payload real customers
// send: `services[]`, `subtotal`, `total`, `discountAmount`, `durationMinutes`,
// and `customer.firstName` / `customer.lastName`. Earlier the runner posted a
// minimal payload and the production function crashed on `services.map` — a
// runner defect, not a production bug. These helpers rebuild the full payload
// deterministically from the canonical server quote and the selected slot the
// runner already stored, and validate it fully BEFORE any live authorization
// is consumed. The single-use live authorization must never be spent on a
// payload the runner itself cannot construct correctly.
// ---------------------------------------------------------------------------

export interface CanonicalQuoteLike {
  jobberLineItems?: Array<{ name?: string; unitPrice?: number; price?: number; description?: string }>;
  lineItems?: Array<{ label?: string; name?: string; amount?: number; price?: number; description?: string }>;
  subtotal?: number;
  total?: number;
  discountAmount?: number;
  discount?: { amount?: number } | null;
}

export interface RunnerSlotLike {
  slotId: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  __technicianId?: string;
  __isTeamJob?: boolean;
  __teamTechnicianIds?: string[] | null;
}

export interface BuiltBookingPayload {
  customer: { firstName: string; lastName: string; email: string; phone: string; address: string };
  technicianId: string;
  isTeamJob: boolean;
  teamTechnicianIds: string[] | null;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  services: Array<{ name: string; price: number; description?: string }>;
  subtotal: number;
  total: number;
  discountAmount: number;
  idempotencyKey: string;
}

/**
 * Split the customer full name into firstName/lastName. For the approved
 * protected test identity we return the explicit ("BluLadder", "Booking Test")
 * pair — never a fragile one-word split that would leave lastName empty and
 * fail production validation. For any other name we fall back to a safe
 * whitespace split that guarantees a non-empty lastName when possible.
 */
export function splitCustomerName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = (fullName || "").trim().replace(/\s+/g, " ");
  if (trimmed === APPROVED_TEST_NAME) return { firstName: "BluLadder", lastName: "Booking Test" };
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Map the canonical server quote's line items to the exact shape
 * `jobber-create-booking` expects: `{ name, price, description? }`.
 * Prefer `jobberLineItems` (already normalized for Jobber). Fall back to
 * `lineItems` only when the Jobber-shaped list is missing.
 * Prices are never derived from client state.
 */
export function mapQuoteToServices(
  quote: CanonicalQuoteLike | null | undefined,
): Array<{ name: string; price: number; description?: string }> {
  if (!quote) return [];
  if (Array.isArray(quote.jobberLineItems) && quote.jobberLineItems.length > 0) {
    return quote.jobberLineItems.map((li) => ({
      name: String(li?.name ?? "").trim(),
      price: Number(li?.unitPrice ?? li?.price ?? NaN),
      description: li?.description ? String(li.description) : undefined,
    }));
  }
  if (Array.isArray(quote.lineItems) && quote.lineItems.length > 0) {
    return quote.lineItems.map((li) => ({
      name: String(li?.label ?? li?.name ?? "").trim(),
      price: Number(li?.amount ?? li?.price ?? NaN),
      description: li?.description ? String(li.description) : undefined,
    }));
  }
  return [];
}

export function buildBookingPayload(input: {
  quote: CanonicalQuoteLike | null | undefined;
  slot: RunnerSlotLike | null | undefined;
  customer: { name: string; email: string; phone: string; address: string };
  idempotencyKey: string;
}): BuiltBookingPayload {
  const { quote, slot, customer, idempotencyKey } = input;
  const { firstName, lastName } = splitCustomerName(customer?.name ?? "");
  const discountFromQuote = quote?.discountAmount ?? quote?.discount?.amount ?? 0;
  return {
    customer: {
      firstName,
      lastName,
      email: customer?.email ?? "",
      phone: customer?.phone ?? "",
      address: customer?.address ?? "",
    },
    technicianId: slot?.__technicianId ?? "",
    isTeamJob: slot?.__isTeamJob === true,
    teamTechnicianIds: slot?.__teamTechnicianIds ?? null,
    scheduledStart: slot?.startTime ?? "",
    scheduledEnd: slot?.endTime ?? "",
    durationMinutes: Number(slot?.durationMinutes ?? NaN),
    services: mapQuoteToServices(quote),
    subtotal: Number(quote?.subtotal ?? NaN),
    total: Number(quote?.total ?? NaN),
    discountAmount: Number(discountFromQuote ?? NaN),
    idempotencyKey: idempotencyKey ?? "",
  };
}

/**
 * Fail-fast payload validation. Returns the list of missing/invalid field
 * names — the coordinator halts on `booking_payload_validation` and does NOT
 * consume the one-time live authorization when this fails.
 */
export function validateBookingPayload(p: BuiltBookingPayload): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!Array.isArray(p.services) || p.services.length === 0) {
    missing.push("services");
  } else {
    for (const [i, s] of p.services.entries()) {
      if (!s.name) missing.push(`services[${i}].name`);
      if (!Number.isFinite(s.price) || s.price < 0) missing.push(`services[${i}].price`);
    }
  }
  if (!Number.isFinite(p.subtotal)) missing.push("subtotal");
  if (!Number.isFinite(p.total)) missing.push("total");
  if (!Number.isFinite(p.discountAmount)) missing.push("discountAmount");
  if (!Number.isFinite(p.durationMinutes) || !Number.isInteger(p.durationMinutes) || p.durationMinutes <= 0) {
    missing.push("durationMinutes");
  }
  if (!p.customer.firstName) missing.push("customer.firstName");
  if (!p.customer.lastName) missing.push("customer.lastName");
  if (!p.customer.email) missing.push("customer.email");
  if (!p.customer.phone) missing.push("customer.phone");
  if (!p.scheduledStart) missing.push("slot.startTime");
  const hasTech = !!p.technicianId || (p.isTeamJob && Array.isArray(p.teamTechnicianIds) && p.teamTechnicianIds.length > 0);
  if (!hasTech) missing.push("technicianId");
  if (!p.idempotencyKey) missing.push("idempotencyKey");
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Admin cancellation forwarding (runner-only).
//
// `customer-appointment-actions` verifies admin identity from real user JWT
// claims (sub + email + verifyAdminRole). The runner MUST forward the
// authenticated operations-admin caller's own bearer token — never the
// service-role key, which has no `sub`/`email` and is rejected as anonymous.
//
// This helper is pure so we can prove in tests that the service-role key is
// never used for this call, and that no token is ever logged or persisted
// (the returned headers are held only in the request-scoped memory of the
// coordinator's outbound fetch — they never touch `patchRun` or any log).
// ---------------------------------------------------------------------------

export type AdminForwardOutcome =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: "admin_reauthentication_required" | "service_role_forbidden" };

export function buildAdminCancelHeaders(input: {
  adminJwt: string | null | undefined;
  serviceRoleKey: string;
  anonKey: string;
}): AdminForwardOutcome {
  const jwt = (input.adminJwt ?? "").trim();
  if (!jwt) return { ok: false, reason: "admin_reauthentication_required" };
  // Refuse to present the service-role key to a function that expects real
  // user claims. This is the exact failure mode that caused run
  // 594cc548 to halt at visit_removed.
  if (input.serviceRoleKey && jwt === input.serviceRoleKey) {
    return { ok: false, reason: "service_role_forbidden" };
  }
  return {
    ok: true,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: input.anonKey,
    },
  };
}