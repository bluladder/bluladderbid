// Deno unit tests for Phase 2C cancellation scoping + rendering.
// Pure-function tests — no network, no DB, no external side effects.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCancellationFeedbackLine,
  campaignFilterForScope,
  filterEnrollmentsByObsoleteBookingVersion,
  buildAppointmentWhen,
  formatAppointmentDate,
  safeLink,
} from "./index.ts";
import { renderTemplate } from "../_shared/sms.ts";
import { ALLOWED_EVENTS, STOP_EVENTS } from "../_shared/campaignEngine.ts";

// -------- 1. Event allowlist + scope wiring --------
Deno.test("booking_cancelled + booking_cancellation_requested are allowlisted", () => {
  assert((ALLOWED_EVENTS as readonly string[]).includes("booking_cancelled"));
  assert((ALLOWED_EVENTS as readonly string[]).includes("booking_cancellation_requested"));
});

Deno.test("booking_cancelled is a reminders-scoped STOP event", () => {
  assertEquals(STOP_EVENTS["booking_cancelled"].scope, "reminders");
});

Deno.test("reminders scope covers cancel + reschedule + confirmation kinds (legacy alias included)", () => {
  const scope = campaignFilterForScope("reminders") ?? [];
  for (const ev of [
    "booking_cancelled",
    "booking_cancellation_requested",
    "booking_rescheduled",
    "booking_reschedule_requested",
    "booking_completed",
    "appointment_cancelled",
    "appointment_rescheduled",
    "appointment_scheduled",
  ]) {
    assert(scope.includes(ev), `scope should include ${ev}`);
  }
});

// -------- 2. Booking-scoped stop semantics --------
Deno.test("cancellation supersedes only strictly-older enrollments for the SAME booking", () => {
  const enrollments = [
    { id: "a", booking_id: "B1", booking_version: 1 },
    { id: "b", booking_id: "B1", booking_version: 2 },
    { id: "c", booking_id: "B1", booking_version: null }, // legacy row w/o version
    { id: "d", booking_id: "B2", booking_version: 1 },    // different booking
    { id: "e", booking_id: null, booking_version: null }, // unlinked
  ];
  const targets = filterEnrollmentsByObsoleteBookingVersion(enrollments, "B1", 3);
  assertEquals(targets.map((t) => t.id).sort(), ["a", "b", "c"]);
});

Deno.test("cancellation of B1 does not touch enrollments for a different booking B2", () => {
  const enrollments = [
    { id: "b2-active", booking_id: "B2", booking_version: 1 },
    { id: "b1-old", booking_id: "B1", booking_version: 1 },
  ];
  const targets = filterEnrollmentsByObsoleteBookingVersion(enrollments, "B1", 2);
  assertEquals(targets.map((t) => t.id), ["b1-old"]);
});

// -------- 3. Feedback line semantics --------
Deno.test("reason present → thanks + no re-ask", () => {
  const line = buildCancellationFeedbackLine("schedule_conflict");
  assert(line.length > 0);
  assert(!/tell us why|why are|share why/i.test(line));
});

Deno.test("reason absent → asks once for brief feedback", () => {
  const line = buildCancellationFeedbackLine(null);
  assert(line.length > 0);
  // Different from the reason-present line.
  assertEquals(line === buildCancellationFeedbackLine("schedule_conflict"), false);
  assert(!line.toLowerCase().includes("undefined"));
});

// -------- 4. Rendered template safety --------
const SMS_TEMPLATE =
  "Hi {{first_name}}, your BluLadder appointment {{previous_appointment_when}} has been cancelled. {{cancellation_feedback_line}} Ready when you are: {{booking_link}}";

function clean(out: string) {
  assert(!/undefined/i.test(out), `contains 'undefined': ${out}`);
  assert(!/null/i.test(out), `contains 'null': ${out}`);
  assert(!/\$0\b/.test(out), `contains '$0': ${out}`);
  assert(!/\bfor \./.test(out), `dangling 'for .': ${out}`);
  assert(!/  +/.test(out.trim()), `double spaces: ${out}`);
}

Deno.test("SMS renders cleanly with full data and reason present", () => {
  const date = formatAppointmentDate("2026-07-21T15:00:00Z");
  const when = buildAppointmentWhen(date, "9am - 11am");
  const out = renderTemplate(SMS_TEMPLATE, {
    first_name: "Ada",
    previous_appointment_when: when,
    cancellation_feedback_line: buildCancellationFeedbackLine("schedule_conflict"),
    booking_link: safeLink("https://bluladderbid.lovable.app/", "https://bluladderbid.lovable.app/"),
  });
  clean(out);
  assert(out.includes("Ada"));
});

Deno.test("SMS renders cleanly when reason + notes missing", () => {
  const out = renderTemplate(SMS_TEMPLATE, {
    first_name: "Ada",
    previous_appointment_when: "Tuesday, July 21 during 9am - 11am",
    cancellation_feedback_line: buildCancellationFeedbackLine(null),
    booking_link: "https://bluladderbid.lovable.app/",
  });
  clean(out);
});

Deno.test("SMS renders cleanly when appointment date missing (no dangling wording)", () => {
  const out = renderTemplate(SMS_TEMPLATE, {
    first_name: "Ada",
    previous_appointment_when: "", // empty — templates must handle
    cancellation_feedback_line: buildCancellationFeedbackLine(null),
    booking_link: "https://bluladderbid.lovable.app/",
  });
  clean(out);
});

Deno.test("SMS renders cleanly with multiple services (join is safe)", () => {
  const multi = ["Window Cleaning", "Gutter Cleaning", "House Washing"].join(", ");
  const out = renderTemplate(
    "{{first_name}}, we've cancelled your {{service_names}} appointment.",
    { first_name: "Ada", service_names: multi },
  );
  clean(out);
  assert(out.includes("Window Cleaning"));
  assert(out.includes("Gutter Cleaning"));
});

Deno.test("safeLink falls back for invalid or relative URLs", () => {
  const fb = "https://bluladderbid.lovable.app/";
  assertEquals(safeLink("javascript:alert(1)", fb), fb);
  assertEquals(safeLink("not a url", fb), fb);
  assertEquals(safeLink("/relative/path", fb), fb);
  assertEquals(safeLink("https://ok.example.com/x", fb), "https://ok.example.com/x");
});

// -------- 5. GSM-7 / segment count sanity for the seeded SMS --------
// Full GSM-7 charset (superset check).
const GSM7 = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
    .split(""),
);
const GSM7_EXT = new Set("^{}\\[~]|€".split(""));

function isGsm7(s: string): boolean {
  for (const ch of s) if (!GSM7.has(ch) && !GSM7_EXT.has(ch)) return false;
  return true;
}
function segCount(s: string): number {
  const len = s.length; // approximate; GSM extended chars count 2 but seeded copy avoids them
  if (isGsm7(s)) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

Deno.test("seeded cancellation SMS stays GSM-7 and fits ≤2 segments when fully rendered", () => {
  const rendered = renderTemplate(SMS_TEMPLATE, {
    first_name: "Ada",
    previous_appointment_when: "Tuesday, July 21 during 9am - 11am",
    cancellation_feedback_line: buildCancellationFeedbackLine("schedule_conflict"),
    booking_link: "https://bluladderbid.lovable.app/",
  });
  assert(isGsm7(rendered), `contains non-GSM7 chars: ${rendered}`);
  assert(segCount(rendered) <= 2, `too many segments: ${segCount(rendered)} for ${rendered}`);
});
