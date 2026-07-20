// ============================================================================
// bookingIntent — deterministic classifier for inbound SMS from campaign
// recipients. Pure, side-effect free, unit-testable.
//
// Precedence order (highest first) is critical:
//   1. STOP/START/HELP compliance keywords always win. A reply of "STOP" is
//      never a booking-intent even if the body also says "book". Compliance
//      handling in callrail-inbound-sms owns this branch and short-circuits
//      before the AI/booking path runs.
//   2. Explicit escalation categories (complaint, damage, billing dispute,
//      "talk to a person") route to human takeover rather than the AI. This
//      keeps unhappy or safety-relevant customers from being answered by an
//      automated reply.
//   3. Booking intent — a small allowlist of high-confidence booking phrases
//      plus a phrase-level match on "schedule me", "let's do it", etc.
//   4. Everything else falls through as an ordinary reply (pause automation,
//      let the AI/web channel take it from there).
//
// This module intentionally avoids AI. Intent classification for compliance
// and escalation must be deterministic and auditable; a misclassified STOP
// or complaint is a regulatory / trust problem, not just a UX problem.
// ============================================================================

export type InboundIntent =
  | { kind: "stop" }
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "escalation"; category: EscalationCategory }
  | { kind: "booking" }
  | { kind: "other" };

export type EscalationCategory =
  | "complaint"
  | "damage_or_safety"
  | "billing_dispute"
  | "human_request";

// Compliance keywords MUST be first-word matches, matching the existing
// classifyInbound() semantics in _shared/sms.ts. Do not broaden.
const STOP_FIRST_WORD = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt-out",
]);
const START_FIRST_WORD = new Set([
  "start", "unstop", "yes", "subscribe", "optin", "opt-in",
]);
const HELP_FIRST_WORD = new Set(["help", "info"]);

// Booking-intent phrases. Kept small on purpose — ambiguous replies must fall
// through to `other` so the AI (not this classifier) resolves them.
const BOOKING_PHRASES: RegExp[] = [
  /\bbook\s*it\b/i,
  /\bbook\s*me\b/i,
  /^\s*book\s*$/i,
  /\bschedule\s*me\b/i,
  /^\s*schedule\s*$/i,
  /\bi['\u2019]?m\s*ready\b/i,
  /\blet['\u2019]?s\s*(do\s*it|book|schedule|go)\b/i,
  /\byes[, ]+(let['\u2019]?s|book|schedule|do\s*it|please)\b/i,
  /\bready\s*to\s*(book|schedule)\b/i,
  /\bsign\s*me\s*up\b/i,
  /\bplease\s*(book|schedule)\b/i,
];

// Escalation categories. Each entry is a small allowlist of unambiguous
// phrases. Anything less clear falls through to `other` and lets the AI
// answer, keeping escalation exception-based.
const ESCALATION_PATTERNS: Array<{ category: EscalationCategory; pattern: RegExp }> = [
  { category: "damage_or_safety", pattern: /\b(damag(e|ed)|broken\s+window|leak|injur(y|ed)|hurt|fell|unsafe|hazard)\b/i },
  { category: "billing_dispute", pattern: /\b(overcharg(ed|e)|charged\s+twice|double\s*charged|refund|dispute|wrong\s+(amount|price|charge)|chargeback)\b/i },
  { category: "complaint", pattern: /\b(complain(t)?|terrible|awful|angry|unhappy|disappointed|furious|worst)\b/i },
  { category: "human_request", pattern: /\b(real\s+person|human|manager|owner|call\s+me|please\s+call|talk\s+to\s+(someone|a\s+person)|speak\s+to)\b/i },
];

function firstWord(body: string): string {
  const first = body.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return first.replace(/[^a-z-]/g, "");
}

export function classifyInboundIntent(body: string | null | undefined): InboundIntent {
  const raw = (body ?? "").toString();
  if (!raw.trim()) return { kind: "other" };

  // 1) STOP/HELP compliance keywords — always win, must be first word.
  //    START ("yes", "subscribe", etc.) is deferred until after booking
  //    intent so multi-word booking phrases like "yes, let's do it" are
  //    not mis-classified as an opt-in.
  const first = firstWord(raw);
  if (STOP_FIRST_WORD.has(first)) return { kind: "stop" };
  if (HELP_FIRST_WORD.has(first)) return { kind: "help" };

  // 2) Escalation categories — check before booking so "someone damaged my
  //    window, please book it" is treated as damage_or_safety, not booking.
  for (const { category, pattern } of ESCALATION_PATTERNS) {
    if (pattern.test(raw)) return { kind: "escalation", category };
  }

  // 3) Booking intent.
  for (const rx of BOOKING_PHRASES) {
    if (rx.test(raw)) return { kind: "booking" };
  }

  // 4) START keywords (opt-in re-subscribe) — only after booking so single
  //    word "yes" still classifies as start, but "yes, let's do it" is
  //    routed as booking.
  if (START_FIRST_WORD.has(first)) return { kind: "start" };

  // 5) Fall through — normal reply, let AI handle it.
  return { kind: "other" };
}

/**
 * Render the standard BOOK-IT auto-reply. Kept as a pure function so tests
 * can pin the copy and confirm no PII leaks into the URL. The link is a plain
 * quote-view URL keyed by quote UUID — no email/phone/name in the URL.
 */
export function renderBookingAutoReply(input: {
  firstName?: string | null;
  quoteLink: string;
}): string {
  const first = (input.firstName ?? "").trim();
  const greeting = first ? `Great, ${first}.` : "Great.";
  return `${greeting} I can help you get scheduled. You can review your quote and pick an available appointment here: ${input.quoteLink}. Or tell me what day generally works best and I'll show you the closest options. —Ben with BluLadder`;
}
