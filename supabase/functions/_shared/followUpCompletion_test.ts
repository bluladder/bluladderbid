// ============================================================================
// Tests for the end-of-sequence lifecycle transition (Unbooked Quote Follow-Up
// 12-Month → BluLadder Long-Term Home Care Nurture).
//
// These are hermetic Deno tests. They exercise the pure eligibility gate
// (`evaluateFollowUpCompletion`) and the deterministic idempotency key so
// every safeguard the requirements call out is provable, and duplicate
// completion processing cannot double-enroll.
//
// No live SMS, email, Jobber record, or Meta event is created.
// ============================================================================
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  evaluateFollowUpCompletion,
  followUpCompletionIdempotencyKey,
  type FollowUpEligibilityInput,
} from "./campaignSweep.ts";
import { ALLOWED_EVENTS } from "./campaignEngine.ts";

const NOW = new Date("2027-07-20T12:00:00Z").getTime();
const AN_HOUR_AGO = NOW - 3_600_000;

function base(overrides: Partial<FollowUpEligibilityInput> = {}): FollowUpEligibilityInput {
  return {
    totalMessages: 6,
    pendingMessages: 0,
    processingMessages: 0,
    latestSendAtMs: AN_HOUR_AGO,
    nowMs: NOW,
    hasBooking: false,
    optedOut: false,
    staffTakeover: false,
    suppressed: false,
    marketingConsentGranted: true,
    newerEnrollmentExists: false,
    enrollmentStatus: "active",
    ...overrides,
  };
}

Deno.test("quote_follow_up_completed is on the canonical allowlist", () => {
  assertEquals((ALLOWED_EVENTS as readonly string[]).includes("quote_follow_up_completed"), true);
});

Deno.test("idempotency key is deterministic and version-scoped", () => {
  const k1 = followUpCompletionIdempotencyKey("enr-abc", 1);
  const k2 = followUpCompletionIdempotencyKey("enr-abc", 1);
  const k3 = followUpCompletionIdempotencyKey("enr-abc", 2);
  assertEquals(k1, "quote_follow_up_completed:enr-abc:v1");
  assertEquals(k1, k2, "same inputs must yield the same key so a re-run cannot double-emit");
  assertEquals(k1 === k3, false, "a bumped campaign version yields a distinct key");
  assertEquals(followUpCompletionIdempotencyKey("enr-abc", null), "quote_follow_up_completed:enr-abc:v0");
});

Deno.test("happy path — all messages resolved, safeguards clear", () => {
  const d = evaluateFollowUpCompletion(base());
  assertEquals(d.eligible, true);
  assertEquals(d.reason, "eligible");
});

Deno.test("pending or processing messages block completion", () => {
  assertEquals(evaluateFollowUpCompletion(base({ pendingMessages: 1 })).reason, "messages_still_scheduled");
  assertEquals(evaluateFollowUpCompletion(base({ processingMessages: 1 })).reason, "messages_still_scheduled");
});

Deno.test("cannot complete before the final scheduled send-time", () => {
  const d = evaluateFollowUpCompletion(base({ latestSendAtMs: NOW + 60_000 }));
  assertEquals(d.eligible, false);
  assertEquals(d.reason, "before_final_send_at");
});

Deno.test("empty schedule is not treated as complete", () => {
  const d = evaluateFollowUpCompletion(base({ totalMessages: 0, latestSendAtMs: null }));
  assertEquals(d.eligible, false);
  assertEquals(d.reason, "no_scheduled_messages");
});

Deno.test("booked customers are excluded from the transition", () => {
  assertEquals(evaluateFollowUpCompletion(base({ hasBooking: true })).reason, "booking_completed");
});

Deno.test("opted-out customers are excluded", () => {
  assertEquals(evaluateFollowUpCompletion(base({ optedOut: true })).reason, "opted_out");
});

Deno.test("staff-takeover conversations are excluded", () => {
  assertEquals(evaluateFollowUpCompletion(base({ staffTakeover: true })).reason, "staff_takeover");
});

Deno.test("suppressed identities are excluded", () => {
  assertEquals(evaluateFollowUpCompletion(base({ suppressed: true })).reason, "suppressed");
});

Deno.test("marketing consent is required before eligibility", () => {
  assertEquals(evaluateFollowUpCompletion(base({ marketingConsentGranted: false })).reason, "no_marketing_consent");
});

Deno.test("newer follow-up enrollment supersedes the old one", () => {
  assertEquals(evaluateFollowUpCompletion(base({ newerEnrollmentExists: true })).reason, "superseded_by_newer_enrollment");
});

Deno.test("already stopped/completed enrollments are excluded", () => {
  assertEquals(evaluateFollowUpCompletion(base({ enrollmentStatus: "stopped" })).reason, "enrollment_not_active");
  assertEquals(evaluateFollowUpCompletion(base({ enrollmentStatus: "completed" })).reason, "enrollment_not_active");
});