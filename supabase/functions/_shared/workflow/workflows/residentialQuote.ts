// ============================================================================
// workflows/residentialQuote.ts — deterministic FSM for residential quote.
//
// One reliable launch workflow: RESIDENTIAL QUOTE → PRICE → AVAILABILITY →
// BOOKING. Pure function of (session, utterance, extractorPatch) → action.
// The controller applies the returned action (persist, invoke tool, speak).
//
// Sequencing rules enforced here — never in the prompt:
//   1. Reload before decide (caller responsibility; see workflowSession).
//   2. Never ask a field where hasUsableFact(field) is true.
//   3. As soon as all pricing fields are present, return calculate_price.
//   4. Only offer scheduling after quoteStatus becomes firm/estimated.
//   5. City is captured for later serviceability but is NOT on the pricing
//      critical path (root cause of stall in call 019f8a84-...).
// ============================================================================

import type { QuoteSession } from "../../quoteSession.ts";
import { hasUsableFact } from "../hasUsableFact.ts";
import {
  RESIDENTIAL_QUESTION_PRIORITY,
  missingResidentialPricingFields,
  missingResidentialBookingFields,
} from "../intakeSchemas.ts";
import type { WorkflowAction, RequiredField } from "../types.ts";

function ask(field: RequiredField): WorkflowAction {
  const prompts: Record<RequiredField, string> = {
    // Each prompt names the exact canonical field it captures. Keep short,
    // confident, and warm — this is BluLadder's top CSR, not a chatbot.
    services: "Which service would you like priced today — window cleaning, house wash, gutters, or something else?",
    windowCleaningScope: "Got it. Is this every window on the home, or a specific count of windows?",
    squareFootage: "Do you know approximately how many square feet your home is?",
    windowCleaningSides: "Would you like exterior only, or full service inside and out?",
    stories: "How many stories is the home — one, two, or three?",
    city: "Which city is the home in?",
    address: "What's the street address for the visit?",
    contact_name: "Whose name should I put the appointment under?",
    contact_email: "What's the best email for the confirmation?",
    contact_phone: "And the best phone number for the crew?",
  };
  return { kind: "ask", field, prompt: prompts[field] };
}

/** Decide the next Action for a residential-quote turn. Sequencing only —
 *  never speaks; never invents pricing. */
export function decideResidentialQuoteAction(session: QuoteSession): WorkflowAction {
  // 1. Fill pricing fields first, in priority order, skipping any already known.
  const missingPricing = missingResidentialPricingFields(session.fields)
    .filter((f) => !hasUsableFact(f, session));
  if (missingPricing.length > 0) {
    const next = RESIDENTIAL_QUESTION_PRIORITY.find((f) => missingPricing.includes(f)) ?? missingPricing[0];
    return ask(next);
  }

  // 2. Ready to price. If we haven't priced yet, do so now.
  if (session.quoteStatus === "none") return { kind: "calculate_price" };
  if (session.quoteStatus === "error") return { kind: "handoff", reason: "pricing_error" };

  // 3. Speak price the first time we transition to estimated/firm.
  //    The controller decides speak-once via toolEvents; here we simply say
  //    "speak_price" whenever price is known but we haven't offered scheduling.
  if (!session.bookingReady) {
    const missingBook = missingResidentialBookingFields(session.fields)
      .filter((f) => !hasUsableFact(f, session));
    if (missingBook.length === 0) return { kind: "offer_scheduling" };
    if (session.lastStep !== "priced_spoken") return { kind: "speak_price" };
    const next = RESIDENTIAL_QUESTION_PRIORITY.find((f) => missingBook.includes(f)) ?? missingBook[0];
    return ask(next);
  }

  return { kind: "offer_scheduling" };
}
