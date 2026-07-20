// Deno unit tests for the quote-decline stop-scope, feedback-line rendering,
// and consent expectations. Pure-function tests — no network, no DB.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  campaignFilterForScope,
  filterEnrollmentsByScope,
  filterEnrollmentsByQuoteJourney,
  buildDeclineFeedbackLine,
} from "./index.ts";
import { renderTemplate } from "../_shared/sms.ts";
import { STOP_EVENTS, ALLOWED_EVENTS } from "../_shared/campaignEngine.ts";

Deno.test("STOP scope for quote_declined is 'abandoned' and covers both abandonment and decline win-back", () => {
  assertEquals(STOP_EVENTS.quote_declined.scope, "abandoned");
  // Phase 2A: booking_completed and recurring_plan_created must also stop the
  // decline win-back, so the 'abandoned' filter now includes quote_declined.
  assertEquals(campaignFilterForScope("abandoned"), ["quote_abandoned", "quote_declined"]);
  assert((ALLOWED_EVENTS as readonly string[]).includes("quote_declined"));
  assert((ALLOWED_EVENTS as readonly string[]).includes("booking_completed"));
  assert((ALLOWED_EVENTS as readonly string[]).includes("recurring_plan_created"));
  assertEquals(STOP_EVENTS.booking_completed.scope, "abandoned");
  assertEquals(STOP_EVENTS.recurring_plan_created.scope, "abandoned");
});

Deno.test("filterEnrollmentsByQuoteJourney stops only the matching quote_id", () => {
  const enrollments = [
    { id: "enrA", event_name: "quote_abandoned", campaign_event_id: "evA" },
    { id: "enrB", event_name: "quote_abandoned", campaign_event_id: "evB" },
  ];
  const events = [
    { id: "evA", metadata: { quote_id: "quoteA" } },
    { id: "evB", metadata: { quote_id: "quoteB" } },
  ];
  const stopA = filterEnrollmentsByQuoteJourney(enrollments, events, "quoteA");
  assertEquals(stopA.map((e) => e.id), ["enrA"], "declining quoteA must leave quoteB alone");

  // Regression: two independent firm quotes, decline A -> only A stops.
  const stopB = filterEnrollmentsByQuoteJourney(enrollments, events, "quoteB");
  assertEquals(stopB.map((e) => e.id), ["enrB"]);

  // No quoteId supplied -> legacy customer-wide behaviour preserved.
  const stopAll = filterEnrollmentsByQuoteJourney(enrollments, events, null);
  assertEquals(stopAll.length, 2);

  // Enrollment with no bound event -> refuse to stop, do not guess.
  const orphan = [{ id: "enrX", event_name: "quote_abandoned", campaign_event_id: null }];
  assertEquals(filterEnrollmentsByQuoteJourney(orphan, [], "quoteA"), []);
});

Deno.test("scope filter excludes non-abandonment enrollments", () => {
  const enrollments = [
    { id: "e1", event_name: "quote_abandoned", campaign_event_id: "ev1" },
    { id: "e2", event_name: "booking_completed", campaign_event_id: "ev2" },
    { id: "e3", event_name: "quote_calculated", campaign_event_id: "ev3" },
  ];
  const inScope = filterEnrollmentsByScope(enrollments, campaignFilterForScope("abandoned"));
  assertEquals(inScope.map((e) => e.id), ["e1"]);
});

Deno.test("feedback_line renders differently with and without a decline reason", () => {
  const withReason = buildDeclineFeedbackLine("price_too_high");
  const withoutReason = buildDeclineFeedbackLine(null);
  assert(withReason.toLowerCase().startsWith("thanks"), "with-reason line should thank the customer");
  assert(!withReason.toLowerCase().includes("tell us why"));
  assert(withoutReason.toLowerCase().includes("reply"), "without-reason line should invite feedback");
  assert(withoutReason !== withReason);

  // Empty string / whitespace -> treated as no reason (safety).
  assertEquals(buildDeclineFeedbackLine("   "), withoutReason);

  // Rendered into the seeded transactional SMS template.
  const sms = "Thanks for the update, {{first_name}} — we've marked your BluLadder bid declined and won't send further reminders. {{feedback_line}} If anything changes, your bid link stays live: {{link}}";
  const rendered = renderTemplate(sms, {
    first_name: "Jamie",
    feedback_line: withReason,
    link: "https://bluladderbid.lovable.app/quote/abc",
  });
  assert(rendered.includes("Jamie"));
  assert(rendered.includes("Thanks for that feedback"));
  assert(!rendered.includes("{{"), "no unrendered placeholders");

  const renderedNoReason = renderTemplate(sms, {
    first_name: "Jamie",
    feedback_line: withoutReason,
    link: "https://bluladderbid.lovable.app/quote/abc",
  });
  assert(renderedNoReason.includes("reply with a quick note"));
});