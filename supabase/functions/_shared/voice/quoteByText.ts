// ============================================================================
// quoteByText.ts — TRUTHFUL VOICE DELIVERY CONTRACT
//
// Incident 019fb423-7a5b-7990-98fe-6e7db8062f50: the assistant told the caller
// it had texted the quote. Nothing was ever enqueued — no customer record, no
// quote row, no customer-facing SMS. The only messages produced were internal
// escalation alerts, which are NOT a substitute for a customer quote link.
//
// Contract enforced here:
//   * The assistant may say the provider accepted the quote for delivery only
//     after the canonical customer-facing operation reports that exact state.
//     It may say delivered only after a delivery callback proves delivery.
//   * On failure or missing prerequisites it must say plainly that the text was
//     NOT sent, and either ask for the missing data or offer human follow-up.
//   * Internal escalation SMS must never be used to satisfy this intent.
// ============================================================================

import { parseSpokenEmail } from "./spokenEmail.ts";
import { formatCanonicalCurrency } from "./voiceCanonicalIntake.ts";
import { describeVoiceDelivery } from "./voiceDeliveryState.ts";

export type QuoteByTextOutcome =
  | "provider_accepted"
  | "queued"
  | "delivery_uncertain"
  | "cancelled"
  | "not_sent_no_firm_quote"
  | "not_sent_missing_phone"
  | "not_sent_missing_name"
  | "not_sent_missing_address"
  | "not_sent_missing_email"
  | "not_sent_delivery_unavailable"
  | "not_sent_delivery_failed";

export interface QuoteByTextPlan {
  /** Legacy transport flag: true only after provider acceptance. It does not
   * prove end-device delivery; `outcome` preserves that distinction. */
  sent: boolean;
  outcome: QuoteByTextOutcome;
  reply: string;
  event: string;
  /** Field to ask for next, when the blocker is missing data. */
  missingField: "phone" | "name" | "address" | "email" | null;
}

