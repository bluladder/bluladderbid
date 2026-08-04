// Deterministic, provider-neutral voice journey rules. The LLM may render an
// already-decided action, but it does not choose intent, freshness, destructive
// confirmation, or whether provider success may be claimed.

export const VOICE_OPENING =
  "Hi, thank you for calling BluLadder. Are you calling to get a quote, schedule an appointment, or do you have a specific question?";

export const PRICE_ASSURANCE =
  "This estimate assumes standard conditions. If we find anything unusual that would affect the price, we’ll discuss it with you before starting. Otherwise, we’ll honor the quoted price.";

export type VoiceJourneyIntent =
  | "new_quote"
  | "schedule"
  | "existing_quote"
  | "reschedule"
  | "cancel"
  | "question_or_memo"
  | "unclear";

export function classifyVoiceJourneyIntent(text: string): VoiceJourneyIntent {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value) return "unclear";
  if (/\b(cancel|call off|do not come|don'?t come)\b/.test(value)) {
    return "cancel";
  }
  if (
    /\b(reschedul|move|change)\b.*\b(appointment|visit|time|date)\b|\b(reschedul)\b/
      .test(value)
  ) {
    return "reschedule";
  }
  if (
    /\b(existing|old|previous|saved|my)\b.*\b(quote|estimate|bid)\b|\b(find|retrieve|pull up)\b.*\b(quote|estimate|bid)\b/
      .test(value)
  ) {
    return "existing_quote";
  }
  if (/\b(quote|estimate|price|pricing|how much|cost)\b/.test(value)) {
    return "new_quote";
  }
  if (
    /\b(schedule|book|appointment|availability|available|come out)\b/.test(
      value,
    )
  ) return "schedule";
  if (
    /\b(note|memo|message for|tell the (crew|team|technician)|left behind|touch[- ]?up|gate code|gate instruction)\b/
      .test(value)
  ) {
    return "question_or_memo";
  }
  if (
    /\b(question|hours|service area|do you|can you|what|when|where|why|how)\b/
      .test(value)
  ) {
    return "question_or_memo";
  }
  return "unclear";
}

export type ExplicitConfirmation = "confirmed" | "declined" | "unclear";

export function classifyExplicitConfirmation(
  text: string,
): ExplicitConfirmation {
  const value = String(text ?? "").trim().toLowerCase();
  if (
    /\b(no|nope|don'?t|do not|stop|never mind|not yet|cancel that)\b/.test(
      value,
    )
  ) return "declined";
  if (
    /^(yes|yes please|confirm|confirmed|i confirm|do it|go ahead|book it|cancel it|reschedule it|that is correct|that'?s correct)[.! ]*$/
      .test(value)
  ) {
    return "confirmed";
  }
  return "unclear";
}

export type VoiceRecoveryCode =
  | "quote_needs_clarification"
  | "manual_review"
  | "message_queued"
  | "message_unconfirmed"
  | "incomplete_address"
  | "ambiguous_address"
  | "outside_service_area"
  | "availability_unavailable"
  | "no_appointments"
  | "selected_slot_lost"
  | "booking_failed"
  | "quote_expired_or_superseded"
  | "reschedule_failed"
  | "cancellation_uncertain"
  | "human_follow_up";

export const VOICE_RECOVERY_LANGUAGE: Readonly<
  Record<VoiceRecoveryCode, string>
> = {
  quote_needs_clarification:
    "I need one more confirmed detail before I can give you an accurate price.",
  manual_review:
    "This request needs a quick review by our team before I can call the price firm.",
  message_queued:
    "I’ve queued that message to be sent. I can’t call it delivered until the provider confirms it.",
  message_unconfirmed:
    "I couldn’t confirm that the message was sent, so I’ve saved the quote and flagged it for follow-up.",
  incomplete_address:
    "I have part of the address and only need the missing detail.",
  ambiguous_address:
    "I found more than one possible address and need you to confirm the correct one.",
  outside_service_area:
    "I can’t confirm automatic service at that address, so I’ll preserve the request for our team to review.",
  availability_unavailable:
    "I can’t confirm live appointment times right now, so I won’t guess. I can preserve your request for follow-up.",
  no_appointments:
    "I checked the current schedule and did not find an available appointment in that window.",
  selected_slot_lost:
    "That time is no longer available. No appointment was created, and I can check the current options again.",
  booking_failed:
    "I couldn’t confirm the appointment, so it is not booked. I can try another current time or arrange follow-up.",
  quote_expired_or_superseded:
    "That quote is no longer current. I need to verify the latest inputs and price before we schedule from it.",
  reschedule_failed:
    "The appointment was not changed. Your existing time remains in place unless our team confirms otherwise.",
  cancellation_uncertain:
    "I can’t confirm the cancellation, so I won’t say the appointment is cancelled. I’ve flagged it for immediate follow-up.",
  human_follow_up:
    "I’ve preserved the details for a teammate to review and follow up.",
};

export interface QuoteIdentity {
  quoteSessionId: string;
  quoteId: string | null;
  inputsKey: string;
  pricingVersion: number | string | null;
  engineVersion: string | null;
  durationVersion: string | null;
  taxPolicyVersion: string | null;
}

export function quoteIdentityMatches(
  expected: QuoteIdentity,
  supplied: Partial<QuoteIdentity> | null | undefined,
): boolean {
  return !!supplied && supplied.quoteSessionId === expected.quoteSessionId &&
    supplied.inputsKey === expected.inputsKey &&
    supplied.quoteId === expected.quoteId &&
    supplied.pricingVersion === expected.pricingVersion &&
    supplied.engineVersion === expected.engineVersion &&
    supplied.durationVersion === expected.durationVersion &&
    supplied.taxPolicyVersion === expected.taxPolicyVersion;
}
