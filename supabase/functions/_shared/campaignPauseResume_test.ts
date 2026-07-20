// Pause/resume semantics for the campaign engine. These pin the business rules
// that ordinary inbound replies PAUSE (not stop) active nurture, and that
// permanent stop conditions (booking, opt-out, revoked consent, decline,
// suppression, human takeover) always win.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { STOP_EVENTS, PAUSE_EVENTS, AUTO_RESUME_PAUSE_REASONS } from "./campaignEngine.ts";

Deno.test("customer_replied is NOT in STOP_EVENTS (must pause, not stop)", () => {
  assertEquals(STOP_EVENTS["customer_replied"], undefined);
});

Deno.test("customer_replied IS a pause event with a 72h window", () => {
  const p = PAUSE_EVENTS["customer_replied"];
  assert(p, "customer_replied must be in PAUSE_EVENTS");
  assertEquals(p.durationMs, 72 * 60 * 60 * 1000);
  assertEquals(p.scope, "all");
  assert(AUTO_RESUME_PAUSE_REASONS.has(p.reason));
});

Deno.test("permanent stop events still permanently stop (never pause)", () => {
  const permanent = [
    "booking_completed",
    "recurring_plan_created",
    "quote_declined",
    "consent_revoked",
    "manual_staff_takeover",
    "appointment_cancelled",
    "booking_rescheduled",
    "booking_cancelled",
  ];
  for (const name of permanent) {
    assert(STOP_EVENTS[name], `expected ${name} in STOP_EVENTS`);
    assertEquals(PAUSE_EVENTS[name], undefined, `${name} must not also be a pause event`);
  }
});