export interface QuoteDeliveryOperationResult {
  /** Legacy compatibility: true is treated as provider_accepted. */
  ok?: boolean;
  status?:
    | "queued"
    | "provider_accepted"
    | "retry_pending"
    | "uncertain"
    | "failed_terminal";
  reason?: string | null;
  attemptId?: string | null;
  providerMessageId?: string | null;
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
  /**
   * True only when the phone was confirmed through the canonical caller-ID
   * confirmation mechanism. A full-but-unconfirmed number is a question, never
   * a licence to deliver.
   */
  phoneConfirmed?: boolean;
  /** Verified, in-area service address for the priced property. */
  address?: string | null;
  addressEligible?: boolean;
  deliver?:
    | (() => Promise<QuoteDeliveryOperationResult>)
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
  if (args.phoneConfirmed === false) {
    // Full number, but never confirmed. Ask for confirmation instead of
    // texting a number we may have mis-heard.
    const last4 = args.phone.slice(-4);
    return {
      sent: false,
      outcome: "not_sent_missing_phone",
      event: "voice_quote_by_text_not_sent",
      missingField: "phone",
      reply:
        `I haven't sent that text yet — I want to be sure I have the right number first. Is it the one ending in ${last4}?`,
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
        `To be straight with you, I can't text the quote from this call yet — so no text has been sent. Your current price is ${
          formatCanonicalCurrency(args.total)
        }. I can have someone from our team follow up with the written quote, or we can book a time right now. Which would you prefer?`,
    };
  }
  let reason: string | null = null;
  try {
    const result = await args.deliver();
    const deliveryStatus = result?.status ??
      (result?.ok ? "provider_accepted" : "failed_terminal");
    if (deliveryStatus === "provider_accepted") {
      const delivery = describeVoiceDelivery({
        channel: "sms",
        status: "provider_accepted",
        attemptId: result?.attemptId ?? null,
        providerMessageId: result?.providerMessageId ?? null,
      });
      return {
        sent: true,
        outcome: "provider_accepted",
        event: "voice_quote_by_text_provider_accepted",
        missingField: null,
        reply: `${delivery.spoken} The quote total is ${
          formatCanonicalCurrency(args.total)
        }. Would you like me to check appointment times while you have me?`,
      };
    }
    if (deliveryStatus === "queued" || deliveryStatus === "retry_pending") {
      const delivery = describeVoiceDelivery({
        channel: "sms",
        status: deliveryStatus,
        attemptId: result?.attemptId ?? null,
        providerMessageId: result?.providerMessageId ?? null,
      });
      return {
        sent: false,
        outcome: "queued",
        event: "voice_quote_by_text_queued",
        missingField: null,
        reply: delivery.spoken,
      };
    }
    if (deliveryStatus === "uncertain") {
      const delivery = describeVoiceDelivery({
        channel: "sms",
        status: "uncertain",
        attemptId: result?.attemptId ?? null,
        providerMessageId: result?.providerMessageId ?? null,
      });
      return {
        sent: false,
        outcome: "delivery_uncertain",
        event: "voice_quote_by_text_uncertain",
        missingField: null,
        reply: delivery.spoken,
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
      `That text didn't go through, so you won't see it — I don't want to leave you waiting on something that isn't coming. Your current price is ${
        formatCanonicalCurrency(args.total)
      }. I can have a teammate follow up with the written quote, or we can pick an appointment time now.`,
  };
}

// ---------------------------------------------------------------------------
// Cross-turn continuation — the caller answers the outstanding question once.
//
// The pre-model rail asks for the one missing field and persists
// `quoteByText.pending`. On the NEXT turn the answer must be consumed here,
// deterministically, BEFORE delivery is retried: otherwise the rail re-runs
// with the same facts and loops on the same blocker forever.
// ---------------------------------------------------------------------------

const NAME_LEAD_IN =
  /^(?:it'?s|its|this is|my name'?s?\s*(?:is)?|name'?s?\s*(?:is)?|i'?m|i am|you can call me|call me)\s+/;

const ADDRESS_LEAD_IN =
  /^(?:it'?s|its|the address is|address is|my address is|the property is|it is|we'?re at|i'?m at|at)\s+/;

/** Commands / non-answers that must never be stored as a person's name. */
const NAME_STOPWORDS = new Set([
  "yes",
  "yeah",
  "no",
  "nope",
  "stop",
  "cancel",
  "text",
  "email",
  "quote",
  "price",
  "book",
  "booking",
  "schedule",
  "help",
  "hello",
  "hi",
  "thanks",
  "thank",
  "okay",
  "ok",
  "sure",
  "maybe",
  "later",
  "agent",
  "human",
]);

/**
 * Parse a short, plausible personal name from a voice turn: "Ben",
 * "Ben Millen", "my name is Ben Millen". Rejects emails, addresses, commands
 * and freeform sentences so a bad guess never becomes the customer identity.
 */
export function parseSpokenName(
  text: string | null | undefined,
): string | null {
  let t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("@") || /\bdot\s+com\b/.test(t)) return null;
  if (/\d/.test(t)) return null; // addresses, phone numbers, sqft answers
  t = t.replace(/[.,!?;:]+$/g, "").trim();
  t = t.replace(NAME_LEAD_IN, "").trim();
  if (!t) return null;
  const tokens = t.split(/\s+/);
  if (tokens.length === 0 || tokens.length > 3) return null;
  for (const tok of tokens) {
    if (!/^[a-z][a-z'’-]{0,23}$/.test(tok)) return null;
    if (NAME_STOPWORDS.has(tok)) return null;
  }
  return tokens
    .map((tok) => tok.charAt(0).toUpperCase() + tok.slice(1))
    .join(" ");
}

/**
 * Pull an address candidate out of the turn. Deliberately conservative: it only
 * hands a string to the canonical `validate_service_area` tool, which remains
 * the single authority on eligibility.
 */
export function parseSpokenAddressCandidate(
  text: string | null | undefined,
): string | null {
  const raw = (text ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  if (raw.includes("@")) return null;
  let t = raw;
  const leadIn = t.toLowerCase().match(ADDRESS_LEAD_IN);
  if (leadIn) t = t.slice(leadIn[0].length).trim();
  t = t.replace(/[.,;!?]+$/g, "").trim();
  if (!/\d/.test(t)) return null; // no street number → not an address answer
  if (t.split(" ").length < 2) return null;
  if (t.length < 6 || t.length > 160) return null;
  return t;
}

export type QuoteByTextContinuation =
  | { kind: "proceed" }
  | { kind: "contact"; email?: string; name?: string }
  | {
    kind: "validated_address";
    address: string;
    result: unknown;
    eligible: boolean;
    /** Present only when the validated address is NOT eligible. */
    plan?: QuoteByTextPlan;
  }
  | { kind: "reask"; plan: QuoteByTextPlan };

function reask(
  missingField: "phone" | "name" | "address" | "email",
  reply: string,
): QuoteByTextContinuation {
  return {
    kind: "reask",
    plan: {
      sent: false,
      outcome: `not_sent_missing_${missingField}` as QuoteByTextOutcome,
      event: "voice_quote_by_text_not_sent",
      missingField,
      reply,
    },
  };
}

/**
 * Consume this turn as the answer to the outstanding quote-by-text question.
 * Returns `reask` when the answer is unusable — the caller of this function
 * MUST then skip save-quote and send-sms entirely and keep the pending state.
 */
export async function resolveQuoteByTextContinuation(args: {
  missingField: "phone" | "name" | "address" | "email" | null;
  userMessage: string;
  phoneConfirmed: boolean;
  /** Canonical `validate_service_area` tool runner. */
  validateAddress?: (address: string) => Promise<unknown>;
}): Promise<QuoteByTextContinuation> {
  switch (args.missingField) {
    case "email": {
      const email = parseSpokenEmail(args.userMessage);
      if (email) return { kind: "contact", email };
      return reask(
        "email",
        "I still haven't sent anything — I didn't catch that email. Can you give it to me one more time, spelling the part before the at sign?",
      );
    }
    case "name": {
      const name = parseSpokenName(args.userMessage);
      if (name) return { kind: "contact", name };
      return reask(
        "name",
        "Nothing has been sent yet — I just need the name to put on the quote. What name should I use?",
      );
    }
    case "address": {
      const candidate = parseSpokenAddressCandidate(args.userMessage);
      if (!candidate || !args.validateAddress) {
        return reask(
          "address",
          "I haven't sent that text yet — I need the full service address. What's the street address, city and ZIP?",
        );
      }
      const result = await args.validateAddress(candidate);
      const status = (result as { status?: string } | null)?.status;
      if (status === "eligible") {
        return {
          kind: "validated_address",
          address: candidate,
          result,
          eligible: true,
        };
      }
      const reply = status === "incomplete_address"
        ? "Still nothing sent — I couldn't pin that address down. Can you give me the street number, street, city and ZIP?"
        : status === "manual_review_required"
        ? "I haven't sent that text — that address is just outside the area I can price automatically, so I'll have a teammate confirm it with you. Would that work?"
        : status === "ineligible"
        ? "I haven't sent that text — that address is outside our service area, so I can't save a quote for it. Is there another address I should check?"
        : "I haven't sent that text — I couldn't verify that address just now. Can you repeat the street address, city and ZIP?";
      return {
        kind: "validated_address",
        address: candidate,
        result,
        eligible: false,
        plan: {
          sent: false,
          outcome: "not_sent_missing_address",
          event: "voice_quote_by_text_not_sent",
          missingField: "address",
          reply,
        },
      };
    }
    case "phone": {
      if (args.phoneConfirmed) return { kind: "proceed" };
      return reask(
        "phone",
        "I haven't sent that text yet — I need to confirm the mobile number first. What's the best ten-digit number to text?",
      );
    }
    default:
      return { kind: "proceed" };
  }
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
