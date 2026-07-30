// ============================================================================
// quoteByText.ts — TRUTHFUL VOICE DELIVERY CONTRACT
//
// Incident 019fb423-7a5b-7990-98fe-6e7db8062f50: the assistant told the caller
// it had texted the quote. Nothing was ever enqueued — no customer record, no
// quote row, no customer-facing SMS. The only messages produced were internal
// escalation alerts, which are NOT a substitute for a customer quote link.
//
// Contract enforced here:
//   * The assistant may say the quote was sent ONLY after the canonical
//     customer-facing quote-delivery operation reports success.
//   * On failure or missing prerequisites it must say plainly that the text was
//     NOT sent, and either ask for the missing data or offer human follow-up.
//   * Internal escalation SMS must never be used to satisfy this intent.
// ============================================================================

export type QuoteByTextOutcome =
  | "sent"
  | "cancelled"
  | "not_sent_no_firm_quote"
  | "not_sent_missing_phone"
  | "not_sent_missing_name"
  | "not_sent_missing_address"
  | "not_sent_missing_email"
  | "not_sent_delivery_unavailable"
  | "not_sent_delivery_failed";

export interface QuoteByTextPlan {
  /** True only when a real customer-facing send succeeded. */
  sent: boolean;
  outcome: QuoteByTextOutcome;
  reply: string;
  event: string;
  /** Field to ask for next, when the blocker is missing data. */
  missingField: "phone" | "name" | "address" | "email" | null;
}

/** Does the caller explicitly ask for the quote in writing? */
export function classifyQuoteByTextRequest(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  if (!/\b(text|txt|sms|message|send)\b/.test(t)) return false;
  return /\b(quote|price|estimate|bid|total|it|that|this|me)\b/.test(t);
}

/**
 * Did the caller withdraw a pending quote-by-text request? Checked BEFORE the
 * resume path so "never mind" clears the pending state instead of being read
 * as another answer to the outstanding question.
 */
