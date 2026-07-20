// Deno unit tests for Phase 2C cancellation scoping + rendering.
// Pure-function tests — no network, no DB, no external side effects.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCancellationFeedbackLine,
  campaignFilterForScope,
  filterEnrollmentsByObsoleteBookingVersion,
} from "./index.ts";
import { renderTemplate } from "../_shared/sms.ts";
import { ALLOWED_EVENTS, STOP_EVENTS } from "../_shared/campaignEngine.ts";

Deno.test("booking_cancelled + booking_cancellation_requested are allowlisted", () => {
  assert((ALLOWED_EVENTS as readonly string[]).includes("booking_cancelled"));
  assert((ALLOWED_EVENTS as readonly string[]).includes("booking_cancellation_requested"));
});

Deno.test("booking_cancelled is a reminders-scoped STOP event", () => {
  assertEquals(STOP_EVENTS["booking_cancelled"].scope, "reminders");
});

Deno.test("cancellation reminders scope includes cancellation + reschedule + confirmation kinds", () => {
  const scope = campaignFilterForScope("reminders") ?? [];
  for (const ev of [
    "booking_cancelled",
    "booking_cancellation_requested",
    "booking_rescheduled",
    "booking_reschedule_requested",
    "booking_completed",
    "appointment_cancelled",
  ]) {
    assert(scope.includes(ev), `scope should include ${ev}`);
  }
});

Deno.test("cancellation supersedes only strictly-older enrollments for the SAME booking", () => {
  const enrollments = [
    { id: "a", booking_id: "B1", booking_version: 1 },
    { id: "b", booking_id: "B1", booking_version: 2 },
    { id: "c", booking_id: "B1", booking_version: null }, // legacy
    { id: "d", booking_id: "B2", booking_version: 1 },    // different booking
  ];
  // Cancellation for B1 stamped as v3 → v<3 for B1 only.
  const targets = filterEnrollmentsByObsoleteBookingVersion(enrollments, "B1", 3);
  assertEquals(targets.map((t) => t.id).sort(), ["a", "b", "c"]);
});

Deno.test("cancellation feedback line is safe when reason missing", () => {
  const line = buildCancellationFeedbackLine(null);
  assert(line.length > 0);
  assert(!line.toLowerCase().includes("undefined"));
  assert(!line.toLowerCase().includes("null"));
});

Deno.test("cancellation confirmation SMS renders safely when reason + notes missing", () => {
  const tpl =
    "Hi {{first_name}}, your BluLadder appointment {{previous_appointment_when}} has been cancelled. {{cancellation_feedback_line}} Ready when you are: {{booking_link}}";
  const out = renderTemplate(tpl, {
    first_name: "Ada",
    previous_appointment_when: "Tuesday, July 21 during 9am–11am",
    cancellation_feedback_line: buildCancellationFeedbackLine(null),
    booking_link: "https://bluladderbid.lovable.app/",
  });
  assert(!out.toLowerCase().includes("undefined"));
  assert(!out.toLowerCase().includes("null"));
  assert(!/\bfor \./.test(out));
  assert(out.includes("Ada"));
});
