// ---------------------------------------------------------------------------
// Pure, framework-free logic for the one-time live Jobber test authorization
// admin control. Kept separate from React so the visibility rules, precondition
// checks, status derivation and idempotency-key generation are unit-testable.
//
// This module NEVER performs a booking, never talks to Jobber and never mutates
// suppression. It only decides what the admin control may show/enable and how to
// scope the existing authorize_live_jobber_test / clear_live_jobber_authorization
// RPCs. The identifiers it produces are derived (not editable by the admin).
// ---------------------------------------------------------------------------

// Owner-approved permanent protected test identity (normalized).
export const APPROVED_TEST_EMAIL = "blmillen@gmail.com";
export const APPROVED_TEST_PHONE = "+14692150144";

export function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

// Reduce a phone to a comparable E.164-ish digit string ("+1..." tolerant).
export function normalizePhone(phone?: string | null): string {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  // Treat 10-digit US numbers and 11-digit "1XXXXXXXXXX" as equal.
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export interface TestIdentityLike {
  email?: string | null;
  phone?: string | null;
  active?: boolean | null;
  protected?: boolean | null;
  live_jobber_test_enabled?: boolean | null;
  authorized_conversation_id?: string | null;
  authorized_slot_id?: string | null;
  authorized_idempotency_key?: string | null;
  authorization_expires_at?: string | null;
  authorization_consumed_at?: string | null;
  authorized_by?: string | null;
  authorized_result?: unknown;
  updated_at?: string | null;
}

export interface ConvoFactsQuote {
  status?: string | null;
  firm?: boolean | null;
  total?: number | null;
  pricingVersion?: number | null;
  engineVersion?: string | null;
}

export interface ConvoFacts {
  quote?: ConvoFactsQuote | null;
  availability?: { offeredSlotIds?: string[] | null } | null;
  selectedSlotId?: string | null;
}

export interface ConvoLike {
  id: string;
  prospect_email?: string | null;
  prospect_phone?: string | null;
  conversation_state?: string | null;
  service_area_status?: string | null;
  selected_slot_id?: string | null;
  facts?: ConvoFacts | null;
  quote_result?: { total?: number | null; ruleVersion?: number | null; engineVersion?: string | null; status?: string | null } | null;
}

// A conversation belongs to the protected test identity when its normalized
// email OR phone matches the approved permanent identity.
export function isProtectedTestConversation(convo: ConvoLike, identity: TestIdentityLike | null): boolean {
  if (!identity || identity.protected !== true) return false;
  const idEmail = normalizeEmail(identity.email);
  const idPhone = normalizePhone(identity.phone);
  const cEmail = normalizeEmail(convo.prospect_email);
  const cPhone = normalizePhone(convo.prospect_phone);
  const emailMatch = !!idEmail && idEmail === cEmail;
  const phoneMatch = !!idPhone && idPhone === cPhone;
  return emailMatch || phoneMatch;
}

// The authorization scope key MUST equal the `authKey` the chat booking tool
// passes to consume_live_jobber_authorization (p_idempotency_key):
//   chat|<conversationId>|<opaqueSlotId>
// This is derived — the admin can never type or edit it.
export function buildAuthKey(conversationId: string, slotId: string): string {
  return `chat|${conversationId}|${slotId}`;
}

export type AuthStatus =
  | "not_authorized"
  | "authorized"
  | "expired"
  | "consumed"
  | "mismatch"
  | "failed";

export function deriveAuthStatus(identity: TestIdentityLike | null, now: number = Date.now()): AuthStatus {
  if (!identity || identity.live_jobber_test_enabled !== true) return "not_authorized";

  const result = identity.authorized_result as { status?: string } | null | undefined;
  const consumed = !!identity.authorization_consumed_at;

  if (consumed) {
    if (result?.status && result.status !== "confirmed") {
      return result.status === "mismatch" ? "mismatch" : "failed";
    }
    return "consumed";
  }

  const expiresAt = identity.authorization_expires_at ? new Date(identity.authorization_expires_at).getTime() : null;
  if (expiresAt == null || Number.isNaN(expiresAt) || expiresAt < now) return "expired";
  return "authorized";
}

export const AUTH_STATUS_LABELS: Record<AuthStatus, string> = {
  not_authorized: "Not authorized",
  authorized: "Authorized",
  expired: "Expired",
  consumed: "Consumed",
  mismatch: "Mismatch",
  failed: "Failed",
};

export interface Precondition {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface PreconditionInput {
  isOperationsAdmin: boolean;
  convo: ConvoLike;
  identity: TestIdentityLike | null;
  globalSuppressionOn: boolean;
  authStatus: AuthStatus;
}

// Read a firm/current quote from server-authoritative facts, falling back to the
// persisted quote_result snapshot.
export function readQuote(convo: ConvoLike): { total: number | null; ruleVersion: number | null; engineVersion: string | null; firm: boolean; status: string | null } {
  const q = convo.facts?.quote ?? null;
  const r = convo.quote_result ?? null;
  const status = q?.status ?? r?.status ?? null;
  const firm = q?.firm === true && status === "firm";
  return {
    total: q?.total ?? r?.total ?? null,
    ruleVersion: q?.pricingVersion ?? r?.ruleVersion ?? null,
    engineVersion: q?.engineVersion ?? r?.engineVersion ?? null,
    firm,
    status,
  };
}

export function selectedSlotBelongs(convo: ConvoLike): boolean {
  const slotId = convo.selected_slot_id ?? convo.facts?.selectedSlotId ?? null;
  if (!slotId) return false;
  const offered = convo.facts?.availability?.offeredSlotIds ?? [];
  // If we have an offer list, the slot must be in it; if the facts column is
  // sparse (legacy) fall back to simply having a selected slot on the row.
  if (Array.isArray(offered) && offered.length > 0) return offered.includes(slotId);
  return !!convo.selected_slot_id;
}

export function evaluatePreconditions(input: PreconditionInput): Precondition[] {
  const { isOperationsAdmin, convo, identity, globalSuppressionOn, authStatus } = input;
  const quote = readQuote(convo);
  const state = convo.conversation_state ?? "";
  const stateReady = state === "awaiting_booking_confirmation";

  return [
    { key: "operations_admin", label: "Authenticated operations admin", ok: isOperationsAdmin },
    { key: "protected_identity", label: "Conversation is the approved protected test identity", ok: isProtectedTestConversation(convo, identity) },
    { key: "geocode_eligible", label: "Address geocoded as eligible", ok: convo.service_area_status === "eligible", detail: convo.service_area_status ?? "unknown" },
    { key: "quote_firm", label: "Quote is current and firm", ok: quote.firm, detail: quote.status ?? undefined },
    { key: "state_ready", label: "State is awaiting booking confirmation", ok: stateReady, detail: state || undefined },
    { key: "slot_selected", label: "A selected slot belongs to this conversation", ok: selectedSlotBelongs(convo) },
    { key: "suppression_active", label: "Permanent test suppression is active", ok: identity?.active === true && identity?.protected === true },
    { key: "global_suppression_off", label: "Global test suppression is off", ok: !globalSuppressionOn },
    { key: "no_unresolved", label: "No unresolved test booking already exists", ok: authStatus === "not_authorized" },
  ];
}

export function allPreconditionsMet(preconditions: Precondition[]): boolean {
  return preconditions.every((p) => p.ok);
}

// The Authorize button may enable only when every precondition holds AND there
// is currently no active/consumed authorization.
export function canAuthorize(preconditions: Precondition[], authStatus: AuthStatus): boolean {
  return allPreconditionsMet(preconditions) && authStatus === "not_authorized";
}

// The panel is visible only for an operations admin viewing the protected test
// identity conversation that has a selected slot and is ready for the test.
export function shouldShowPanel(input: {
  isOperationsAdmin: boolean;
  convo: ConvoLike;
  identity: TestIdentityLike | null;
}): boolean {
  const { isOperationsAdmin, convo, identity } = input;
  if (!isOperationsAdmin) return false;
  if (!isProtectedTestConversation(convo, identity)) return false;
  const hasSlot = !!(convo.selected_slot_id ?? convo.facts?.selectedSlotId);
  const quote = readQuote(convo);
  const state = convo.conversation_state ?? "";
  const readyish = state === "awaiting_booking_confirmation" || state === "booked" || quote.firm;
  return hasSlot && readyish;
}

// Live-test readiness: the exact prerequisites the panel gates on, each with a
// clear pass/fail + explanation, so an operations admin is NEVER shown a
// silently-missing panel. When every gate passes the full authorization control
// is shown; otherwise this list explains precisely what is missing.
export function liveTestReadiness(input: {
  isOperationsAdmin: boolean;
  convo: ConvoLike;
  identity: TestIdentityLike | null;
  globalSuppressionOn: boolean;
}): Precondition[] {
  const { isOperationsAdmin, convo, identity, globalSuppressionOn } = input;
  const quote = readQuote(convo);
  const state = convo.conversation_state ?? "";
  const hasSlot = !!(convo.selected_slot_id ?? convo.facts?.selectedSlotId);
  return [
    { key: "operations_admin", label: "You are an operations admin", ok: isOperationsAdmin,
      detail: isOperationsAdmin ? undefined : "requires operations-admin permission" },
    { key: "protected_identity", label: "Conversation is the protected test identity", ok: isProtectedTestConversation(convo, identity),
      detail: isProtectedTestConversation(convo, identity) ? undefined : "not the approved test customer" },
    { key: "selected_slot", label: "A slot is currently selected", ok: hasSlot,
      detail: hasSlot ? undefined : "no selected slot yet" },
    { key: "state_ready", label: "Conversation is awaiting booking confirmation", ok: state === "awaiting_booking_confirmation" || state === "booked",
      detail: state || "unknown" },
    { key: "quote_firm", label: "Quote is firm and current", ok: quote.firm, detail: quote.status ?? "no quote" },
    { key: "suppression_active", label: "Permanent test suppression is active", ok: identity?.active === true && identity?.protected === true,
      detail: identity?.active && identity?.protected ? undefined : "test suppression missing" },
    { key: "global_suppression_off", label: "Global test suppression is off", ok: !globalSuppressionOn,
      detail: globalSuppressionOn ? "global test suppression is ON" : undefined },
  ];
}

// A parsed view of the stored authorization result for the verification panel.
export interface AuthorizedResultView {
  status: string | null;
  jobberVisitId: string | null;
  confirmedTime: string | null;
}

export function parseAuthorizedResult(result: unknown): AuthorizedResultView | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  return {
    status: typeof r.status === "string" ? r.status : null,
    jobberVisitId: typeof r.jobberVisitId === "string" ? r.jobberVisitId : null,
    confirmedTime: typeof r.confirmedTime === "string" ? r.confirmedTime : null,
  };
}