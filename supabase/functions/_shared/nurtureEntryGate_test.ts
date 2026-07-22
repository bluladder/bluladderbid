import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  evaluateNurtureEntry,
  NURTURE_RECENT_BOOKING_WINDOW_DAYS,
  type NurtureEntryContext,
} from "./nurtureEntryGate.ts";

function ctx(overrides: Partial<NurtureEntryContext> = {}): NurtureEntryContext {
  return {
    activeAppointment: false,
    recentBooking: false,
    incompatibleEnrollment: false,
    emailSuppressed: false,
    hasEscalation: false,
    staffTakeoverActive: false,
    newerQuoteSupersedes: false,
    invalidCustomerRecord: false,
    ...overrides,
  };
}

Deno.test("evaluateNurtureEntry: fully clean → eligible", () => {
  const d = evaluateNurtureEntry(ctx());
  assertEquals(d.eligible, true);
  assertEquals(d.reason, "eligible");
});

Deno.test("evaluateNurtureEntry: invalid customer wins over all other flags", () => {
  const d = evaluateNurtureEntry(ctx({
    invalidCustomerRecord: true,
    activeAppointment: true,
    emailSuppressed: true,
  }));
  assertEquals(d.eligible, false);
  assertEquals(d.reason, "invalid_customer_record");
});

Deno.test("evaluateNurtureEntry: stable order — appointment before recent booking", () => {
  const d = evaluateNurtureEntry(ctx({ activeAppointment: true, recentBooking: true }));
  assertEquals(d.reason, "active_appointment");
});

Deno.test("evaluateNurtureEntry: recent booking blocks even without upcoming appt", () => {
  const d = evaluateNurtureEntry(ctx({ recentBooking: true }));
  assertEquals(d.reason, "recent_booking");
});

Deno.test("evaluateNurtureEntry: each remaining flag maps to its reason", () => {
  const cases: Array<[keyof NurtureEntryContext, string]> = [
    ["incompatibleEnrollment", "incompatible_campaign_active"],
    ["emailSuppressed", "email_suppressed"],
    ["hasEscalation", "escalation_pending"],
    ["staffTakeoverActive", "staff_takeover_active"],
    ["newerQuoteSupersedes", "newer_quote_supersedes"],
  ];
  for (const [flag, reason] of cases) {
    const d = evaluateNurtureEntry(ctx({ [flag]: true } as Partial<NurtureEntryContext>));
    assertEquals(d.eligible, false, `${flag} should block`);
    assertEquals(d.reason, reason);
  }
});

Deno.test("recent-booking window is 14 days", () => {
  assertEquals(NURTURE_RECENT_BOOKING_WINDOW_DAYS, 14);
});