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

import {
  computeRequired,
  type QuoteSession,
  sessionInputsKey,
} from "../../quoteSession.ts";
import { hasUsableFact } from "../hasUsableFact.ts";
import { missingResidentialBookingFields } from "../intakeSchemas.ts";
import type { RequiredField, WorkflowAction } from "../types.ts";
// Runtime-neutral Sales Engine shared contract — see packages/sales-engine/README.md.
// The edge-function bundler cannot reach out of the supabase/ tree, so we ship
// a mirror at supabase/functions/_shared/salesEngine/. Keep the two in sync;
// the packages/ copy remains the source of truth for web/tests.
import {
  nextResidentialQuestion,
  RESIDENTIAL_INTAKE_BY_ID,
  RESIDENTIAL_INTAKE_PRIORITY,
  type ResidentialIntakeFieldId,
} from "../../salesEngine/residentialQuoteManifest.ts";
import { evaluateQuoteIntake } from "../../salesEngine/quoteIntakeContract.ts";
import {
  mayPresentWholeHomeWindowPackageOptions,
  nextExpressPrePriceField,
} from "../../voice/voicePolicy.ts";

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
 * never speaks; never invents pricing. */
export function decideResidentialQuoteAction(
  session: QuoteSession,
  _pricingEngineMissing: readonly string[] | null = null,
): WorkflowAction {
  const captured = capturedIds(session);
  const engineMissingForIntake = computeRequired(session.fields);

  if (session.fields.voiceJourney?.policyVersion === "voice-express-v1") {
    const expressField = nextExpressPrePriceField(session);
    if (expressField) return ask(expressField as ResidentialIntakeFieldId);

    // The owner-approved express defaults remain visible as
    // approved_business_default provenance. They do not require a synthetic
    // customer recap; only the voice express workflow may suppress this one
    // legacy blocker. All actual missing fields and modifiers still block.
    const packageOptionsPending = !session.fields.windowCleaningSides &&
      mayPresentWholeHomeWindowPackageOptions(session);
    const expressMissing = engineMissingForIntake.filter((field) =>
      field !== "priceChangingAssumptionConfirmation" &&
      !(packageOptionsPending && field === "windowCleaningSides")
    );
    if (expressMissing.length > 0) {
      return { kind: "handoff", reason: "unsupported_service" };
    }
  } else {
    const preQuote = nextResidentialQuestion({
      captured,
      engineMissing: engineMissingForIntake,
      channel: session.channel === "chat" ? "web" : session.channel,
      additionallyRequired: wantsResidentialWindow(session)
        ? ["windowCleaningCondition"]
        : [],
    });
    if (preQuote) return ask(preQuote.id);
    if (engineMissingForIntake.length > 0) {
      return { kind: "handoff", reason: "unsupported_service" };
    }
  }
  const intake = evaluateQuoteIntake(
    session.fields as unknown as Record<string, unknown>,
  );

  // Ready to price. A manual-review or owner-decision service may coexist with
  // independently firm services. Let the engine calculate once before applying
  // product-policy disposition so firm portions are not discarded.
  if (session.quoteStatus === "none") {
    const hasAutomatedResidentialPortion = intake.services.some((service) =>
      service !== "commercial_window_bid" &&
      service !== "partial_window_cleaning"
    );
    if (hasAutomatedResidentialPortion) return { kind: "calculate_price" };
    return {
      kind: "handoff",
      reason: intake.services.includes("commercial_window_bid")
        ? "commercial_bid"
        : "unsupported_service",
    };
  }
  if (session.quoteStatus === "error") {
    return { kind: "handoff", reason: "pricing_error" };
  }
  if (
    intake.manualReview.length > 0 || session.quoteStatus === "manual_review"
  ) {
    return {
      kind: "handoff",
      reason: intake.services.includes("commercial_window_bid")
        ? "commercial_bid"
        : "unsupported_service",
    };
  }
  if (intake.ownerDecisions.length > 0) {
    return { kind: "handoff", reason: "owner_decision_required" };
  }

  // Speak the authoritative quote before asking anything else. Email is not
  // required to speak a price.
  const quoteContext = session.fields.voiceJourney?.quoteContext;
  const spokenForCurrentInputs =
    quoteContext?.inputsKey === sessionInputsKey(session.fields) &&
    !!quoteContext.spokenAt;
  if (!spokenForCurrentInputs && session.lastStep !== "priced_spoken") {
    return { kind: "speak_price" };
  }

  // Post-quote collection remains separate from the pricing critical path.
  if (!session.bookingReady) {
    const nextBook = nextResidentialQuestion({
      captured,
      engineMissing: [],
      additionallyRequired: ["contact_name", "contact_email", "address"],
      channel: session.channel === "chat" ? "web" : session.channel,
    });
    if (nextBook) return ask(nextBook.id);
    const legacyMissing = missingResidentialBookingFields(session.fields)
      .filter(
        (field) => !hasUsableFact(field, session),
      );
    if (legacyMissing.length === 0) return { kind: "offer_scheduling" };
    return ask(legacyMissing[0] as ResidentialIntakeFieldId);
  }

  return { kind: "offer_scheduling" };
}

function wantsResidentialWindow(session: QuoteSession): boolean {
  const services = session.fields.services ?? [];
  const isWindow = services.some(
    (service) => service === "windowCleaning" || service === "window_cleaning",
  );
  if (!isWindow) return false;
  const scope = session.fields.windowCleaningScope;
  if (scope === "commercial_custom" || scope === "partial") return false;
  if (session.fields.customerType === "commercial") return false;
  return true;
}
