// ============================================================================
// Canonical campaign engine.
//
// This is the SINGLE place that turns an allowlisted server-side event into
// consent-checked, suppression-checked, idempotent campaign enrollments and
// scheduled queue messages. There is exactly ONE queue processor
// (process-sms-queue) and ONE campaign engine (this module). Do not duplicate.
//
// The pure helpers (ALLOWED_EVENTS, matchesAudience, consentSatisfies) carry no
// I/O so they can be unit-tested directly.
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkSuppression, normalizeEmail, normalizePhoneE164 } from "./suppression.ts";

// The ONLY events the campaign engine will accept. Anything else is rejected.
export const ALLOWED_EVENTS = [
  "chat_lead_created",
  "quote_calculated",
  "manual_quote_requested",
  "callback_requested",
  "quote_abandoned",
  "quote_declined",
  "booking_completed",
  "recurring_plan_created",
  "appointment_rescheduled",
  "booking_reschedule_requested",
  "booking_rescheduled",
  "appointment_cancelled",
  "booking_cancellation_requested",
  "booking_cancelled",
  "customer_replied",
  "consent_granted",
  "consent_revoked",
  "manual_staff_takeover",
] as const;
export type CampaignEvent = (typeof ALLOWED_EVENTS)[number];

export function isAllowedEvent(name: unknown): name is CampaignEvent {
  return typeof name === "string" && (ALLOWED_EVENTS as readonly string[]).includes(name);
}

// Events that STOP active enrollments rather than (or in addition to) enrolling.
// Maps an incoming event to the campaign kinds it terminates.
export const STOP_EVENTS: Record<string, { reason: string; scope: "all" | "abandoned" | "reminders" }> = {
  booking_completed: { reason: "booking_completed", scope: "abandoned" },
  recurring_plan_created: { reason: "recurring_plan_created", scope: "abandoned" },
  quote_declined: { reason: "quote_declined", scope: "abandoned" },
  customer_replied: { reason: "customer_replied", scope: "all" },
  consent_revoked: { reason: "consent_revoked", scope: "all" },
  appointment_cancelled: { reason: "appointment_cancelled", scope: "reminders" },
  // A confirmed reschedule supersedes prior confirmations + reminders for the
  // SAME booking. Booking-version scoping in campaign-event narrows this so
  // unrelated bookings for the same customer are never affected.
  booking_rescheduled: { reason: "booking_rescheduled", scope: "reminders" },
  // A confirmed cancellation supersedes every prior confirmation + reminder +
  // reschedule-request enrollment for the SAME booking. Booking-version
  // scoping in campaign-event narrows this so unrelated bookings for the same
  // customer are never affected.
  booking_cancelled: { reason: "booking_cancelled", scope: "reminders" },
  manual_staff_takeover: { reason: "manual_staff_takeover", scope: "all" },
};

export type ConsentType = "transactional" | "requested_follow_up" | "marketing";

export interface AudienceContext {
  customerType?: "new" | "existing" | null;
  bookedBefore?: boolean | null;
  serviceTypes?: string[];
  quoteStatus?: string | null;
  manualReview?: boolean | null;
  bookingStatus?: string | null;
  leadSource?: string | null;
  serviceAreaStatus?: string | null;
  city?: string | null;
  tags?: string[];
  smsConsentStatus?: "granted" | "revoked" | "unknown";
  emailConsentStatus?: "granted" | "revoked" | "unknown";
  optedOut?: boolean;
}

