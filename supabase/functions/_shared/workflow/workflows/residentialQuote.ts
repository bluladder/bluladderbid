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
  missingResidentialBookingFields,
} from "../intakeSchemas.ts";
import type { WorkflowAction, RequiredField } from "../types.ts";
// Runtime-neutral Sales Engine shared contract — see packages/sales-engine/README.md
import {
  RESIDENTIAL_INTAKE_BY_ID,
  RESIDENTIAL_INTAKE_PRIORITY,
  fieldsForEngineMissing,
  nextResidentialQuestion,
  type ResidentialIntakeFieldId,
} from "../../../../../packages/sales-engine/intake/residentialQuoteManifest.ts";

function ask(field: ResidentialIntakeFieldId): WorkflowAction {
  const spec = RESIDENTIAL_INTAKE_BY_ID[field];
  return { kind: "ask", field: field as RequiredField, prompt: spec.prompt };
}

/** Which RequiredFields correspond to which intake ids (they match 1:1 today). */
function capturedIds(session: QuoteSession): ResidentialIntakeFieldId[] {
  const out: ResidentialIntakeFieldId[] = [];
  for (const id of RESIDENTIAL_INTAKE_PRIORITY) {
    if (hasUsableFact(id as RequiredField, session)) out.push(id);
  }
  return out;
}

/** Decide the next Action for a residential-quote turn. Sequencing only —
 *  never speaks; never invents pricing.
 *
 *  Readiness authority:
 *  - `pricingEngineMissing` is the canonical pricing engine's `missing[]`.
 *    When provided, THIS is the source of truth for whether pricing inputs
 *    are complete. Passing null means the caller has not yet probed the
 *    engine — we defer to the shared manifest's pricing tokens as a proxy.
 */
export function decideResidentialQuoteAction(
  session: QuoteSession,
  pricingEngineMissing: readonly string[] | null = null,
): WorkflowAction {
  const captured = capturedIds(session);

  // 1. Contact-first: name → phone → pricing intake. The next-question helper
  //    enforces manifest priority and skips already-captured fields.
  const engineMissingForIntake =
    pricingEngineMissing !== null
      ? pricingEngineMissing
      : // Fallback: ask for the always-required pricing fields when the caller
        // has not probed the engine yet. Kept intentionally minimal — the
        // canonical engine remains the sole authority once it responds.
        ["services", "squareFootage", "stories"];

  const preQuote = nextResidentialQuestion({
    captured,
    engineMissing: engineMissingForIntake,
  });
  if (preQuote) return ask(preQuote.id);

  // 2. Ready to price. If we haven't priced yet, do so now.
  if (session.quoteStatus === "none") return { kind: "calculate_price" };
  if (session.quoteStatus === "error") return { kind: "handoff", reason: "pricing_error" };

  // 3. Speak the authoritative quote before asking anything else. Email is
  //    NOT required to speak a price — it is required before booking or
  //    finalizing an unbooked proposal.
  if (session.lastStep !== "priced_spoken") return { kind: "speak_price" };

  // 4. Post-quote: collect email + address before offering scheduling.
  if (!session.bookingReady) {
    const nextBook = nextResidentialQuestion({
      captured,
      engineMissing: [],
      additionallyRequired: ["contact_email", "address"],
    });
    if (nextBook) return ask(nextBook.id);
    // Legacy fallback in case future required booking fields appear.
    const legacyMissing = missingResidentialBookingFields(session.fields).filter(
      (f) => !hasUsableFact(f, session),
    );
    if (legacyMissing.length === 0) return { kind: "offer_scheduling" };
    return ask(legacyMissing[0] as ResidentialIntakeFieldId);
  }

  return { kind: "offer_scheduling" };
}
