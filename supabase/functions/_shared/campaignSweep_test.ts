import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeEffectiveAbandonmentDelay,
  evaluateAbandonment,
  abandonmentIdempotencyKey,
  abandonmentVersionTag,
  isCriticalEvent,
  DEFAULT_ABANDONMENT_DELAY_MINUTES,
  type AbandonmentConvo,
} from "./campaignSweep.ts";

const NOW = Date.parse("2026-07-13T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function base(overrides: Partial<AbandonmentConvo> = {}): AbandonmentConvo {
  return {
    id: "c1",
    quote_result: { status: "firm", total: 499 },
    pricing_version: 7,
    last_activity_at: minsAgo(120),
    resolved: false,
    booking_status: "quoted",
    callback_requested: false,
    manual_review_reason: null,
    needs_attention: false,
    staff_takeover_at: null,
    abandonment_emitted_version: null,
    campaign_status: null,
    ...overrides,
  };
}

Deno.test("delay: fallback when nothing configured", () => {
  assertEquals(computeEffectiveAbandonmentDelay([]), DEFAULT_ABANDONMENT_DELAY_MINUTES);
  assertEquals(computeEffectiveAbandonmentDelay([null, 0, -5]), DEFAULT_ABANDONMENT_DELAY_MINUTES);
});

Deno.test("delay: minimum positive configured wins", () => {
  assertEquals(computeEffectiveAbandonmentDelay([120, 60, 240]), 60);
});

Deno.test("firm quote eligible only AFTER the delay", () => {
  const delay = 60;
  assertEquals(evaluateAbandonment(base({ last_activity_at: minsAgo(30) }), NOW, delay).reason, "within_delay");
  assertEquals(evaluateAbandonment(base({ last_activity_at: minsAgo(90) }), NOW, delay).eligible, true);
});

Deno.test("manual-review / non-firm quote never emits", () => {
  assertEquals(evaluateAbandonment(base({ quote_result: { status: "manual_review_required" } }), NOW, 60).reason, "no_firm_quote");
  assertEquals(evaluateAbandonment(base({ quote_result: { status: "pricing_unavailable" } }), NOW, 60).reason, "no_firm_quote");
  assertEquals(evaluateAbandonment(base({ quote_result: null }), NOW, 60).reason, "no_firm_quote");
});

Deno.test("booking prevents abandonment", () => {
  assertEquals(evaluateAbandonment(base({ booking_status: "booked" }), NOW, 60).reason, "booking_completed");
  assertEquals(evaluateAbandonment(base({ booking_status: "converted" }), NOW, 60).reason, "booking_completed");
  assertEquals(evaluateAbandonment(base({ booking_status: "confirmed" }), NOW, 60).reason, "booking_completed");
});

Deno.test("callback / manual-quote / reply / takeover / resolved prevent abandonment", () => {
  assertEquals(evaluateAbandonment(base({ callback_requested: true }), NOW, 60).reason, "callback_active");
  assertEquals(evaluateAbandonment(base({ manual_review_reason: "screens" }), NOW, 60).reason, "manual_review_superseded");
  assertEquals(evaluateAbandonment(base({ campaign_status: "customer_replied" }), NOW, 60).reason, "customer_replied");
  assertEquals(evaluateAbandonment(base({ staff_takeover_at: minsAgo(5) }), NOW, 60).reason, "staff_takeover");
  assertEquals(evaluateAbandonment(base({ resolved: true }), NOW, 60).reason, "resolved");
});

Deno.test("already-emitted version is skipped; new version re-qualifies", () => {
  const tag = abandonmentVersionTag(base());
  assertEquals(evaluateAbandonment(base({ abandonment_emitted_version: tag }), NOW, 60).reason, "already_emitted");
  // A genuinely new pricing version has a different tag -> eligible again.
  assertEquals(evaluateAbandonment(base({ abandonment_emitted_version: "v6", pricing_version: 7 }), NOW, 60).eligible, true);
});

Deno.test("idempotency key is deterministic and version-scoped", () => {
  assertEquals(abandonmentIdempotencyKey({ id: "c1", pricing_version: 7 }), "quote_abandoned:c1:v7:1");
  assertEquals(abandonmentIdempotencyKey({ id: "c1", pricing_version: 8 }), "quote_abandoned:c1:v8:1");
});

Deno.test("critical event allowlist", () => {
  assertEquals(isCriticalEvent("booking_completed"), true);
  assertEquals(isCriticalEvent("manual_staff_takeover"), true);
  assertEquals(isCriticalEvent("quote_calculated"), false);
});
