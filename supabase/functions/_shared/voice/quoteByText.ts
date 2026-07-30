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
  | "not_sent_no_firm_quote"
  | "not_sent_missing_phone"
  | "not_sent_missing_name"
  | "not_sent_delivery_unavailable"
  | "not_sent_delivery_failed";

export interface QuoteByTextPlan {
  /** True only when a real customer-facing send succeeded. */
  sent: boolean;
  outcome: QuoteByTextOutcome;
  reply: string;
  event: string;
  /** Field to ask for next, when the blocker is missing data. */
  missingField: "phone" | "name" | null;
}

/** Does the caller explicitly ask for the quote in writing? */
export function classifyQuoteByTextRequest(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  if (!/\b(text|txt|sms|message|send)\b/.test(t)) return false;
  return /\b(quote|price|estimate|bid|total|it|that|this|me)\b/.test(t);
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
  deliver?: (() => Promise<{ ok: boolean }>) | null;
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
  } catch (_e) { /* fall through to truthful failure */ }
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
