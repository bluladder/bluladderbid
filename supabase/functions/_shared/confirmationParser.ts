// ============================================================================
// confirmationParser — pure, deterministic parser for a customer's SMS reply
// AFTER the AI has placed an 8-minute hold on a specific slot.
//
// PURE FUNCTION. No side effects, no I/O.
//
// Contract
//   input : customer's raw inbound SMS text.
//   output: one of
//     * status="confirmed"  — customer clearly said yes
//     * status="declined"   — customer clearly said no / stop / cancel
//     * status="unclear"    — ambiguous or unrelated content
//
// Confirmed phrases must be short and unambiguous. Anything that also implies
// changing the appointment (e.g. "yes but move it to 3pm") is DECLINED to a
// separate handler — we return `unclear` so the flow asks for a plain
// yes/no. This is intentional: Phase 6A only knows how to execute the exact
// held slot.
// ============================================================================

export type ConfirmationStatus = "confirmed" | "declined" | "unclear";

export interface ConfirmationParseResult {
  status: ConfirmationStatus;
  normalized: string;
  clarification_message: string | null;
}

const CONFIRM_PATTERNS: RegExp[] = [
  /^y$/i,
  /^ye+p*$/i,          // ye, yep, yeeep
  /^yes+$/i,
  /^yeah$/i,
  /^yup$/i,
  /^correct$/i,
  /^confirm(ed)?$/i,
  /^book( it)?$/i,
  /^lets? do it$/i,
  /^sounds? good$/i,
  /^looks? good$/i,
  /^that'?s? (fine|good|perfect|great)$/i,
  /^ok(ay)?$/i,
  /^perfect$/i,
  /^great$/i,
  /^👍+$/u,
  /^✅+$/u,
];

const DECLINE_PATTERNS: RegExp[] = [
  /^n$/i,
  /^no+$/i,
  /^nope$/i,
  /^cancel$/i,
  /^stop$/i,               // (also handled upstream as compliance)
  /^don'?t$/i,
  /^not (now|today|yet)$/i,
  /^wait$/i,
  /^hold on$/i,
  /^nevermind$/i,
  /^never mind$/i,
];

function normalize(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(/[.!?…]+$/u, "")   // trailing punctuation
    .replace(/\s+/g, " ");
}

export const CLARIFICATION_ASK =
  "Just reply YES to confirm this appointment, or NO if you'd like to pick a different time.";

export function parseConfirmationReply(text: string): ConfirmationParseResult {
  const normalized = normalize(text);
  if (!normalized) {
    return { status: "unclear", normalized, clarification_message: CLARIFICATION_ASK };
  }

  if (CONFIRM_PATTERNS.some((rx) => rx.test(normalized))) {
    return { status: "confirmed", normalized, clarification_message: null };
  }
  if (DECLINE_PATTERNS.some((rx) => rx.test(normalized))) {
    return { status: "declined", normalized, clarification_message: null };
  }
  return { status: "unclear", normalized, clarification_message: CLARIFICATION_ASK };
}