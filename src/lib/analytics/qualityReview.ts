// Quality-review signals + knowledge-gap grouping/approval logic.
//
// Pure TypeScript. Persistence and admin UI are layered separately.

import type { Outcome } from "./outcomes";

export const REVIEW_SIGNALS = [
  "ai_no_answer",
  "low_confidence_classification",
  "repeated_question",
  "tool_failure",
  "tool_loop",
  "unexpected_escalation",
  "customer_frustration",
  "quote_stalled",
  "booking_intent_unfinished",
  "human_correction",
  "complaint_billing_damage",
] as const;
export type ReviewSignal = typeof REVIEW_SIGNALS[number];

export type ReviewMessage = {
  role: "user" | "assistant" | "tool" | "system" | "staff";
  content: string | null;
  tool_name?: string | null;
  tool_args?: string | null;
  tool_result?: { status?: string; error?: string | null; ok?: boolean } | null;
};

export type ReviewInput = {
  outcome: Outcome;
  outcome_confidence: number; // 0..1
  outcome_deterministic: boolean;
  messages: ReviewMessage[];
  had_quote: boolean;
  had_booking: boolean;
  staff_takeover: boolean;
  escalation_category?: string | null;
  booking_intent_detected: boolean;
  last_activity_age_minutes: number;
  inactivity_threshold_minutes: number;
};

const NO_ANSWER_PATTERNS = [
  /\bi\s+don'?t\s+know\b/i,
  /\bi'?m\s+not\s+sure\b/i,
  /\bcan(?:not|'t)\s+help\b/i,
  /\bunable to (?:answer|help|find)\b/i,
  /\bi\s+don'?t\s+have\s+that\s+information\b/i,
];

const FRUSTRATION_PATTERNS = [
  /\b(?:frustrated|angry|upset|ridiculous|useless|terrible|awful)\b/i,
  /\bnot\s+helpful\b/i,
  /\b(?:this|that)\s+is\s+(?:not|un)acceptable\b/i,
  /!{2,}/,
];

const COMPLAINT_PATTERNS = [
  /\b(?:damage|broken|refund|charged?\s+twice|billing|overcharge)\b/i,
  /\bproperty\s+damage\b/i,
];

const STOPWORDS = new Set([
  "the","a","an","is","are","do","does","can","could","would","you","your","i",
  "we","to","of","for","and","or","my","me","please","how","what","when","where",
  "much","it","that","this","in","on","with","about","have","has","will","much",
]);

/** Normalize a question into a stable topic key. Kept identical in spirit to
 *  the existing knowledgeGaps normalizer but exported for reuse and testing. */
export function normalizeQuestion(raw: string): string {
  const words = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const uniq = Array.from(new Set(words)).sort();
  return uniq.slice(0, 8).join(" ").trim();
}

export const GROUPING_CONFIDENCE_THRESHOLD = 0.7;

/** Confidence that a normalized question represents the same topic as another
 *  with the same normalized key. Fewer informative tokens = lower confidence.
 *  Low-confidence questions are kept as separate rows (not merged). */
export function groupingConfidence(normalized: string): number {
  const tokens = normalized ? normalized.split(" ").filter(Boolean) : [];
  if (tokens.length >= 3) return 0.9;
  if (tokens.length === 2) return 0.7;
  if (tokens.length === 1) return 0.4;
  return 0;
}

/** Decide the row-uniqueness key used to safely increment one topic. When
 *  confidence < threshold, we allocate a private key so distinct questions
 *  remain separate rows even if they happen to normalize identically. */
export function computeGroupingKey(
  normalized: string,
  confidence: number,
  fallbackId: string,
): { key: string; groupable: boolean } {
  if (normalized && confidence >= GROUPING_CONFIDENCE_THRESHOLD) {
    return { key: `grp:${normalized}`, groupable: true };
  }
  return { key: `sep:${fallbackId}`, groupable: false };
}

function hasRepeatedUserQuestion(msgs: ReviewMessage[]): boolean {
  const counts = new Map<string, number>();
  for (const m of msgs) {
    if (m.role !== "user" || !m.content) continue;
    const key = normalizeQuestion(m.content);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) >= 2) return true;
  }
  return false;
}

