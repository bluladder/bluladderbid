import { describe, it, expect } from "vitest";
import {
  classify, filterConversations, mergeTimeline, isAiHandling, isHumanTakeover,
  recommendNextAction, type ConversationRow, type TimelineEvent,
} from "./aggregate";

function row(over: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "c1", prospect_name: "Test", prospect_email: null, prospect_phone: null,
    channel: "chat", status: "active", conversation_state: "new",
    booking_status: "none", campaign_status: null, staff_takeover_at: null,
    resolved: false, needs_attention: false, callback_requested: false,
    last_activity_at: new Date().toISOString(), last_error: null,
    service_address: null, services_discussed: [], quote_result: null,
    ...over,
  };
}

describe("conversation aggregate", () => {
  it("classifies AI-handled active conversations", () => {
    expect(classify(row())).toContain("ai_handling");
  });

  it("human takeover disables AI classification", () => {
    const c = row({ staff_takeover_at: new Date().toISOString() });
    expect(isHumanTakeover(c)).toBe(true);
    expect(isAiHandling(c)).toBe(false);
    expect(classify(c)).toContain("escalated");
    expect(classify(c)).not.toContain("ai_handling");
  });

  it("failed delivery surfaces in filter", () => {
    expect(classify(row({ last_error: "sms_provider_5xx" }))).toContain("failed_delivery");
  });

  it("filter query matches on any known field", () => {
    const rows = [row({ id: "a", prospect_email: "alice@example.com" }),
                  row({ id: "b", prospect_email: "bob@example.com" })];
    expect(filterConversations(rows, "all", "alice").map(r => r.id)).toEqual(["a"]);
  });

  it("bucket filter narrows correctly", () => {
    const rows = [row({ id: "a" }),
                  row({ id: "b", staff_takeover_at: new Date().toISOString() })];
    expect(filterConversations(rows, "escalated").map(r => r.id)).toEqual(["b"]);
  });

  it("recommendNextAction reflects state", () => {
    expect(recommendNextAction(row({ callback_requested: true }))).toMatch(/Call/);
    expect(recommendNextAction(row({ booking_status: "confirmed" }))).toMatch(/confirmed/);
    expect(recommendNextAction(row({ staff_takeover_at: new Date().toISOString() })))
      .toMatch(/staff|release/i);
  });

  it("mergeTimeline sorts events chronologically across sources", () => {
    const e = (id: string, ts: string, ch: TimelineEvent["channel"]): TimelineEvent => ({
      id, ts, channel: ch, direction: "in", actor: "test", body: id,
    });
    const merged = mergeTimeline(
      [e("chat1", "2026-07-20T10:00:00Z", "chat")],
      [e("sms1",  "2026-07-20T09:00:00Z", "sms")],
      [e("mail1", "2026-07-20T11:00:00Z", "email")],
    );
    expect(merged.map(x => x.id)).toEqual(["sms1", "chat1", "mail1"]);
  });
});