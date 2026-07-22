import { describe, it, expect } from "vitest";
import { aggregateFunnel, type FunnelInputRow } from "./funnel";
import { classifyOutcome, type ConversationSnapshot } from "./outcomes";

const NOW = new Date("2026-07-22T12:00:00Z");
const OPTS = { now: NOW, inactivityThresholdMinutes: 60 };

function snap(o: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    id: o.id ?? "c",
    created_at: "2026-07-22T09:00:00Z",
    last_activity_at: "2026-07-22T11:00:00Z",
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
    turns: 4,
    ai_classification: null,
    ...o,
  };
}

function row(id: string, o: Partial<FunnelInputRow> & { snap?: Partial<ConversationSnapshot> } = {}): FunnelInputRow {
  const s = snap({ id, ...(o.snap ?? {}) });
  return {
    conversation_id: id,
    created_at: s.created_at,
    first_quote_at: null,
    first_booking_at: null,
    scheduling_started_at: null,
    slots_offered: 0,
    booking_confirmation_requested: false,
    qualified_lead: false,
    human_escalated: false,
    turns: s.turns,
    snapshot: s,
    outcome: classifyOutcome(s, OPTS),
    ...o,
  } as FunnelInputRow;
}

describe("aggregateFunnel", () => {
  const range = {
    start: new Date("2026-07-22T00:00:00Z"),
    end: new Date("2026-07-23T00:00:00Z"),
  };

  it("(4) counts a single booking once", () => {
    const r = row("c1", {
      qualified_lead: true,
      first_quote_at: "2026-07-22T09:30:00Z",
      scheduling_started_at: "2026-07-22T09:45:00Z",
      first_booking_at: "2026-07-22T10:00:00Z",
      snap: {
        bookings: [{ id: "b1", status: "confirmed", created_at: "2026-07-22T10:00:00Z" }],
      },
    });
    const dup = { ...r }; // same conversation
    const res = aggregateFunnel([r, dup], range);
    expect(res.counts.bookings_completed).toBe(1);
    expect(res.rates.ai_only_booking_rate).toBe(1);
    expect(res.rates.human_assisted_booking_rate).toBe(0);
  });

  it("(6) date-range aggregation works", () => {
    const inside = row("c-in", {
      qualified_lead: true,
      first_quote_at: "2026-07-22T09:30:00Z",
    });
    const outside = row("c-out", {
      created_at: "2026-07-01T09:00:00Z",
      snap: { created_at: "2026-07-01T09:00:00Z" },
    });
    const res = aggregateFunnel([inside, outside], range);
    expect(res.counts.new_conversations).toBe(1);
    expect(res.counts.quotes_produced).toBe(1);
    expect(res.rates.conversation_to_quote).toBe(1);
  });

  it("bookings receive deterministic booked outcomes in the funnel counts", () => {
    const r = row("c1", {
      first_booking_at: "2026-07-22T10:00:00Z",
      snap: {
        bookings: [{ id: "b1", status: "scheduled", created_at: "2026-07-22T10:00:00Z" }],
      },
    });
    const res = aggregateFunnel([r], range);
    expect(res.outcomes.booked_automatically).toBe(1);
    expect(res.counts.bookings_completed).toBe(1);
  });

  it("median time-to-quote and time-to-booking are computed", () => {
    const rows = [
      row("c1", {
        first_quote_at: "2026-07-22T09:10:00Z", // +10m
        first_booking_at: "2026-07-22T10:00:00Z", // +60m
        snap: { bookings: [{ id: "b1", status: "confirmed", created_at: "2026-07-22T10:00:00Z" }] },
      }),
      row("c2", {
        first_quote_at: "2026-07-22T09:30:00Z", // +30m
        first_booking_at: "2026-07-22T11:00:00Z", // +120m
        snap: { bookings: [{ id: "b2", status: "scheduled", created_at: "2026-07-22T11:00:00Z" }] },
      }),
    ];
    const res = aggregateFunnel(rows, range);
    expect(res.medians.time_to_quote_minutes).toBe(20);
    expect(res.medians.time_to_booking_minutes).toBe(90);
  });
});