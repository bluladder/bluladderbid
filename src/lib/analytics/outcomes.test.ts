import { describe, it, expect } from "vitest";
import {
  classifyOutcome,
  type ConversationSnapshot,
  CLASSIFIER_VERSION,
} from "./outcomes";

const NOW = new Date("2026-07-22T12:00:00Z");
const OPTS = { now: NOW, inactivityThresholdMinutes: 60 };

function base(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    id: "c1",
    created_at: "2026-07-22T10:00:00Z",
    last_activity_at: "2026-07-22T11:59:00Z",
    resolved: false,
    staff_takeover_at: null,
    booking_status: "none",
    bookings: [],
    has_quote: false,
    quote_declined: false,
    service_area_status: null,
    unsupported_scope: false,
    last_error: null,
    escalation_open: false,
    complaint: false,
    spam: false,
    turns: 3,
    ai_classification: null,
    ...overrides,
  };
}

describe("classifyOutcome", () => {
  it("(1) linked booking -> deterministic booked_automatically", () => {
    const r = classifyOutcome(
      base({ bookings: [{ id: "b1", status: "confirmed", created_at: "2026-07-22T11:30:00Z" }] }),
      OPTS,
    );
    expect(r.outcome).toBe("booked_automatically");
    expect(r.deterministic).toBe(true);
    expect(r.classifier_version).toBe(CLASSIFIER_VERSION);
  });

  it("(1b) booking after human takeover -> booked_after_human_assistance", () => {
    const r = classifyOutcome(
      base({
        staff_takeover_at: "2026-07-22T11:00:00Z",
        bookings: [{ id: "b1", status: "scheduled", created_at: "2026-07-22T11:30:00Z" }],
      }),
      OPTS,
    );
    expect(r.outcome).toBe("booked_after_human_assistance");
  });

  it("(2) explicit decline is never inactivity", () => {
    const r = classifyOutcome(
      base({
        quote_declined: true,
        last_activity_at: "2026-07-20T00:00:00Z", // very old
        has_quote: true,
      }),
      OPTS,
    );
    expect(r.outcome).toBe("explicit_decline");
  });

  it("(3) active conversation is not classified as inactive", () => {
    const r = classifyOutcome(
      base({ last_activity_at: "2026-07-22T11:55:00Z" }), // 5m old, < 60m
      OPTS,
    );
    expect(r.outcome).toBe("waiting_on_customer");
  });

  it("(5) provider failure -> ai_or_tool_failure (never abandonment)", () => {
    const r = classifyOutcome(
      base({
        last_error: "provider_timeout: ai_gateway 504",
        last_activity_at: "2026-07-19T00:00:00Z", // very old
      }),
      OPTS,
    );
    expect(r.outcome).toBe("ai_or_tool_failure");
  });

  it("out-of-area routes to outside_service_area", () => {
    const r = classifyOutcome(base({ service_area_status: "out_of_area" }), OPTS);
    expect(r.outcome).toBe("outside_service_area");
  });

  it("quote produced but stale -> quote_not_booked", () => {
    const r = classifyOutcome(
      base({
        has_quote: true,
        last_activity_at: "2026-07-21T00:00:00Z", // > threshold
      }),
      OPTS,
    );
    expect(r.outcome).toBe("quote_not_booked");
  });

  it("cold + no quote past threshold -> customer_inactive", () => {
    const r = classifyOutcome(
      base({ last_activity_at: "2026-07-21T00:00:00Z" }),
      OPTS,
    );
    expect(r.outcome).toBe("customer_inactive");
  });

  it("AI inference only used when nothing else matches", () => {
    const r = classifyOutcome(
      base({
        last_activity_at: "2026-07-22T11:59:59Z",
        ai_classification: null,
      }),
      OPTS,
    );
    expect(r.outcome).toBe("waiting_on_customer");
    expect(r.deterministic).toBe(true);
  });

  it("configurable inactivity threshold flips active/inactive", () => {
    const snap = base({ last_activity_at: "2026-07-22T11:30:00Z" }); // 30m old
    expect(classifyOutcome(snap, { now: NOW, inactivityThresholdMinutes: 60 }).outcome)
      .toBe("waiting_on_customer");
    expect(classifyOutcome(snap, { now: NOW, inactivityThresholdMinutes: 15 }).outcome)
      .toBe("customer_inactive");
  });
});