export function classifyQuoteByTextCancellation(text: string): boolean {
  const t = (text ?? "").toLowerCase().replace(/[^a-z0-9\s']/g, " ");
  if (
    /\b(never\s*mind|nevermind|forget\s*(it|that)|no\s*thanks?|no\s*thank\s*you)\b/
      .test(t)
  ) return true;
  if (
    /\b(don'?t|do\s*not|stop|cancel|skip)\b[\s\w]{0,20}\b(text|txt|sms|message|send)\b/
      .test(t)
  ) return true;
  if (/\bcancel\s+the\s+(text|message)\b/.test(t)) return true;
  return false;
}

/** Truthful confirmation that a pending quote-by-text was abandoned. */
export function planQuoteByTextCancellation(): QuoteByTextPlan {
  return {
    sent: false,
    outcome: "cancelled",
    event: "voice_quote_by_text_cancelled",
    missingField: null,
    reply:
      "No problem — I have not sent any text, and I won't. What else can I help you with?",
  };
}

/**
 * Decide what may truthfully be said. `deliver` is the canonical
 * customer-facing quote-delivery operation; when it is not supplied the intent
 * resolves to an explicit "not sent" answer — never an optimistic claim.
 */
export async function planQuoteByTextResponse(args: {
  quoteIsFirm: boolean;
  total?: number | null;
  name?: string | null;
  phone?: string | null;
  phoneIsFullE164: boolean;
  /** Verified, in-area service address for the priced property. */
  address?: string | null;
  addressEligible?: boolean;
  deliver?:
    | (() => Promise<{ ok: boolean; reason?: string | null }>)
    | null;
}): Promise<QuoteByTextPlan> {
  if (!args.quoteIsFirm || !args.total) {
    return {
      sent: false,
      outcome: "not_sent_no_firm_quote",
      event: "voice_quote_by_text_not_sent",
      missingField: null,
      reply:
        "I haven't finished pricing this yet, so there's nothing to text you at the moment. Let's finish the quote first and then I can get it to you in writing.",
    };
  }
  if (!args.phoneIsFullE164 || !args.phone) {
    return {
      sent: false,
      outcome: "not_sent_missing_phone",
      event: "voice_quote_by_text_not_sent",
      missingField: "phone",
      reply:
        "I haven't sent that text yet — I need the full ten-digit mobile number to send it to. What's the best number?",
    };
  }
  if (!args.name || !args.name.trim()) {
    return {
      sent: false,
      outcome: "not_sent_missing_name",
      event: "voice_quote_by_text_not_sent",
      missingField: "name",
      reply:
        "I haven't sent that text yet — can I get your name first so the quote goes out correctly?",
    };
  }
  // A saved quote is attached to a real, in-area property. If the address is
  // missing or not confirmed eligible we ask for it instead of persisting a
  // quote against an unverified location.
  if (!args.address || !args.address.trim() || args.addressEligible !== true) {
    return {
      sent: false,
      outcome: "not_sent_missing_address",
      event: "voice_quote_by_text_not_sent",
      missingField: "address",
      reply:
        "I haven't sent that text yet — I need to confirm the service address for this quote first. What's the street address, city and ZIP?",
    };
  }
  if (!args.deliver) {
    return {
      sent: false,
      outcome: "not_sent_delivery_unavailable",
      event: "voice_quote_by_text_unavailable",
      missingField: null,
      reply:
        `To be straight with you, I can't text the quote from this call yet — so no text has been sent. Your price is about $${
          Math.round(args.total)
        }. I can have someone from our team follow up with the written quote, or we can book a time right now. Which would you prefer?`,
    };
  }
  let reason: string | null = null;
  try {
    const result = await args.deliver();
    if (result?.ok) {
      return {
        sent: true,
        outcome: "sent",
        event: "voice_quote_by_text_sent",
        missingField: null,
        reply: `Done — I've texted the quote of about $${
          Math.round(args.total)
        } to your number. Would you like me to check appointment times while you have me?`,
      };
    }
    reason = result?.reason ?? null;
  } catch (_e) { /* fall through to truthful failure */ }
  // Reason-aware truthful answers for the two blockers the caller can fix.
  if (reason === "email_unavailable") {
    return {
      sent: false,
      outcome: "not_sent_missing_email",
      event: "voice_quote_by_text_not_sent",
      missingField: "email",
      reply:
        "I haven't sent that text yet — to save the quote to your account I need an email address on file. What email should I use?",
    };
  }
  if (reason === "missing_address") {
    return {
      sent: false,
      outcome: "not_sent_missing_address",
      event: "voice_quote_by_text_not_sent",
      missingField: "address",
      reply:
        "I haven't sent that text yet — I need to confirm the service address for this quote first. What's the street address, city and ZIP?",
    };
  }
  return {
    sent: false,
    outcome: "not_sent_delivery_failed",
    event: "voice_quote_by_text_failed",
    missingField: null,
    reply:
      `That text didn't go through, so you won't see it — I don't want to leave you waiting on something that isn't coming. Your price is about $${
        Math.round(args.total)
      }. I can have a teammate follow up with the written quote, or we can pick an appointment time now.`,
  };
}

/** Strip false delivery claims from any model-authored voice reply when no
 *  customer-facing send actually succeeded this turn. */
export function guardDeliveryClaims(
  reply: string,
  deliverySucceeded: boolean,
): string {
  if (deliverySucceeded) return reply;
  const claims =
    /\b(?:i(?:'ve| have)?\s*(?:just\s*)?(?:sent|texted|emailed|shot)|(?:it|that|the quote|the estimate)\s*(?:is|has been|was)\s*(?:sent|texted|on its way)|sending (?:it|that|the quote) (?:now|over)|you(?:'ll| will) (?:get|receive|see) (?:a|the) (?:text|message|email) (?:shortly|now|in a moment))/i;
  if (!claims.test(reply ?? "")) return reply;
  return "Just so I'm accurate: I haven't sent anything yet. I can have a teammate follow up with the written quote, or we can pick an appointment time right now — which would you like?";
}
