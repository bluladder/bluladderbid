// ============================================================================
// voiceFastPath.ts — deterministic voice-turn router.
//
// Classifies a single incoming user utterance for the voice channel into
// either a fast knowledge lane or the full authoritative orchestrator lane.
// The classifier is INTENTIONALLY conservative: any hint of a customer-
// specific decision, pricing, availability, address, booking, existing
// customer, or ambiguity falls through to the full orchestrator. Fail-closed.
//
// This is not a second AI brain. It only decides which lane runOrchestrator
// (or a bounded knowledge streamer that reuses the same system-prompt
// facts) is invoked in. All business rules, tool authority, and safety guards
// remain owned by runOrchestrator().
// ============================================================================

export type VoiceRoute =
  | { type: "fast_knowledge"; category: FastCategory }
  | { type: "full_orchestrator"; reason: FullReason };

export type FastCategory =
  | "service_list"
  | "service_area_general"
  | "company_info"
  | "service_explanation"
  | "rain_policy"
  | "guarantee_general"
  | "prep_general"
  | "hours_general";

export type FullReason =
  | "empty"
  | "pricing_intent"
  | "quote_intent"
  | "promotion_intent"
  | "address_or_customer_intent"
  | "availability_intent"
  | "booking_intent"
  | "recurring_plan_intent"
  | "transfer_or_callback_intent"
  | "ambiguous"
  | "too_long";

const MAX_FAST_LEN = 220;

// Any of these tokens (word-boundary insensitive for short forms) forces the
// full orchestrator. We do NOT try to be clever — clever == unsafe.
const FORCE_FULL_PATTERNS: { rx: RegExp; reason: FullReason }[] = [
  { rx: /\b(price|pricing|cost|quote|estimate|how much|charge|charges|fee|fees|deposit|invoice)\b/i, reason: "pricing_intent" },
  { rx: /\b(discount|promo|promotion|coupon|special deal|sale price)\b/i, reason: "promotion_intent" },
  { rx: /\b(plan|subscription|recurring|maintenance plan|quarterly|monthly)\b/i, reason: "recurring_plan_intent" },
  { rx: /\b(book|booking|schedule|reschedule|cancel|appointment|available|availability|opening|time slot|slot|when can|next available|next opening)\b/i, reason: "availability_intent" },
  { rx: /\b(yes,? book|go ahead and book|confirm(?:ed)? (?:the )?booking|book it)\b/i, reason: "booking_intent" },
  { rx: /\b(my address|my house|my home|my property|for my|at (\d|my)|zip code|street|avenue|drive|lane|road|blvd|boulevard)\b/i, reason: "address_or_customer_intent" },
  { rx: /\b(my account|my last|last time|previous (?:visit|service|appointment|quote)|order number|customer number)\b/i, reason: "address_or_customer_intent" },
  { rx: /\b(transfer|human|manager|representative|agent|call ?back|callback|talk to (?:someone|a person)|speak (?:to|with) (?:someone|a person|a human))\b/i, reason: "transfer_or_callback_intent" },
];

// Broad fast-path signals. Order matters: the FIRST match wins, and only
// after FORCE_FULL_PATTERNS has been checked.
const FAST_PATTERNS: { rx: RegExp; category: FastCategory }[] = [
  { rx: /\b(what|which)\s+(services|things|jobs)\s+(do you|does bluladder)\s+(offer|do|clean|provide)\b/i, category: "service_list" },
  { rx: /\bwhat do you (?:guys )?(do|clean|offer)\b/i, category: "service_list" },
  { rx: /\b(list|tell me about)\s+(?:your )?services\b/i, category: "service_list" },
  { rx: /\b(do you serve|do you work in|do you clean in|do you cover)\b/i, category: "service_area_general" },
  { rx: /\bwhere are you (?:guys )?(?:located|based)\b/i, category: "company_info" },
  { rx: /\b(who is bluladder|what is bluladder|about (?:your )?company|tell me about bluladder)\b/i, category: "company_info" },
  { rx: /\b(what is|explain|tell me about)\s+(soft ?wash|pressure wash(?:ing)?|window cleaning|gutter cleaning|roof cleaning|house wash(?:ing)?|christmas lights?)\b/i, category: "service_explanation" },
  { rx: /\b(rain|weather|storm|forecast).*?(policy|reschedul|delay|cancel)/i, category: "rain_policy" },
  { rx: /\b(guarantee|warranty|satisf(?:action|ied))\b/i, category: "guarantee_general" },
  { rx: /\b(prepare|preparation|do i need to|move (?:my )?(?:cars?|furniture|plants))\b/i, category: "prep_general" },
  { rx: /\b(hours|open|business hours|when are you open)\b/i, category: "hours_general" },
];

export function classifyVoiceRoute(userMessage: string): VoiceRoute {
  const raw = (userMessage ?? "").trim();
  if (!raw) return { type: "full_orchestrator", reason: "empty" };
  if (raw.length > MAX_FAST_LEN) return { type: "full_orchestrator", reason: "too_long" };
  for (const { rx, reason } of FORCE_FULL_PATTERNS) {
    if (rx.test(raw)) return { type: "full_orchestrator", reason };
  }
  for (const { rx, category } of FAST_PATTERNS) {
    if (rx.test(raw)) return { type: "fast_knowledge", category };
  }
  return { type: "full_orchestrator", reason: "ambiguous" };
}

/** Human-readable acknowledgement (spoken) for a genuinely slow branch. The
 *  language model is NOT permitted to invent acknowledgement timing — the
 *  adapter picks these deterministic phrases. Each is one short sentence. */
export function slowBranchAcknowledgement(reason: FullReason): string | null {
  switch (reason) {
    case "pricing_intent":
    case "quote_intent":
    case "promotion_intent":
      return "Absolutely — let me check that for you.";
    case "availability_intent":
      return "Let me check the schedule for you.";
    case "booking_intent":
      return "I can help with that. Let me pull up the next steps.";
    case "address_or_customer_intent":
      return "One moment while I check that.";
    case "recurring_plan_intent":
    case "transfer_or_callback_intent":
    case "ambiguous":
    case "too_long":
      return "Give me just a moment.";
    default:
      return null;
  }
}

/** The Vapi voice pipeline honors `<flush />` (and `<break time=...ms />`) to
 *  force early speech synthesis. Emit it in SSE deltas but strip it from any
 *  text used for analytics / persistence / disposition text. */
export const FLUSH_TAG = "<flush />";

/** Strip flush/break tags for any text stored, logged, or evaluated for
 *  disposition. Never store SSE control tags in conversation history. */
export function stripVoiceControlTags(text: string): string {
  return (text ?? "")
    .replace(/<flush\s*\/>/gi, "")
    .replace(/<break\s+time=[^>]*\/>/gi, "")
    .trim();
}
