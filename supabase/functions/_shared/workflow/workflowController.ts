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
import {
  confirmationPrompt,
  interpretConfirmation,
  normalizeSpokenPhone,
  REPROMPT_PREFERRED_NUMBER,
} from "./callerIdConfirmation.ts";
import { resolveCustomerByPhone } from "./customerResolver.ts";

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
  /** Best-effort E.164 caller ID (from provider ANI). */
  callerIdE164?: string | null;
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
      // Carry the canonical window-condition modifier through to the pricing
      // engine. Same field name/value the web booking flow persists.
      condition: f.condition,
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

// ---------------------------------------------------------------------------
// Rollout-gated wrapper: caller-ID confirmation + returning-customer lookup
// before delegating to the residential FSM. Post-pricing actions are the
// caller's responsibility (see voice-llm-adapter/index.ts, which delegates
// them to the legacy orchestrator so pricing/scheduling continue to work).
// ---------------------------------------------------------------------------

export type ControllerPreAction =
  | { kind: "ask_confirm_caller_id"; last4: string; spoken: string }
  | { kind: "ask_preferred_phone"; spoken: string }
  | { kind: "ask_disambiguator"; spoken: string }
  | { kind: "greet_returning"; firstName: string; spoken: string }
  | { kind: "delegate_legacy" }
  | { kind: "fsm"; action: WorkflowAction; spoken: string };

