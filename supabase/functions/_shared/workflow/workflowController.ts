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
    case "schedule_service":
      action = decideResidentialQuoteAction(session);
      break;
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