function hasToolLoop(msgs: ReviewMessage[]): boolean {
  // >=3 consecutive tool calls with the same tool_name + args
  let streak = 0;
  let last = "";
  for (const m of msgs) {
    if (m.role !== "tool" && !m.tool_name) continue;
    const sig = `${m.tool_name ?? ""}|${m.tool_args ?? ""}`;
    if (sig === last) {
      streak++;
      if (streak >= 3) return true;
    } else {
      streak = 1;
      last = sig;
    }
  }
  return false;
}

function hasToolFailure(msgs: ReviewMessage[]): boolean {
  return msgs.some((m) => {
    const r = m.tool_result;
    if (!r) return false;
    if (r.error) return true;
    if (r.ok === false) return true;
    if (typeof r.status === "string" && /error|fail/i.test(r.status)) return true;
    return false;
  });
}

function hasHumanCorrection(msgs: ReviewMessage[]): boolean {
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].role === "staff" && msgs[i - 1].role === "assistant") return true;
  }
  return false;
}

function matchesAny(msgs: ReviewMessage[], role: ReviewMessage["role"], patterns: RegExp[]): boolean {
  return msgs.some((m) =>
    m.role === role && !!m.content && patterns.some((p) => p.test(m.content!))
  );
}

/** Detect all quality signals present. Empty result = conversation is routine
 *  and should NOT enter the review queue. */
export function detectQualitySignals(input: ReviewInput): ReviewSignal[] {
  const out: ReviewSignal[] = [];
  const msgs = input.messages;

  if (matchesAny(msgs, "assistant", NO_ANSWER_PATTERNS)) out.push("ai_no_answer");

  if (!input.outcome_deterministic && input.outcome_confidence < 0.7) {
    out.push("low_confidence_classification");
  }

  if (hasRepeatedUserQuestion(msgs)) out.push("repeated_question");

  if (hasToolFailure(msgs) || input.outcome === "ai_or_tool_failure") {
    out.push("tool_failure");
  }

  if (hasToolLoop(msgs)) out.push("tool_loop");

  if (
    input.outcome === "human_escalation" &&
    input.escalation_category !== "human_request"
  ) {
    out.push("unexpected_escalation");
  }

  if (matchesAny(msgs, "user", FRUSTRATION_PATTERNS)) out.push("customer_frustration");

  const stale =
    input.last_activity_age_minutes >= input.inactivity_threshold_minutes;

  if (input.had_quote && !input.had_booking && stale) {
    out.push("quote_stalled");
  }

  if (input.booking_intent_detected && !input.had_booking && stale) {
    out.push("booking_intent_unfinished");
  }

  if (hasHumanCorrection(msgs)) out.push("human_correction");

  const cat = (input.escalation_category ?? "").toLowerCase();
  if (
    ["complaint", "billing", "damage"].includes(cat) ||
    matchesAny(msgs, "user", COMPLAINT_PATTERNS)
  ) {
    out.push("complaint_billing_damage");
  }

  return Array.from(new Set(out));
}

/** Enqueue decision: any signal → review. Deterministic booked conversations
 *  with no signals do not enter the queue. */
export function shouldEnterReview(signals: ReviewSignal[]): boolean {
  return signals.length > 0;
}

// -----------------------------------------------------------------------------
// Knowledge-gap approval / versioning
// -----------------------------------------------------------------------------

export type GapApprovalDecision =
  | { kind: "create_new"; version: 1 }
  | { kind: "new_revision"; version: number; previous_version: number }
  | { kind: "blocked_existing_approved" };

/** Decide how to publish an approved gap answer.
 *  - No existing approved knowledge → create v1.
 *  - Existing approved knowledge + `replaceExisting=false` → BLOCKED (never auto-overwrite).
 *  - Existing approved knowledge + `replaceExisting=true` → new revision (n+1). */
export function decideGapApproval(opts: {
  existingApprovedVersion: number | null;
  replaceExisting: boolean;
}): GapApprovalDecision {
  if (opts.existingApprovedVersion == null) {
    return { kind: "create_new", version: 1 };
  }
  if (!opts.replaceExisting) {
    return { kind: "blocked_existing_approved" };
  }
  return {
    kind: "new_revision",
    previous_version: opts.existingApprovedVersion,
    version: opts.existingApprovedVersion + 1,
  };
}

/** Suggested draft answers must never be treated as published knowledge. */
export function isSuggestedAnswerPublishable(_suggested: string | null): false {
  return false;
}