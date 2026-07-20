// ============================================================================
// Pure eligibility gate + idempotency-key tests for the nurture backfill.
// Hermetic — no DB, no network.
// ============================================================================
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  backfillReplayIdempotencyKey,
  buildReplayMetadata,
  evaluateBackfill,
  type BackfillEligibilityInput,
} from "./campaignTransitionReplay.ts";

function base(o: Partial<BackfillEligibilityInput> = {}): BackfillEligibilityInput {
  return {
    hasEventId: true,
    hasCustomerIdentity: true,
    alreadyReplayed: false,
    alreadyEnrolledInDestination: false,
    hasBooking: false,
    marketingConsentGranted: true,
    optedOut: false,
    suppressed: false,
    humanTakeover: false,
    supersededByNewerQuoteLifecycle: false,
    ...o,
  };
}

Deno.test("replay key uses a DISTINCT namespace from the original completion event key", () => {
  const key = backfillReplayIdempotencyKey("evt-1", "camp-A", 1);
  assertEquals(key, "campaign_transition_replay:evt-1:camp-A:v1");
  // Must NOT collide with the original completion key namespace so the canonical
  // event ingress cannot short-circuit to the original stored decisions=[].
  const originalCompletionKey = "quote_follow_up_completed:evt-1:v1";
  assertEquals(key === originalCompletionKey, false);
});

Deno.test("replay key is destination-version-scoped — v-bump yields a distinct key", () => {
  assertEquals(
    backfillReplayIdempotencyKey("evt-1", "camp-A", 1) ===
    backfillReplayIdempotencyKey("evt-1", "camp-A", 2),
    false,
  );
});

Deno.test("eligibility gate — happy path", () => {
  assertEquals(evaluateBackfill(base()).outcome, "eligible");
});

Deno.test("eligibility gate — exclusion buckets", () => {
  assertEquals(evaluateBackfill(base({ alreadyReplayed: true })).outcome, "already_replayed");
  assertEquals(evaluateBackfill(base({ alreadyEnrolledInDestination: true })).outcome, "already_enrolled");
  assertEquals(evaluateBackfill(base({ hasBooking: true })).outcome, "booked");
  assertEquals(evaluateBackfill(base({ optedOut: true })).outcome, "opted_out");
  assertEquals(evaluateBackfill(base({ suppressed: true })).outcome, "suppressed");
  assertEquals(evaluateBackfill(base({ humanTakeover: true })).outcome, "human_takeover");
  assertEquals(evaluateBackfill(base({ supersededByNewerQuoteLifecycle: true })).outcome, "superseded");
  assertEquals(evaluateBackfill(base({ marketingConsentGranted: false })).outcome, "no_consent");
  assertEquals(evaluateBackfill(base({ hasEventId: false })).outcome, "invalid_event");
  assertEquals(evaluateBackfill(base({ hasCustomerIdentity: false })).outcome, "invalid_event");
});

Deno.test("replay metadata preserves original attribution + source references", () => {
  const meta = buildReplayMetadata(
    {
      id: "evt-1", customer_id: "cust-1", email: "a@b.co", phone: null,
      processed_at: "2026-07-20T12:00:00Z",
      metadata: {
        quote_id: "q-1",
        source_enrollment_id: "enr-1",
        source_campaign_id: "33333333-3333-4333-9333-333333333333",
        source_campaign_version: 1,
        attribution: { utm_source: "facebook" },
        utm_params_json: { utm_campaign: "spring" },
        service_types: ["window", "gutter"],
        pricing_rule_version: 42,
        final_send_at: "2027-07-20T12:00:00Z",
      },
    },
    "44444444-4444-4444-9444-444444444444",
    1,
  );
  assertEquals(meta.quote_id, "q-1");
  assertEquals(meta.customer_id, "cust-1");
  assertEquals(meta.source_enrollment_id, "enr-1");
  assertEquals(meta.source_campaign_id, "33333333-3333-4333-9333-333333333333");
  assertEquals(meta.source_campaign_version, 1);
  assertEquals(meta.original_event_id, "evt-1");
  assertEquals(meta.original_completed_at, "2026-07-20T12:00:00Z");
  assertEquals((meta.attribution as { utm_source: string }).utm_source, "facebook");
  assertEquals((meta.service_types as string[]).length, 2);
  const replay = meta.replay as { via: string; destination_campaign_id: string; destination_campaign_version: number };
  assertEquals(replay.via, "campaign_transition_replay");
  assertEquals(replay.destination_campaign_id, "44444444-4444-4444-9444-444444444444");
  assertEquals(replay.destination_campaign_version, 1);
});