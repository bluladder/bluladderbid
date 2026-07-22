// ============================================================================
// Strict nurture-entry gate (pure).
//
// The canonical `campaign-event` engine already enforces the universal safety
// gates every campaign shares: audience match, consent, suppression, opt-out,
// duplicate/re-entry, effective window, global launch-controls kill switch,
// permanent STOP events and PAUSE-on-conversation.
//
// Evergreen educational nurture ("Evergreen Service Education Nurture") is a
// long, low-frequency marketing sequence. Before creating a new enrollment
// against it (or any other marketing-consent campaign) we apply THESE extra
// entry rules, on top of the universal gates:
//
//   * No active appointment                (customer has upcoming booking)
//   * No recent booking                    (booked in the last 14 days)
//   * No active incompatible campaign      (any other active enrollment)
//   * No email suppression                 (bounced/complained/unsubscribed)
//   * No unresolved escalation             (complaint/damage/billing/safety)
//   * No active human takeover
//   * No newer quote lifecycle superseding this one
//
// This module carries NO I/O so it can be unit-tested from Vitest AND Deno.
// The impure DB gatherer lives in the Deno-side mirror at
// `supabase/functions/_shared/nurtureEntryGate.ts` and is the ONLY caller
// permitted from server code.
// ============================================================================

/** Recent-booking window applied by the impure gatherer. Kept here for tests. */
export const NURTURE_RECENT_BOOKING_WINDOW_DAYS = 14;

export interface NurtureEntryContext {
  /** Any non-cancelled booking with scheduled_start_at >= now. */
  activeAppointment: boolean;
  /** Any non-cancelled booking created within the recent window. */
  recentBooking: boolean;
  /** Any other currently-active campaign enrollment for the same customer. */
  incompatibleEnrollment: boolean;
  /** Recipient's email is on the email_suppressions list. */
  emailSuppressed: boolean;
  /** An unresolved ai_escalations row (complaint/damage/billing/safety). */
  hasEscalation: boolean;
  /** An active human takeover flag on the customer's most recent chat. */
  staffTakeoverActive: boolean;
  /** A newer quote for this customer supersedes the lifecycle anchor. */
  newerQuoteSupersedes: boolean;
  /** Customer row could not be resolved from event identifiers. */
  invalidCustomerRecord: boolean;
}

export type NurtureEntryReason =
  | "eligible"
  | "active_appointment"
  | "recent_booking"
  | "incompatible_campaign_active"
  | "email_suppressed"
  | "escalation_pending"
  | "staff_takeover_active"
  | "newer_quote_supersedes"
  | "invalid_customer_record";

export interface NurtureEntryDecision {
  eligible: boolean;
  reason: NurtureEntryReason;
}

/**
 * Pure entry-gate evaluator. Order of checks is stable so the returned reason
 * is deterministic across runs and matches the admin-facing rule list top to
 * bottom. Adding a new rule appends — never reorder without updating tests.
 */
export function evaluateNurtureEntry(ctx: NurtureEntryContext): NurtureEntryDecision {
  if (ctx.invalidCustomerRecord) return { eligible: false, reason: "invalid_customer_record" };
  if (ctx.activeAppointment) return { eligible: false, reason: "active_appointment" };
  if (ctx.recentBooking) return { eligible: false, reason: "recent_booking" };
  if (ctx.incompatibleEnrollment) return { eligible: false, reason: "incompatible_campaign_active" };
  if (ctx.emailSuppressed) return { eligible: false, reason: "email_suppressed" };
  if (ctx.hasEscalation) return { eligible: false, reason: "escalation_pending" };
  if (ctx.staffTakeoverActive) return { eligible: false, reason: "staff_takeover_active" };
  if (ctx.newerQuoteSupersedes) return { eligible: false, reason: "newer_quote_supersedes" };
  return { eligible: true, reason: "eligible" };
}

/**
 * Human-readable reasons for the admin UI. Kept next to the evaluator so any
 * new rule must supply a phrase before it can be surfaced.
 */
export const NURTURE_ENTRY_REASON_LABELS: Record<NurtureEntryReason, string> = {
  eligible: "Eligible",
  invalid_customer_record: "Customer record could not be resolved",
  active_appointment: "Customer has an active upcoming appointment",
  recent_booking: `Customer booked within the last ${NURTURE_RECENT_BOOKING_WINDOW_DAYS} days`,
  incompatible_campaign_active: "Another active campaign enrollment already in flight",
  email_suppressed: "Email address is on the suppression list",
  escalation_pending: "Unresolved complaint / damage / billing / safety escalation",
  staff_takeover_active: "Human staff has taken over this conversation",
  newer_quote_supersedes: "A newer quote lifecycle takes precedence",
};
