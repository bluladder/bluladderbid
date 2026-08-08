// ============================================================================
// callerIdConfirmation.ts — pure helpers for the caller-ID confirmation dance.
//
// Never speaks or exposes the full phone number. All customer-facing wording
// references only the last four digits. Yes/no interpretation is intentionally
// tight so that ambiguous replies re-prompt rather than silently persist.
// ============================================================================

export function last4(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return digits.slice(-4);
}

const PHONE_DIGIT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
] as const;

/** Speak only the last four digits, separated by deliberate TTS pauses. */
export function spokenLast4(phoneE164: string): string {
  return last4(phoneE164).split("").map((digit) =>
    PHONE_DIGIT_WORDS[Number(digit)]
  ).join(", ");
}

export function confirmationPrompt(phoneE164: string): string {
  return `I have this number ending in ${
    spokenLast4(phoneE164)
  }. Is this the best mobile number for your quote and appointment details?`;
}

export const REPROMPT_PREFERRED_NUMBER =
  "No problem — what's the best mobile number to reach you at for your quote and appointment details?";

export type ConfirmationReply = "confirmed" | "declined" | "unclear";

const YES =
  /\b(yes|yeah|yep|yup|correct|that('| i)?s (right|correct)|sure|please do|use (that|this)|works|good|ok|okay)\b/i;
const NO =
  /\b(no|nope|nah|not|different|another|other|change|update|use (a )?different|call me at|text me at)\b/i;

export function interpretConfirmation(utterance: string): ConfirmationReply {
  const s = (utterance ?? "").trim();
  if (!s) return "unclear";
  const isYes = YES.test(s);
  const isNo = NO.test(s);
  if (isYes && !isNo) return "confirmed";
  if (isNo && !isYes) return "declined";
  return "unclear";
}

const SPOKEN_PHONE_DIGITS: Readonly<Record<string, string>> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

function normalizeNanpDigits(value: string): string | null {
  if (value.length === 11 && value.startsWith("1")) return `+${value}`;
  if (value.length === 10) return `+1${value}`;
  return null;
}

/** Normalize an E.164 phone extracted from an utterance the caller spoke.
 *
 * Deepgram can deliver a phone as formatted digits, individual number words,
 * or a mixture of both. Only explicit digit tokens are accepted; ambiguous
 * homophones such as "to" and "for" are deliberately excluded.
 */
export function normalizeSpokenPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const formatted = normalizeNanpDigits(digits);
  if (formatted) return formatted;

  const tokens = raw.toLowerCase().match(/[a-z]+|\d+/g) ?? [];
  const spokenDigits = tokens.map((token) =>
    /^\d+$/.test(token) ? token : SPOKEN_PHONE_DIGITS[token] ?? ""
  ).join("");
  return normalizeNanpDigits(spokenDigits);
}
