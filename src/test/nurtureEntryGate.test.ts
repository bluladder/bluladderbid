import { describe, it, expect } from "vitest";
import {
  evaluateNurtureEntry,
  NURTURE_ENTRY_REASON_LABELS,
  NURTURE_RECENT_BOOKING_WINDOW_DAYS,
  type NurtureEntryContext,
  type NurtureEntryReason,
} from "@/lib/campaigns/nurtureEntryGate";

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

describe("evaluateNurtureEntry (Vitest mirror of Deno test)", () => {
  it("permits enrollment when every flag is clear", () => {
    const d = evaluateNurtureEntry(ctx());
    expect(d).toEqual({ eligible: true, reason: "eligible" });
  });

  it("invalid-customer wins over every other flag", () => {
    const d = evaluateNurtureEntry(ctx({
      invalidCustomerRecord: true,
      activeAppointment: true,
      recentBooking: true,
      emailSuppressed: true,
      hasEscalation: true,
    }));
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("invalid_customer_record");
  });

  it("check order is stable and documented", () => {
    const order: Array<[keyof NurtureEntryContext, NurtureEntryReason]> = [
      ["activeAppointment", "active_appointment"],
      ["recentBooking", "recent_booking"],
      ["incompatibleEnrollment", "incompatible_campaign_active"],
      ["emailSuppressed", "email_suppressed"],
      ["hasEscalation", "escalation_pending"],
      ["staffTakeoverActive", "staff_takeover_active"],
      ["newerQuoteSupersedes", "newer_quote_supersedes"],
    ];
    for (const [flag, reason] of order) {
      const d = evaluateNurtureEntry(ctx({ [flag]: true } as Partial<NurtureEntryContext>));
      expect(d.eligible).toBe(false);
      expect(d.reason).toBe(reason);
    }
  });

  it("every reason has a human-readable label for the admin UI", () => {
    const reasons: NurtureEntryReason[] = [
      "eligible", "invalid_customer_record", "active_appointment",
      "recent_booking", "incompatible_campaign_active", "email_suppressed",
      "escalation_pending", "staff_takeover_active", "newer_quote_supersedes",
    ];
    for (const r of reasons) {
      expect(NURTURE_ENTRY_REASON_LABELS[r]).toBeTruthy();
      expect(NURTURE_ENTRY_REASON_LABELS[r].length).toBeGreaterThan(4);
    }
  });

  it("recent-booking window is 14 days (both runtimes agree)", () => {
    expect(NURTURE_RECENT_BOOKING_WINDOW_DAYS).toBe(14);
  });
});
