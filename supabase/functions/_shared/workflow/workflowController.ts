// ============================================================================
// workflowController.ts — central turn entry point.
//
// Replaces model-directed sequencing with a deterministic pipeline:
//   1. reload session (defeats stale in-memory state)
//   2. extract facts from utterance
//   3. merge + persist facts
//   4. reload again
//   5. dispatch to workflow FSM; get typed Action
//   6. controller invokes tool for that Action (price, availability, book)
//   7. LLM produces natural wording ONLY for the resolved Action
//
// This scaffold declares the entry shape and the ordered stages. Turn B wires
// each stage to the real modules; the current call path in aiOrchestrator.ts
// remains authoritative until the controller is proven at parity in tests.
// ============================================================================

import type { QuoteSessionChannel } from "../quoteSession.ts";
import { reloadSession } from "./workflowSession.ts";
import { classifyWorkflow } from "./workflowRouter.ts";
import { decideResidentialQuoteAction } from "./workflows/residentialQuote.ts";
import type { TurnResult, WorkflowAction } from "./types.ts";
import { loadPricing } from "../loadPricing.ts";
import { calculateQuote, type QuoteInput } from "../pricingEngine.ts";
import type { QuoteSession } from "../quoteSession.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export interface ControllerInput {
  supabase: SB;
  conversationId: string;
  channel: QuoteSessionChannel;
  utterance: string;
  history: { role: "user" | "assistant"; content: string }[];
  sessionId?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Translate the current QuoteSession into a minimal QuoteInput so the
 * canonical pricing engine can tell us what is still missing. We never trust
 * this to compute a customer-facing price — that path stays in the
 * controller's `calculate_price` action.
 */
function sessionToQuoteInput(session: QuoteSession): QuoteInput {
  const f = session.fields;
  const services = f.services ?? [];
  const wants = (name: string) => services.includes(name);
  const sidesBoth = f.windowCleaningSides === "inside_and_outside";
  return {
    homeDetails: {
      squareFootage: (f.squareFootage as number) ?? undefined as unknown as number,
      stories: (f.stories as number) ?? undefined as unknown as number,
      windowCleaningType: sidesBoth ? "both" : "exterior",
    },
    additionalServices: {
      windowCleaning: wants("windowCleaning") || wants("window_cleaning"),
      houseWash: wants("houseWash") || wants("house_wash"),
      gutterCleaning: wants("gutterCleaning") || wants("gutter_cleaning"),
      roofCleaning: wants("roofCleaning") || wants("roof_cleaning"),
    },
    discount: null,
  };
}

/** Probe the canonical pricing engine for `missing[]`. Returns null if pricing
 *  config cannot be loaded (the FSM will fall back to its manifest tokens). */
async function probePricingMissing(
  supabase: SB,
  session: QuoteSession,
): Promise<string[] | null> {
  try {
    const loaded = await loadPricing(supabase);
    if (!loaded.ok || !loaded.pricing) return null;
    const result = calculateQuote(
      sessionToQuoteInput(session),
      loaded.pricing,
      loaded.ruleVersion,
    );
    return result.missing ?? [];
  } catch {
    return null;
  }
}

/** Turn B will fill this in. Returning the decided action + empty spoken text
 *  is enough for controller-level unit tests that assert sequencing without
 *  requiring the model. */
export async function runTurn(input: ControllerInput): Promise<TurnResult> {
  const t0 = Date.now();
  const session = await reloadSession(input.supabase, {
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    channel: input.channel,
    phone: input.phone,
    email: input.email,
  });
  const workflow = classifyWorkflow(input.utterance, session);
  let action: WorkflowAction;
  switch (workflow) {
    case "new_quote":
    case "schedule_service": {
      // Canonical engine is the sole authority on pricing readiness.
      const pricingMissing = await probePricingMissing(input.supabase, session);
      action = decideResidentialQuoteAction(session, pricingMissing);
      break;
    }
    case "cancel_or_reschedule":
      action = { kind: "handoff", reason: "out_of_scope_workflow" };
      break;
    case "general_inquiry":
    case "out_of_scope":
      action = { kind: "handoff", reason: "out_of_scope_workflow" };
      break;
  }
  return {
    action,
    spoken: "",
    toolEvents: [],
    latency: { total: Date.now() - t0 },
  };
}
