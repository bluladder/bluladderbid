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

export function confirmationPrompt(phoneE164: string): string {
  return `I have this number ending in ${last4(phoneE164)}. Is this the best mobile number for your quote and appointment details?`;
}

export const REPROMPT_PREFERRED_NUMBER =
  "No problem — what's the best mobile number to reach you at for your quote and appointment details?";

export type ConfirmationReply = "confirmed" | "declined" | "unclear";

const YES = /\b(yes|yeah|yep|yup|correct|that('| i)?s (right|correct)|sure|please do|use (that|this)|works|good|ok|okay)\b/i;
const NO = /\b(no|nope|nah|not|different|another|other|change|update|use (a )?different|call me at|text me at)\b/i;

export function interpretConfirmation(utterance: string): ConfirmationReply {
  const s = (utterance ?? "").trim();
  if (!s) return "unclear";
  const isYes = YES.test(s);
  const isNo = NO.test(s);
  if (isYes && !isNo) return "confirmed";
  if (isNo && !isYes) return "declined";
  return "unclear";
}

/** Normalize an E.164 phone extracted from an utterance the caller spoke. */
export function normalizeSpokenPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return null;
}