export interface ControllerTurnResult {
  pre: ControllerPreAction;
  sessionId: string;
  sessionPatch: Record<string, unknown>;
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Spoken text for a decided FSM action. Pricing/scheduling actions return
 *  empty spoken text — the caller is expected to `delegate_legacy` for those
 *  so the existing orchestrator handles tool invocation and wording. */
function speakForFsm(action: WorkflowAction): string {
  switch (action.kind) {
    case "ask":
      return action.prompt;
    case "handoff":
      return "Let me get one of our team members to help you with that. Can I text you back at this number?";
    case "end":
      return "Thanks for calling BluLadder — have a great day.";
    default:
      return "";
  }
}

/** True when the FSM action needs the legacy orchestrator (pricing, quoting,
 *  scheduling, booking). The controller does not implement those in this
 *  slice; delegating preserves current production behavior. */
function isDelegated(action: WorkflowAction): boolean {
  switch (action.kind) {
    case "calculate_price":
    case "speak_price":
    case "offer_scheduling":
    case "collect_address_for_booking":
    case "fetch_availability":
    case "offer_slots":
    case "confirm_slot":
    case "book_dry_run":
    case "book_real":
    case "confirm_result":
      return true;
    default:
      return false;
  }
}

export async function runControllerTurn(
  input: ControllerInput,
): Promise<ControllerTurnResult> {
  const session = await reloadSession(input.supabase, {
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    channel: input.channel,
    phone: input.phone,
    email: input.email,
  });
  const f = session.fields;
  const sessionPatch: Record<string, unknown> = {};
  const patchFields = (p: Record<string, unknown>) => {
    sessionPatch.fields = { ...(sessionPatch.fields as Record<string, unknown> ?? f), ...p };
  };
  const patchStatus = (p: Record<string, string>) => {
    sessionPatch.field_status = { ...(sessionPatch.field_status as Record<string, string> ?? session.fieldStatus), ...p };
  };

  // Step 1: caller-ID confirmation dance (only when we have an ANI and no
  // confirmed phone yet). Never speaks the full number.
  const havePhone = !!f.phone && (session.fieldStatus.phone === "captured" || session.fieldStatus.phone === "verified");
  if (!havePhone && input.callerIdE164) {
    const status = f.callerIdConfirmationStatus;
    if (!status) {
      // First time: propose the caller ID for confirmation.
      patchFields({
        callerIdConfirmationStatus: "pending",
        callerIdProposedE164: input.callerIdE164,
      });
      const last4 = digits(input.callerIdE164).slice(-4);
      return {
        sessionId: session.id,
        sessionPatch,
        pre: { kind: "ask_confirm_caller_id", last4, spoken: confirmationPrompt(input.callerIdE164) },
      };
    }
    if (status === "pending") {
      const reply = interpretConfirmation(input.utterance);
      if (reply === "confirmed") {
        const proposed = f.callerIdProposedE164 || input.callerIdE164;
        patchFields({
          phone: proposed,
          callerIdConfirmationStatus: "confirmed",
        });
        patchStatus({ phone: "verified" });
        // Fall through to returning-customer resolution below.
      } else if (reply === "declined") {
        patchFields({ callerIdConfirmationStatus: "declined" });
        return {
          sessionId: session.id,
          sessionPatch,
          pre: { kind: "ask_preferred_phone", spoken: REPROMPT_PREFERRED_NUMBER },
        };
      } else {
        const last4 = digits(input.callerIdE164).slice(-4);
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "ask_confirm_caller_id",
            last4,
            spoken: `Sorry, I didn't catch that. ${confirmationPrompt(input.callerIdE164)}`,
          },
        };
      }
    }
    if (status === "declined") {
      const parsed = normalizeSpokenPhone(input.utterance);
      if (parsed) {
        patchFields({ phone: parsed });
        patchStatus({ phone: "verified" });
      } else {
        return {
          sessionId: session.id,
          sessionPatch,
          pre: { kind: "ask_preferred_phone", spoken: REPROMPT_PREFERRED_NUMBER },
        };
      }
    }
  }

  // Step 2: returning-customer resolution — runs once per session after we
  // have a confirmed/verified phone number.
  const nowHasPhone =
    !!(sessionPatch.fields as Record<string, unknown> | undefined)?.phone ||
    (!!f.phone && (session.fieldStatus.phone === "captured" || session.fieldStatus.phone === "verified"));
  if (nowHasPhone && !f.returningCustomerResolved && !f.awaitingDisambiguator) {
    const phone =
      (sessionPatch.fields as Record<string, unknown> | undefined)?.phone as string ||
      f.phone!;
    const result = await resolveCustomerByPhone(input.supabase, phone);
    if (result.kind === "resolved") {
      const fn = result.customer.firstName?.trim() || null;
      patchFields({
        returningCustomerResolved: true,
        returningCustomerId: result.customer.customerId,
        ...(fn ? { name: fn } : {}),
      });
      if (fn) patchStatus({ name: "verified" });
      const greeting = fn
        ? `Hi ${fn}, welcome back! Which property or service are you calling about today?`
        : `Welcome back! Which property or service are you calling about today?`;
      return {
        sessionId: session.id,
        sessionPatch,
        pre: { kind: "greet_returning", firstName: fn || "", spoken: greeting },
      };
    }
    if (result.kind === "ambiguous") {
      patchFields({ awaitingDisambiguator: true });
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "ask_disambiguator",
          // Never reveal any stored address or email before the caller confirms it.
          spoken:
            "I want to make sure I pull up the right account — could you share the service address or the email on file so I can confirm?",
        },
      };
    }
    // not_found (including lookup failures): mark resolved so we don't retry.
    patchFields({ returningCustomerResolved: true });
  }

  // Step 3: hand to residential FSM.
  const workflow = classifyWorkflow(input.utterance, session);
  if (workflow === "cancel_or_reschedule") {
    return { sessionId: session.id, sessionPatch, pre: { kind: "fsm", action: { kind: "handoff", reason: "out_of_scope_workflow" }, spoken: speakForFsm({ kind: "handoff", reason: "out_of_scope_workflow" }) } };
  }
  // In this controlled rollout slice the controller ONLY owns the pre-quote
  // preface (caller-ID confirmation + returning-customer resolution +
  // greeting). Fact extraction, pricing, and scheduling remain the legacy
  // orchestrator's responsibility so real callers still complete an
  // end-to-end quote and booking. Handoff/end are the only FSM actions we
  // still voice locally, because they are terminal.
  const pricingMissing = await probePricingMissing(input.supabase, session);
  const action = decideResidentialQuoteAction(session, pricingMissing);
  if (action.kind === "handoff" || action.kind === "end") {
    return {
      sessionId: session.id,
      sessionPatch,
      pre: { kind: "fsm", action, spoken: speakForFsm(action) },
    };
  }
  return { sessionId: session.id, sessionPatch, pre: { kind: "delegate_legacy" } };
}

/** Persist the sessionPatch returned by runControllerTurn. Safe no-op when
 *  the patch is empty. */
export async function persistControllerPatch(
  supabase: SB,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!sessionId || !patch || Object.keys(patch).length === 0) return;
  try {
    await supabase.from("quote_sessions").update(patch).eq("id", sessionId);
  } catch {
    /* fail-safe: do not throw from persistence */
  }
}
