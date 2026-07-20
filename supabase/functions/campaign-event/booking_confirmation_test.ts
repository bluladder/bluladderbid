// Deno unit tests for Phase 2A booking-confirmation merge rendering.
// Pure-function tests — no network, no DB, no external side effects.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  filterEnrollmentsByQuoteJourney,
  formatAppointmentDate,
  buildAppointmentWhen,
  formatBookingTotal,
  safeLink,
  shortServiceAddress,
} from "./index.ts";
import { renderTemplate } from "../_shared/sms.ts";

const SMS_TEMPLATE =
  "Hi {{first_name}}, your BluLadder appointment is confirmed for {{appointment_when}}. Service: {{service}}. View or manage it here: {{manage_link}}";

Deno.test("formatAppointmentDate renders America/Chicago long-form and survives DST", () => {
  // 2026-07-21 15:00 UTC -> 10:00 CDT (Tuesday, July 21)
  assertEquals(formatAppointmentDate("2026-07-21T15:00:00Z"), "Tuesday, July 21");
  // Spring-forward boundary: 2026-03-08 morning US CDT begins
  assertEquals(formatAppointmentDate("2026-03-08T12:00:00Z"), "Sunday, March 8");
  // Fall-back boundary
  assertEquals(formatAppointmentDate("2026-11-01T12:00:00Z"), "Sunday, November 1");
  // Missing / invalid input -> empty (never "undefined"/"Invalid Date").
  assertEquals(formatAppointmentDate(null), "");
  assertEquals(formatAppointmentDate(""), "");
  assertEquals(formatAppointmentDate("not-a-date"), "");
});

Deno.test("buildAppointmentWhen never produces awkward 'during .' output", () => {
  assertEquals(buildAppointmentWhen("Tuesday, July 21", "8:00 AM – 10:00 AM"), "Tuesday, July 21 during 8:00 AM – 10:00 AM");
  assertEquals(buildAppointmentWhen("Tuesday, July 21", null), "Tuesday, July 21");
  assertEquals(buildAppointmentWhen("Tuesday, July 21", "   "), "Tuesday, July 21");
  assertEquals(buildAppointmentWhen("", "8-10 AM"), "8-10 AM");
  assertEquals(buildAppointmentWhen("", null), "");
});

Deno.test("formatBookingTotal returns empty string for zero/missing (never '$0')", () => {
  assertEquals(formatBookingTotal(1234), "$1,234");
  assertEquals(formatBookingTotal("899.5"), "$900");
  assertEquals(formatBookingTotal(0), "");
  assertEquals(formatBookingTotal(null), "");
  assertEquals(formatBookingTotal(undefined), "");
  assertEquals(formatBookingTotal("garbage"), "");
  assertEquals(formatBookingTotal(-50), "");
});

Deno.test("safeLink refuses non-absolute URLs and falls back", () => {
  const fallback = "https://bluladderbid.lovable.app/my-appointments";
  assertEquals(safeLink("https://bluladderbid.lovable.app/my-appointments?b=1", fallback), "https://bluladderbid.lovable.app/my-appointments?b=1");
  assertEquals(safeLink("javascript:alert(1)", fallback), fallback);
  assertEquals(safeLink("/relative", fallback), fallback);
  assertEquals(safeLink(null, fallback), fallback);
  assertEquals(safeLink(undefined, fallback), fallback);
  assertEquals(safeLink(42, fallback), fallback);
});

Deno.test("shortServiceAddress returns just the first line", () => {
  assertEquals(shortServiceAddress("123 Main St, Dallas, TX 75201"), "123 Main St");
  assertEquals(shortServiceAddress("123 Main St"), "123 Main St");
  assertEquals(shortServiceAddress(""), "");
  assertEquals(shortServiceAddress(null), "");
});

Deno.test("Booking confirmation SMS renders cleanly with full data", () => {
  const vars = {
    first_name: "Jamie",
    service: "Window Cleaning",
    appointment_when: buildAppointmentWhen(formatAppointmentDate("2026-07-21T15:00:00Z"), "8:00 AM – 10:00 AM"),
    manage_link: safeLink("https://bluladderbid.lovable.app/my-appointments?b=abc", "https://bluladderbid.lovable.app/my-appointments"),
  };
  const out = renderTemplate(SMS_TEMPLATE, vars);
  assert(out.includes("Jamie"));
  assert(out.includes("Tuesday, July 21 during 8:00 AM – 10:00 AM"));
  assert(out.includes("Window Cleaning"));
  assert(out.includes("https://bluladderbid.lovable.app/my-appointments?b=abc"));
  assert(!out.includes("{{"), "no unrendered placeholders");
  assert(!out.includes("undefined"));
  assert(!out.includes("during ."), "must not produce awkward 'during .' output");
});

Deno.test("Booking confirmation SMS renders cleanly when arrival_window is missing", () => {
  const vars = {
    first_name: "Jamie",
    service: "Pressure Washing",
    appointment_when: buildAppointmentWhen(formatAppointmentDate("2026-07-21T15:00:00Z"), null),
    manage_link: "https://bluladderbid.lovable.app/my-appointments",
  };
  const out = renderTemplate(SMS_TEMPLATE, vars);
  assert(out.includes("confirmed for Tuesday, July 21."));
  assert(!out.includes("during"), "no 'during' clause when window is missing");
});

Deno.test("Booking confirmation email renders without $0 when total is missing", () => {
  const body =
    "When: {{appointment_when}}\nEstimated total: {{booking_total}}\nManage: {{manage_link}}";
  const rendered = renderTemplate(body, {
    appointment_when: "Tuesday, July 21 during 8-10 AM",
    booking_total: formatBookingTotal(0), // missing / zero
    manage_link: "https://bluladderbid.lovable.app/my-appointments",
  });
  assert(!rendered.includes("$0"), "must never render $0 when total is unknown");
  assert(rendered.includes("Estimated total: \n") || rendered.match(/Estimated total: *\n/), "empty total line renders as blank");
});

Deno.test("booking_completed with quote_id stops decline win-back for same quote only", () => {
  // Simulates the new 'abandoned' scope now covering quote_declined too.
  const enrollments = [
    { id: "abandonA", event_name: "quote_abandoned", campaign_event_id: "evA1" },
    { id: "winbackA", event_name: "quote_declined", campaign_event_id: "evA2" },
    { id: "abandonB", event_name: "quote_abandoned", campaign_event_id: "evB1" },
  ];
  const events = [
    { id: "evA1", metadata: { quote_id: "quoteA" } },
    { id: "evA2", metadata: { quote_id: "quoteA" } },
    { id: "evB1", metadata: { quote_id: "quoteB" } },
  ];
  const stopA = filterEnrollmentsByQuoteJourney(enrollments, events, "quoteA");
  assertEquals(stopA.map((e) => e.id).sort(), ["abandonA", "winbackA"], "both A-side nurture journeys stop");
  const stopB = filterEnrollmentsByQuoteJourney(enrollments, events, "quoteB");
  assertEquals(stopB.map((e) => e.id), ["abandonB"], "quoteB is untouched");
});