// ============================================================================
// escalationDelivery.ts — PURE, testable logic that maps the raw per-channel
// notification outcomes of an internal escalation into (a) an explicit,
// auditable overall delivery state and (b) the EXACT customer-facing language
// the AI is permitted to use. The language model NEVER invents delivery status:
// it may only relay the `message` produced here.
//
// No network, no Deno APIs — safe to unit test in isolation.
// ============================================================================

/** Raw outcome of a single notification channel (SMS or email). */
export type ChannelDeliveryStatus =
  | "skipped" // channel not attempted (e.g. email alerts disabled / no address)
  | "queued" // handed to the async SMS queue; NOT yet confirmed by the provider
  | "sent" // provider accepted the message (confirmed acceptance)
  | "suppressed" // blocked by test-identity / opt-out / unsubscribe
  | "failed" // provider rejected or enqueue failed
  | "not_configured"; // provider credentials missing

/** Explicit, auditable overall escalation delivery state. */
export type EscalationDeliveryState =
  | "created" // record created; no channel has progressed
  | "queued" // at least one channel queued; none confirmed yet
  | "sms_sent" // SMS provider acceptance confirmed
  | "email_sent" // email provider acceptance confirmed
  | "partially_delivered" // one channel confirmed, another failed
  | "delivery_failed" // every attempted channel failed
  | "suppressed" // every attempted channel suppressed
  | "no_recipient_configured"; // no enabled recipient / alerts disabled

export interface DeliveryInputs {
  hasRecipient: boolean;
  alertsEnabled: boolean;
  sms: ChannelDeliveryStatus;
  email: ChannelDeliveryStatus;
}

/**
 * Collapse the two channel outcomes into ONE overall state. Ordering of the
 * checks encodes the priority: a confirmed send beats a queue; a queue means
 * "recorded, not yet confirmed"; only when nothing is queued and something
 * failed do we surface a failure.
 */
export function rollupDeliveryState(i: DeliveryInputs): EscalationDeliveryState {
  if (!i.alertsEnabled || !i.hasRecipient) return "no_recipient_configured";

  const channels = [i.sms, i.email];
  const attempted = channels.filter((c) => c !== "skipped" && c !== "not_configured");

  const smsSent = i.sms === "sent";
  const emailSent = i.email === "sent";
  const anySent = smsSent || emailSent;
  const anyFailed = channels.includes("failed");
  const anyQueued = channels.includes("queued");

  // Nothing was actually attempted (both skipped / not configured).
  if (attempted.length === 0) return "no_recipient_configured";

  // Every attempted channel was suppressed → nothing left BluLadder.
  if (attempted.every((c) => c === "suppressed")) return "suppressed";

  if (anySent && anyFailed) return "partially_delivered";
  if (smsSent && emailSent) return "sms_sent";
  if (emailSent) return "email_sent";
  if (smsSent) return "sms_sent";

  // No confirmed acceptance yet. A queued SMS means "recorded, pending".
  if (anyQueued) return "queued";

  // Nothing queued, nothing sent → whatever was attempted failed.
  if (anyFailed) return "delivery_failed";

  return "created";
}

/** True only when the AI is allowed to tell the customer an alert was sent. */
export function isConfirmedDelivered(state: EscalationDeliveryState): boolean {
  return state === "sms_sent" || state === "email_sent" || state === "partially_delivered";
}

/**
 * The EXACT customer-facing sentence for a given delivery state + severity.
 * `officeDisplay` must be resolved from the centralized phone configuration
 * (purpose = primary_public); it is never hard-coded by the model.
 */
export function customerEscalationMessage(
  state: EscalationDeliveryState,
  severity: string,
  officeDisplay: string,
): string {
  const office = (officeDisplay && officeDisplay.trim()) || "(866) 242-2583";

  if (isConfirmedDelivered(state)) {
    if (severity === "urgent") {
      return `I've sent an urgent alert to our team and someone will follow up with you. If you need us right away, you can call our office at ${office}.`;
    }
    return `I've sent your request to our team and someone will follow up with you. You can also call our office at ${office}.`;
  }

  if (state === "delivery_failed") {
    return `I've recorded your request, but I'm unable to confirm that a notification was delivered. You can call our office at ${office}.`;
  }

  // created | queued | suppressed | no_recipient_configured
  return `I've recorded your request for our team to review. You can also call our office at ${office}.`;
}