// AND semantics: every configured condition must match. Unset conditions are
// ignored. Returns matched + human-readable reasons for the admin explanation.
export function matchesAudience(
  conditions: Record<string, unknown> | null | undefined,
  ctx: AudienceContext,
): { matched: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const c = conditions ?? {};
  let matched = true;

  const fail = (msg: string) => { matched = false; reasons.push(`✗ ${msg}`); };
  const pass = (msg: string) => reasons.push(`✓ ${msg}`);

  if (typeof c.customer_type === "string" && c.customer_type) {
    if (ctx.customerType !== c.customer_type) fail(`customer must be ${c.customer_type} (is ${ctx.customerType ?? "unknown"})`);
    else pass(`customer is ${c.customer_type}`);
  }
  if (typeof c.booked_before === "boolean") {
    if (!!ctx.bookedBefore !== c.booked_before) fail(`booked_before must be ${c.booked_before}`);
    else pass(`booked_before = ${c.booked_before}`);
  }
  if (Array.isArray(c.service_types) && c.service_types.length) {
    const want = (c.service_types as string[]).map((s) => s.toLowerCase());
    const have = (ctx.serviceTypes ?? []).map((s) => s.toLowerCase());
    if (!want.some((w) => have.includes(w))) fail(`service type in [${want.join(", ")}]`);
    else pass(`service type matches`);
  }
  if (Array.isArray(c.quote_status) && c.quote_status.length) {
    if (!ctx.quoteStatus || !(c.quote_status as string[]).includes(ctx.quoteStatus)) fail(`quote status in [${(c.quote_status as string[]).join(", ")}]`);
    else pass(`quote status ${ctx.quoteStatus}`);
  }
  if (typeof c.manual_review === "boolean") {
    if (!!ctx.manualReview !== c.manual_review) fail(`manual_review must be ${c.manual_review}`);
    else pass(`manual_review = ${c.manual_review}`);
  }
  if (Array.isArray(c.booking_status) && c.booking_status.length) {
    if (!ctx.bookingStatus || !(c.booking_status as string[]).includes(ctx.bookingStatus)) fail(`booking status in [${(c.booking_status as string[]).join(", ")}]`);
    else pass(`booking status ${ctx.bookingStatus}`);
  }
  if (Array.isArray(c.lead_source) && c.lead_source.length) {
    if (!ctx.leadSource || !(c.lead_source as string[]).includes(ctx.leadSource)) fail(`lead source in [${(c.lead_source as string[]).join(", ")}]`);
    else pass(`lead source ${ctx.leadSource}`);
  }
  if (Array.isArray(c.service_area_status) && c.service_area_status.length) {
    if (!ctx.serviceAreaStatus || !(c.service_area_status as string[]).includes(ctx.serviceAreaStatus)) fail(`service area in [${(c.service_area_status as string[]).join(", ")}]`);
    else pass(`service area ${ctx.serviceAreaStatus}`);
  }
  if (Array.isArray(c.city) && c.city.length) {
    const want = (c.city as string[]).map((s) => s.toLowerCase());
    if (!ctx.city || !want.includes(ctx.city.toLowerCase())) fail(`city in [${want.join(", ")}]`);
    else pass(`city ${ctx.city}`);
  }
  if (Array.isArray(c.tags) && c.tags.length) {
    const have = (ctx.tags ?? []).map((s) => s.toLowerCase());
    const want = (c.tags as string[]).map((s) => s.toLowerCase());
    if (!want.some((w) => have.includes(w))) fail(`tag in [${want.join(", ")}]`);
    else pass(`tag matches`);
  }
  if (typeof c.sms_consent === "string" && c.sms_consent && c.sms_consent !== "any") {
    if (ctx.smsConsentStatus !== c.sms_consent) fail(`sms consent must be ${c.sms_consent}`);
    else pass(`sms consent ${c.sms_consent}`);
  }
  if (typeof c.email_consent === "string" && c.email_consent && c.email_consent !== "any") {
    if (ctx.emailConsentStatus !== c.email_consent) fail(`email consent must be ${c.email_consent}`);
    else pass(`email consent ${c.email_consent}`);
  }
  if (c.opted_out === false) {
    if (ctx.optedOut) fail(`must not be opted out`);
    else pass(`not opted out`);
  }

  return { matched, reasons };
}

// True when existing consent permits a message of the required type on a
// channel. Transactional is always allowed (opt-out enforced separately).
export function consentSatisfies(
  required: ConsentType,
  grantedTypes: ConsentType[],
): boolean {
  if (required === "transactional") return true;
  if (required === "marketing") return grantedTypes.includes("marketing");
  if (required === "requested_follow_up") {
    return grantedTypes.includes("requested_follow_up") || grantedTypes.includes("marketing");
  }
  return false;
}

export interface EnrollDecision {
  campaignId: string;
  campaignName: string;
  outcome: "enrolled" | "not_enrolled" | "suppressed" | "skipped_duplicate" | "no_consent";
  reason: string;
  enrollmentId?: string;
  scheduledMessages?: number;
}

// Loads consent grant types for an identity on a channel.
async function grantedConsentTypes(
  supabase: SupabaseClient,
  channel: "sms" | "email",
  email: string | null,
  phone: string | null,
): Promise<ConsentType[]> {
  const q = supabase.from("communication_consent").select("consent_type").eq("channel", channel).eq("status", "granted");
  const { data } = channel === "sms" && phone
    ? await q.eq("phone", phone)
    : channel === "email" && email
      ? await q.eq("email", email)
      : { data: [] as { consent_type: ConsentType }[] };
  return (data ?? []).map((r) => r.consent_type as ConsentType);
}

export { checkSuppression, normalizeEmail, normalizePhoneE164 };
