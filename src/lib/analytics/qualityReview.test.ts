import { describe, it, expect } from "vitest";
import {
  computeGroupingKey,
  decideGapApproval,
  detectQualitySignals,
  groupingConfidence,
  isSuggestedAnswerPublishable,
  normalizeQuestion,
  shouldEnterReview,
  type ReviewInput,
} from "./qualityReview";

function base(o: Partial<ReviewInput> = {}): ReviewInput {
  return {
    outcome: "waiting_on_customer",
    outcome_confidence: 1,
    outcome_deterministic: true,
    messages: [],
    had_quote: false,
    had_booking: false,
    staff_takeover: false,
    escalation_category: null,
    booking_intent_detected: false,
    last_activity_age_minutes: 5,
    inactivity_threshold_minutes: 60,
    ...o,
  };
}

describe("detectQualitySignals", () => {
  it("(1) failed high-intent conversation enters review", () => {
    const input = base({
      outcome: "customer_inactive",
      outcome_deterministic: true,
      had_quote: true,
      booking_intent_detected: true,
      last_activity_age_minutes: 240,
      inactivity_threshold_minutes: 60,
      messages: [
        { role: "user", content: "Can I book Saturday?" },
        { role: "assistant", content: "Here are Saturday times." },
      ],
    });
    const sigs = detectQualitySignals(input);
    expect(sigs).toEqual(
      expect.arrayContaining(["quote_stalled", "booking_intent_unfinished"]),
    );
    expect(shouldEnterReview(sigs)).toBe(true);
  });

  it("(2) routine successful booking does NOT enter review", () => {
    const input = base({
      outcome: "booked_automatically",
      had_quote: true,
      had_booking: true,
      messages: [
        { role: "user", content: "I'd like a house wash." },
        { role: "assistant", content: "Great — here are your options." },
        { role: "user", content: "Book Saturday at 9am please." },
        { role: "assistant", content: "Confirmed for Saturday 9am." },
      ],
    });
    expect(detectQualitySignals(input)).toEqual([]);
    expect(shouldEnterReview(detectQualitySignals(input))).toBe(false);
  });

  it("AI no-answer surfaces the signal", () => {
    const sigs = detectQualitySignals(base({
      messages: [
        { role: "user", content: "Do you clean skylights?" },
        { role: "assistant", content: "I'm not sure about that." },
      ],
    }));
    expect(sigs).toContain("ai_no_answer");
  });

  it("tool failure short-circuits into review", () => {
    const sigs = detectQualitySignals(base({
      messages: [
        { role: "tool", content: null, tool_name: "get_slots",
          tool_result: { ok: false, error: "provider_timeout" } },
      ],
    }));
    expect(sigs).toContain("tool_failure");
  });

  it("tool loop detected", () => {
    const sigs = detectQualitySignals(base({
      messages: [
        { role: "tool", content: null, tool_name: "get_slots", tool_args: "{}" },
        { role: "tool", content: null, tool_name: "get_slots", tool_args: "{}" },
        { role: "tool", content: null, tool_name: "get_slots", tool_args: "{}" },
      ],
    }));
    expect(sigs).toContain("tool_loop");
  });

  it("unexpected escalation vs customer-requested handoff", () => {
    expect(detectQualitySignals(base({
      outcome: "human_escalation",
      escalation_category: "damage",
    }))).toContain("unexpected_escalation");
    expect(detectQualitySignals(base({
      outcome: "human_escalation",
      escalation_category: "human_request",
    }))).not.toContain("unexpected_escalation");
  });

  it("low-confidence AI classification is flagged", () => {
    const sigs = detectQualitySignals(base({
      outcome: "unknown",
      outcome_deterministic: false,
      outcome_confidence: 0.4,
    }));
    expect(sigs).toContain("low_confidence_classification");
  });

  it("complaint / damage keyword triggers complaint signal", () => {
    const sigs = detectQualitySignals(base({
      messages: [{ role: "user", content: "Your crew caused property damage to our siding." }],
    }));
    expect(sigs).toContain("complaint_billing_damage");
  });
});

describe("knowledge-gap grouping", () => {
  it("(4) repeated related questions collapse into one topic when confidence is sufficient", () => {
    const a = normalizeQuestion("How much does gutter cleaning cost per foot?");
    const b = normalizeQuestion("What is the cost of gutter cleaning per foot?");
    expect(a).toBe(b);
    const conf = groupingConfidence(a);
    expect(conf).toBeGreaterThanOrEqual(0.7);
    expect(computeGroupingKey(a, conf, "id1").groupable).toBe(true);
    expect(computeGroupingKey(a, conf, "id1").key)
      .toBe(computeGroupingKey(b, conf, "id2").key);
  });

  it("(5) low-confidence single-word questions remain separate rows", () => {
    const norm = normalizeQuestion("Skylights?");
    const conf = groupingConfidence(norm);
    expect(conf).toBeLessThan(0.7);
    const k1 = computeGroupingKey(norm, conf, "id1");
    const k2 = computeGroupingKey(norm, conf, "id2");
    expect(k1.groupable).toBe(false);
    expect(k1.key).not.toBe(k2.key);
  });
});

describe("approval / versioning", () => {
  it("(3) suggested answers are never publishable on their own", () => {
    expect(isSuggestedAnswerPublishable("Some AI draft"))
      .toBe(false);
  });

  it("first approval creates version 1", () => {
    expect(decideGapApproval({ existingApprovedVersion: null, replaceExisting: false }))
      .toEqual({ kind: "create_new", version: 1 });
  });

  it("does NOT auto-overwrite existing approved knowledge", () => {
    expect(decideGapApproval({ existingApprovedVersion: 3, replaceExisting: false }))
      .toEqual({ kind: "blocked_existing_approved" });
  });

  it("explicit replace bumps to next revision", () => {
    expect(decideGapApproval({ existingApprovedVersion: 3, replaceExisting: true }))
      .toEqual({ kind: "new_revision", version: 4, previous_version: 3 });
  });
});