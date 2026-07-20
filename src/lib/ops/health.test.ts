import { describe, it, expect } from "vitest";
import { computeHealth } from "./health";

const NOW = new Date("2026-07-20T15:00:00Z");
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe("computeHealth", () => {
  it("counts today's quotes and bookings and computes conversion", () => {
    const m = computeHealth({
      now: NOW,
      conversations: [],
      quotes: [
        { id: "q1", status: "saved", saved_at: iso(-60_000), converted_at: null, superseded_at: null },
        { id: "q2", status: "saved", saved_at: iso(-60_000), converted_at: null, superseded_at: null },
        { id: "q3", status: "saved", saved_at: iso(-60_000), converted_at: null, superseded_at: iso(-30_000) },
      ],
      bookings: [
        { id: "b1", status: "confirmed", created_at: iso(-30_000), booking_completed_at: iso(-30_000), cancelled_at: null },
      ],
      sms: [],
    });
    expect(m.quotesToday).toBe(2);
    expect(m.bookingsToday).toBe(1);
    expect(m.conversionRate).toBe(0.5);
  });

  it("classifies AI vs human conversations and waiting bucket", () => {
    const m = computeHealth({
      now: NOW,
      quotes: [], bookings: [], sms: [],
      conversations: [
        { id: "a", staff_takeover_at: null, needs_attention: false, last_activity_at: iso(-1000), last_error: null, resolved: false, booking_status: "none" },
        { id: "b", staff_takeover_at: iso(-1000), needs_attention: true, last_activity_at: iso(-1000), last_error: null, resolved: false, booking_status: "scheduling" },
        { id: "c", staff_takeover_at: null, needs_attention: false, last_activity_at: iso(-1000), last_error: null, resolved: true, booking_status: "confirmed" },
      ],
    });
    expect(m.aiHandled).toBe(1);
    expect(m.humanEscalations).toBe(1);
    expect(m.waitingForResponse).toBe(1);
  });

  it("splits SMS/email delivery failures over last 24h", () => {
    const m = computeHealth({
      now: NOW,
      conversations: [], quotes: [], bookings: [],
      sms: [
        { id: "s1", channel: "sms",   status: "failed", message_kind: "campaign",     created_at: iso(-3600_000), sent_at: null, send_at: null, error: "x" },
        { id: "s2", channel: "email", status: "dlq",    message_kind: "transactional", created_at: iso(-3600_000), sent_at: null, send_at: null, error: "y" },
        { id: "s3", channel: "sms",   status: "sent",   message_kind: "campaign",     created_at: iso(-3600_000), sent_at: iso(-3500_000), send_at: null, error: null },
        { id: "s4", channel: "sms",   status: "failed", message_kind: "campaign",     created_at: iso(-25 * 60 * 60_000), sent_at: null, send_at: null, error: "old" },
      ],
    });
    expect(m.failedSms).toBe(1);
    expect(m.failedEmail).toBe(1);
    expect(m.failedDeliveryLast24h).toBe(2);
  });

  it("reports oldest pending queue age and campaign backlog", () => {
    const m = computeHealth({
      now: NOW,
      conversations: [], quotes: [], bookings: [],
      sms: [
        { id: "p1", channel: "sms", status: "pending", message_kind: "campaign", created_at: iso(-30 * 60_000), sent_at: null, send_at: iso(-30 * 60_000), error: null },
        { id: "p2", channel: "sms", status: "pending", message_kind: "transactional", created_at: iso(-5 * 60_000), sent_at: null, send_at: iso(-5 * 60_000), error: null },
      ],
    });
    expect(m.oldestQueuedAgeMinutes).toBe(30);
    expect(m.campaignQueueBacklog).toBe(1);
  });

  it("returns null oldest age when nothing is pending", () => {
    const m = computeHealth({
      now: NOW, conversations: [], quotes: [], bookings: [],
      sms: [{ id: "x", channel: "sms", status: "sent", message_kind: "transactional", created_at: iso(-1000), sent_at: iso(-500), send_at: null, error: null }],
    });
    expect(m.oldestQueuedAgeMinutes).toBeNull();
  });
});