// Deno unit tests for Phase 2B reschedule scoping + rendering.
// Pure-function tests — no network, no DB, no external side effects.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  filterEnrollmentsByObsoleteBookingVersion,
  buildAppointmentWhen,
  formatAppointmentDate,
} from "./index.ts";
import { renderTemplate } from "../_shared/sms.ts";
import { ALLOWED_EVENTS, STOP_EVENTS } from "../_shared/campaignEngine.ts";

Deno.test("booking_reschedule_requested + booking_rescheduled are allowlisted", () => {
  assert((ALLOWED_EVENTS as readonly string[]).includes("booking_reschedule_requested"));
  assert((ALLOWED_EVENTS as readonly string[]).includes("booking_rescheduled"));
});

Deno.test("booking_rescheduled stops earlier booking versions only", () => {
  assertEquals(STOP_EVENTS["booking_rescheduled"].scope, "reminders");
  const enrollments = [
    { id: "a", booking_id: "B1", booking_version: 1 },
    { id: "b", booking_id: "B1", booking_version: 2 },
    { id: "c", booking_id: "B1", booking_version: null }, // legacy
    { id: "d", booking_id: "B2", booking_version: 1 },    // different booking
    { id: "e", booking_id: null, booking_version: null }, // unlinked
  ];
  // Incoming reschedule for B1 → v2. Only v<2 for B1 are targets.
  const targets = filterEnrollmentsByObsoleteBookingVersion(enrollments, "B1", 2);
  assertEquals(targets.map((t) => t.id).sort(), ["a", "c"]);
});

Deno.test("reschedule confirmation SMS renders safely when arrival_window is missing", () => {
  const tpl = "Hi {{first_name}}, your BluLadder appointment has been rescheduled to {{appointment_when}}. View the updated details here: {{manage_link}}";
  const date = formatAppointmentDate("2026-07-21T15:00:00Z");
  const when = buildAppointmentWhen(date, "");
  const out = renderTemplate(tpl, {
    first_name: "Ada",
    appointment_when: when,
    manage_link: "https://bluladderbid.lovable.app/customer-portal",
  });
  // Never contains "undefined", "null", or a dangling "during ."
  assert(!/undefined|null|during \./.test(out));
  assert(out.includes("Tuesday, July 21"));
  assert(!out.includes(" during "));
});

Deno.test("idempotency key format is stable per booking_version", () => {
  const bookingId = "abc-123";
  const key = (v: number) => `booking_rescheduled:${bookingId}:v${v}`;
  assertEquals(key(2), "booking_rescheduled:abc-123:v2");
  assert(key(2) !== key(3), "different versions produce different keys");
});
