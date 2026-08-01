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
import { calculateQuote } from "../pricingEngine.ts";
import {
  computeRequired,
  mergeFields,
  sessionBookingInputsKey,
  sessionInputsKey,
  type QuoteSession,
} from "../quoteSession.ts";
import { quoteSessionFieldsToQuoteInput } from "../quoteSessionPricingAdapter.ts";
import {
  confirmationPrompt,
  interpretConfirmation,
  normalizeSpokenPhone,
  REPROMPT_PREFERRED_NUMBER,
} from "./callerIdConfirmation.ts";
import { resolveCustomerByPhone } from "./customerResolver.ts";
import {
  applyCanonicalVoiceAnswer,
  buildCanonicalPrePriceRecap,
  buildCanonicalPriceStatement,
  promptForCanonicalField,
} from "../voice/voiceCanonicalIntake.ts";
import {
  classifyExplicitConfirmation,
  classifyVoiceJourneyIntent,
  VOICE_OPENING,
  VOICE_RECOVERY_LANGUAGE,
} from "../voice/voiceJourneyContract.ts";
import { evaluateQuoteIntake } from "../salesEngine/quoteIntakeContract.ts";
import {
  resolveQuoteDisposition,
  type ProductPolicyStatus,
} from "../salesEngine/quoteDisposition.ts";
import { parseSlotSelection } from "../slotSelectionParser.ts";
import { runTool } from "../aiTools.ts";

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
      quoteSessionFieldsToQuoteInput(session.fields),
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
    case "existing_quote":
      action = { kind: "retrieve_existing_quote" };
      break;
    case "reschedule":
      action = { kind: "prepare_reschedule" };
      break;
    case "cancel":
      action = { kind: "prepare_cancel" };
      break;
    case "question_or_memo":
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
  | { kind: "ask_intent"; spoken: string }
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
    case "retrieve_existing_quote":
      return "I can help with an existing quote. First I need to verify the account without revealing any stored details.";
    case "retrieve_upcoming_bookings":
      return "I can help with an existing appointment. First I need to verify the account.";
    case "prepare_reschedule":
      return "I’ll verify the appointment and then check current times before anything is changed.";
    case "prepare_cancel":
      return "I’ll verify the exact appointment first. I will ask for a final confirmation before any cancellation is attempted.";
    case "record_field_memo":
      return "I’ll attach that note only after I verify the correct appointment.";
    default:
      return "";
  }
}

export async function runControllerTurn(
  input: ControllerInput,
): Promise<ControllerTurnResult> {
  let session = await reloadSession(input.supabase, {
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    channel: input.channel,
    phone: input.phone,
    email: input.email,
  });
  const sessionPatch: Record<string, unknown> = {};
  const capture = (next: QuoteSession, lastStep = next.lastStep ?? null) => {
    session = { ...next, lastStep };
    sessionPatch.fields = session.fields;
    sessionPatch.field_status = session.fieldStatus;
    sessionPatch.required_remaining = computeRequired(session.fields);
    sessionPatch.quote_status = session.quoteStatus;
    sessionPatch.booking_ready = session.bookingReady;
    sessionPatch.last_step = lastStep;
  };

  // The reason for the call is always established before callback, account,
  // quote, or appointment questions. It becomes sticky canonical journey
  // context and is not reclassified from later utterances.
  if (!session.fields.voiceJourney?.intent) {
    // Sessions created before the intent-first rollout may already be in the
    // caller-ID/account handshake or quote intake. Preserve that established
    // context instead of treating a confirmation such as "yes" as a fresh
    // unclassified call. New sessions still receive the exact opening first.
    const legacyJourneyAlreadyStarted =
      !!session.fields.callerIdConfirmationStatus ||
      !!session.fields.returningCustomerResolved ||
      !!session.fields.awaitingDisambiguator ||
      (session.fields.services?.length ?? 0) > 0 ||
      session.fieldStatus.phone === "verified";
    const intent = legacyJourneyAlreadyStarted
      ? "new_quote"
      : classifyVoiceJourneyIntent(input.utterance);
    if (intent === "unclear") {
      return {
        sessionId: session.id,
        sessionPatch,
        pre: { kind: "ask_intent", spoken: VOICE_OPENING },
      };
    }
    capture(mergeFields(session, {
      voiceJourney: { ...(session.fields.voiceJourney ?? {}), intent },
    }), "intent_confirmed");
  }

  let f = session.fields;

  // Step 1: caller-ID confirmation dance (only when we have an ANI and no
  // confirmed phone yet). Never speaks the full number.
  const havePhone = !!f.phone && (session.fieldStatus.phone === "captured" || session.fieldStatus.phone === "verified");
  if (!havePhone && input.callerIdE164) {
    const status = f.callerIdConfirmationStatus;
    if (!status) {
      // First time: propose the caller ID for confirmation.
      capture(mergeFields(session, {
        callerIdConfirmationStatus: "pending",
        callerIdProposedE164: input.callerIdE164,
      }), "confirming_caller_id");
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
        capture(mergeFields(session, {
          phone: proposed,
          callerIdConfirmationStatus: "contact_confirmed",
        }), "contact_number_confirmed");
        // ANI is caller-controlled and therefore confirms only the preferred
        // contact number. It does not verify identity or authorize lookup of a
        // stored customer record.
        f = session.fields;
      } else if (reply === "declined") {
        capture(mergeFields(session, { callerIdConfirmationStatus: "declined" }), "collecting_preferred_phone");
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
        capture(mergeFields(session, { phone: parsed }), "contact_number_captured");
        f = session.fields;
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
  const patchedPhoneStatus = session.fieldStatus.phone;
  const nowHasVerifiedPhone =
    patchedPhoneStatus === "verified" ||
    (!!f.phone && session.fieldStatus.phone === "verified");
  if (nowHasVerifiedPhone && !f.returningCustomerResolved && !f.awaitingDisambiguator) {
    const phone =
      session.fields.phone || f.phone!;
    const result = await resolveCustomerByPhone(input.supabase, phone);
    if (result.kind === "resolved") {
      const fn = result.customer.firstName?.trim() || null;
      capture(mergeFields(session, {
        returningCustomerResolved: true,
        returningCustomerId: result.customer.customerId,
        ...(fn ? { name: fn } : {}),
      }, fn ? { markVerified: ["name"] } : {}), "returning_customer_resolved");
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
      capture(mergeFields(session, { awaitingDisambiguator: true }), "awaiting_identity_disambiguation");
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
    capture(mergeFields(session, { returningCustomerResolved: true }), "new_customer");
  }

  // Deterministic scheduling continuation. Availability and booking still run
  // through the existing hardened tool boundary, but the model no longer
  // decides whether a conversational "yes" means fetch, select, or mutate.
  const toolContext = {
    supabase: input.supabase,
    conversationId: input.conversationId,
    sessionToken: "",
    channel: input.channel === "voice"
      ? "voice" as const
      : input.channel === "sms"
      ? "sms" as const
      : "web" as const,
  };
  if (session.lastStep === "offered_scheduling") {
    const answer = classifyExplicitConfirmation(input.utterance);
    if (answer === "declined") {
      capture(mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          availability: { status: "not_requested" },
          booking: { status: "not_started" },
        },
      }), "scheduling_declined");
      const action: WorkflowAction = {
        kind: "end",
        reason: "scheduling_declined",
      };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action,
          spoken:
            "No appointment was created. Your quote remains available if you would like to schedule later.",
        },
      };
    }
    if (answer !== "confirmed") {
      const action: WorkflowAction = { kind: "offer_scheduling" };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action,
          spoken:
            "Would you like me to check current appointment times for this quote?",
        },
      };
    }
    const raw = await runTool(
      "get_bluladder_availability",
      toolContext,
      {},
    ) as Record<string, unknown>;
    const slots = Array.isArray(raw.slots)
      ? raw.slots.filter((slot): slot is Record<string, unknown> =>
        !!slot && typeof slot === "object" &&
        typeof (slot as Record<string, unknown>).slotId === "string" &&
        typeof (slot as Record<string, unknown>).startTime === "string" &&
        typeof (slot as Record<string, unknown>).endTime === "string" &&
        typeof (slot as Record<string, unknown>).displayTime === "string"
      ).slice(0, 3)
      : [];
    if (raw.status !== "ok" || slots.length === 0) {
      const message = typeof raw.message === "string" && raw.message.trim()
        ? raw.message
        : VOICE_RECOVERY_LANGUAGE.availability_unavailable;
      capture(mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          availability: {
            status: raw.status === "no_slots"
              ? "refresh_required"
              : "provider_unavailable",
            forBookingKey: sessionBookingInputsKey(session.fields),
          },
        },
      }), "availability_blocked");
      const action: WorkflowAction = { kind: "fetch_availability" };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: { kind: "fsm", action, spoken: message },
      };
    }
    const offeredSlots = slots.map((slot) => ({
      slotId: String(slot.slotId),
      startAt: String(slot.startTime),
      endAt: String(slot.endTime),
      label: String(slot.displayTime),
      timezone: typeof slot.timezone === "string"
        ? slot.timezone
        : "America/Chicago",
    }));
    capture(mergeFields(session, {
      voiceJourney: {
        ...(session.fields.voiceJourney ?? {}),
        quoteContext: session.fields.voiceJourney?.quoteContext
          ? {
            ...session.fields.voiceJourney.quoteContext,
            acceptedAt: new Date().toISOString(),
          }
          : null,
        availability: {
          status: "offered",
          forBookingKey: sessionBookingInputsKey(session.fields),
          expiresAt: typeof raw.offerExpiresAt === "string"
            ? raw.offerExpiresAt
            : null,
          offeredSlotIds: offeredSlots.map((slot) => slot.slotId),
          offeredSlots,
          selectedSlotId: null,
        },
        booking: { status: "not_started" },
      },
    }), "awaiting_slot_selection");
    const action: WorkflowAction = { kind: "offer_slots", slots: offeredSlots };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: `${offeredSlots.map((slot, index) =>
          `Option ${index + 1}: ${slot.label}`
        ).join(". ")}. Which option works best?`,
      },
    };
  }

  if (session.lastStep === "awaiting_slot_selection") {
    const availability = session.fields.voiceJourney?.availability;
    const offeredSlots = availability?.offeredSlots ?? [];
    const selection = parseSlotSelection({
      text: input.utterance,
      expired: !!availability?.expiresAt &&
        new Date(availability.expiresAt).getTime() <= Date.now(),
      options: offeredSlots.map((slot, index) => ({
        option_number: index + 1,
        slot_id: slot.slotId,
        start_at: slot.startAt,
        end_at: slot.endAt,
        timezone: slot.timezone ?? "America/Chicago",
      })),
    });
    if (selection.status !== "selected" || !selection.selected_slot_id) {
      const action: WorkflowAction = { kind: "offer_slots", slots: offeredSlots };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action,
          spoken: selection.clarification_message ??
            "Which current option would you like?",
        },
      };
    }
    const selected = offeredSlots.find((slot) =>
      slot.slotId === selection.selected_slot_id
    );
    if (!selected) {
      const action: WorkflowAction = { kind: "fetch_availability" };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action,
          spoken: VOICE_RECOVERY_LANGUAGE.selected_slot_lost,
        },
      };
    }
    capture(mergeFields(session, {
      voiceJourney: {
        ...(session.fields.voiceJourney ?? {}),
        availability: { ...availability!, selectedSlotId: selected.slotId },
        booking: { status: "confirmation_required" },
      },
    }), "confirming_booking");
    const total = session.fields.voiceJourney?.quoteContext?.estimatedTotal ??
      session.fields.lastQuoteResult?.total;
    const totalLanguage = typeof total === "number"
      ? ` for $${Math.round(total)}`
      : "";
    const addressLanguage = session.fields.address
      ? ` at ${session.fields.address}`
      : "";
    const action: WorkflowAction = {
      kind: "confirm_slot",
      slotId: selected.slotId,
      spoken: selected.label,
    };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken:
          `You selected ${selected.label}${addressLanguage}${totalLanguage}. Would you like me to submit that appointment now?`,
      },
    };
  }

  if (session.lastStep === "confirming_booking") {
    const answer = classifyExplicitConfirmation(input.utterance);
    const availability = session.fields.voiceJourney?.availability;
    const selectedSlotId = availability?.selectedSlotId;
    const selected = availability?.offeredSlots?.find((slot) =>
      slot.slotId === selectedSlotId
    );
    if (answer === "declined") {
      capture(mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          availability: availability
            ? { ...availability, selectedSlotId: null }
            : null,
          booking: { status: "not_started" },
        },
      }), "booking_declined");
      const action: WorkflowAction = {
        kind: "end",
        reason: "booking_declined",
      };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action,
          spoken: "No appointment was created or changed.",
        },
      };
    }
    if (answer !== "confirmed" || !selectedSlotId || !selected) {
      const action: WorkflowAction = {
        kind: "confirm_slot",
        slotId: selectedSlotId ?? "",
        spoken: selected?.label ?? "the selected time",
      };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action,
          spoken:
            `No appointment has been created. Please explicitly confirm whether you want me to submit ${selected?.label ?? "that selected time"}.`,
        },
      };
    }
    capture(mergeFields(session, {
      voiceJourney: {
        ...(session.fields.voiceJourney ?? {}),
        booking: { status: "submitting" },
      },
    }), "booking_submitting");
    const raw = await runTool(
      "create_bluladder_booking",
      toolContext,
      { slotId: selectedSlotId, confirmed: true },
    ) as Record<string, unknown>;
    const confirmed = raw.status === "confirmed" && raw.simulated !== true;
    const recovery = raw.status === "needs_attention" ||
      raw.status === "temporarily_unavailable" || raw.status === "uncertain";
    capture(mergeFields(session, {
      voiceJourney: {
        ...(session.fields.voiceJourney ?? {}),
        booking: {
          status: confirmed
            ? "confirmed"
            : recovery
            ? "recovery_pending"
            : "failed",
          bookingId: typeof raw.bookingId === "string" ? raw.bookingId : null,
        },
      },
    }), confirmed ? "booking_confirmed" : "booking_not_confirmed");
    const action: WorkflowAction = {
      kind: "confirm_result",
      success: confirmed,
      reference: typeof raw.bookingReference === "string"
        ? raw.bookingReference
        : undefined,
    };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: typeof raw.message === "string" && raw.message.trim()
          ? raw.message
          : confirmed
          ? "Your appointment is confirmed."
          : VOICE_RECOVERY_LANGUAGE.booking_failed,
      },
    };
  }

  // Consume exactly the field the canonical controller asked on the previous
  // turn. An unrecognized answer is re-asked and never persisted as a guess.
  const askedField = session.lastStep?.startsWith("asked:")
    ? session.lastStep.slice("asked:".length)
    : null;
  if (askedField) {
    const parsed = applyCanonicalVoiceAnswer(session, askedField, input.utterance);
    if (!parsed.accepted) {
      const prompt = askedField === "priceChangingAssumptionConfirmation"
        ? buildCanonicalPrePriceRecap(session.fields)
        : promptForCanonicalField(askedField);
      const action = {
        kind: "ask" as const,
        field: askedField,
        prompt,
      } as unknown as WorkflowAction;
      return {
        sessionId: session.id,
        sessionPatch,
        pre: { kind: "fsm", action, spoken: prompt },
      };
    }
    let parsedSession = parsed.session;
    if (
      askedField === "services" &&
      /\b(\$?99|ninety[- ]nine).*\b(promo|promotion|special)|\b(promo|promotion).*\b(\$?99|ninety[- ]nine)/i
        .test(input.utterance)
    ) {
      const loaded = await loadPricing(input.supabase);
      const promo = loaded.ok ? loaded.pricing?.window_promo_99 : null;
      if (promo?.promoId) {
        parsedSession = mergeFields(parsedSession, {
          promotionId: promo.promoId,
        }, { markDerived: ["promotionId"] });
      }
    }
    capture(parsedSession, "answer_captured");
    f = session.fields;
  }

  // Step 3: dispatch by the sticky intent. Customer-scoped existing-record
  // actions remain deterministic and reveal no stored detail at this stage.
  const workflow = classifyWorkflow(input.utterance, session);
  if (workflow === "existing_quote") {
    const action: WorkflowAction = { kind: "retrieve_existing_quote" };
    return { sessionId: session.id, sessionPatch, pre: { kind: "fsm", action, spoken: speakForFsm(action) } };
  }
  if (workflow === "reschedule") {
    const action: WorkflowAction = { kind: "prepare_reschedule" };
    return { sessionId: session.id, sessionPatch, pre: { kind: "fsm", action, spoken: speakForFsm(action) } };
  }
  if (workflow === "cancel") {
    const action: WorkflowAction = { kind: "prepare_cancel" };
    return { sessionId: session.id, sessionPatch, pre: { kind: "fsm", action, spoken: speakForFsm(action) } };
  }
  if (workflow === "question_or_memo" || workflow === "general_inquiry") {
    const action: WorkflowAction = { kind: "answer_side_question", topic: input.utterance.slice(0, 120) };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: "What specific question can I help with? I won’t change your quote or appointment unless you explicitly ask me to.",
      },
    };
  }

  const pricingMissing = await probePricingMissing(input.supabase, session);
  let action = decideResidentialQuoteAction(session, pricingMissing);
  if (action.kind === "handoff" && action.reason === "unsupported_service") {
    const missing = computeRequired(session.fields);
    if (missing.length > 0) {
      action = {
        kind: "ask",
        field: missing[0],
        prompt: promptForCanonicalField(missing[0]),
      } as unknown as WorkflowAction;
    }
  }
  if (action.kind === "ask") {
    const prompt = action.field === "priceChangingAssumptionConfirmation"
      ? buildCanonicalPrePriceRecap(session.fields)
      : action.prompt;
    action = { ...action, prompt };
    capture(session, `asked:${action.field}`);
    return {
      sessionId: session.id,
      sessionPatch,
      pre: { kind: "fsm", action, spoken: prompt },
    };
  }
  if (action.kind === "calculate_price") {
    const loaded = await loadPricing(input.supabase);
    if (!loaded.ok || !loaded.pricing) {
      const failed: WorkflowAction = { kind: "handoff", reason: "pricing_error" };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: { kind: "fsm", action: failed, spoken: VOICE_RECOVERY_LANGUAGE.human_follow_up },
      };
    }
    const result = calculateQuote(
      quoteSessionFieldsToQuoteInput(session.fields),
      loaded.pricing,
      loaded.ruleVersion,
    );
    const inputsKey = sessionInputsKey(session.fields);
    const intake = evaluateQuoteIntake(
      session.fields as unknown as Record<string, unknown>,
    );
    const productPolicyStatus: ProductPolicyStatus =
      intake.ownerDecisions.length > 0
        ? "owner_decision_required"
        : result.status === "manual_review_required" ||
            intake.manualReview.length > 0
        ? "manual_review_required"
        : "approved";
    const channelEligibility = productPolicyStatus === "owner_decision_required"
      ? "owner_decision_required" as const
      : "eligible" as const;
    const disposition = resolveQuoteDisposition({
      engineStatus: result.status,
      productPolicyStatus,
      channelEligibility,
      reasons: [
        ...(result.manualReviewReasons ?? []),
        ...intake.manualReview,
        ...intake.ownerDecisions,
      ],
    });
    const stamped = {
      ...result,
      inputsKey,
      productPolicyStatus,
      channelEligibility,
      finalQuoteDisposition: disposition.finalQuoteDisposition,
    };
    const quoteStatus: QuoteSession["quoteStatus"] =
      disposition.finalQuoteDisposition === "firm"
      ? "firm"
      : disposition.finalQuoteDisposition === "estimated"
      ? "estimated"
      : disposition.finalQuoteDisposition === "manual_review" ||
          disposition.finalQuoteDisposition === "owner_decision_required"
      ? "manual_review"
      : disposition.finalQuoteDisposition === "incomplete"
      ? "none"
      : "error";
    const nextFields = {
      ...session.fields,
      lastQuoteResult: stamped,
      voiceJourney: {
        ...(session.fields.voiceJourney ?? {}),
        quoteContext: {
          inputsKey,
          quoteId: session.quoteId ?? null,
          pricingVersion: result.ruleVersion,
          engineVersion: result.engineVersion,
          taxPolicyVersion: result.taxPolicyVersion,
          durationVersion: result.durationVersion,
          engineStatus: result.status,
          productPolicyStatus,
          channelEligibility,
          finalQuoteDisposition: disposition.finalQuoteDisposition,
          serviceSubtotal: result.serviceSubtotal,
          estimatedTax: result.estimatedTax,
          estimatedTotal: result.estimatedTotal,
          authoritativeDurationMinutes: result.estimatedDurationMinutes,
          durationSource: result.durationSource,
          acceptedAt: null,
        },
        availability: null,
        booking: { status: "not_started" as const },
      },
    };
    capture({ ...session, fields: nextFields, quoteStatus }, "priced_spoken");
    const spoken = disposition.finalQuoteDisposition === "firm" &&
        result.total > 0
      ? buildCanonicalPriceStatement(result.total)
      : disposition.finalQuoteDisposition === "estimated" && result.total > 0
      ? `The current estimate is $${Math.round(result.total)}. It is not a firm price yet.`
      : (disposition.finalQuoteDisposition === "manual_review" ||
          disposition.finalQuoteDisposition === "owner_decision_required")
      ? `${VOICE_RECOVERY_LANGUAGE.manual_review}${
        result.total > 0
          ? ` The independently priced portions currently total $${Math.round(result.total)}.`
          : ""
      }`
      : VOICE_RECOVERY_LANGUAGE.quote_needs_clarification;
    return {
      sessionId: session.id,
      sessionPatch,
      pre: { kind: "fsm", action: { kind: "speak_price" }, spoken },
    };
  }
  if (action.kind === "speak_price") {
    const last = session.fields.lastQuoteResult;
    const total = Number(last?.total ?? 0);
    const disposition = String(last?.finalQuoteDisposition ?? "");
    const spoken = disposition === "firm" && total > 0
      ? buildCanonicalPriceStatement(total)
      : disposition === "estimated" && total > 0
      ? `The current estimate is $${Math.round(total)}. It is not a firm price yet.`
      : disposition === "manual_review" ||
          disposition === "owner_decision_required"
      ? VOICE_RECOVERY_LANGUAGE.manual_review
      : VOICE_RECOVERY_LANGUAGE.quote_needs_clarification;
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken,
      },
    };
  }
  if (action.kind === "offer_scheduling") {
    capture(session, "offered_scheduling");
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: "Would you like me to check current appointment times?",
      },
    };
  }
  if (action.kind === "handoff" || action.kind === "end") {
    return {
      sessionId: session.id,
      sessionPatch,
      pre: { kind: "fsm", action, spoken: speakForFsm(action) },
    };
  }
  // The remaining provider mutations stay behind the existing rollout/live
  // gates until they can consume a trusted provider call context. This is an
  // explicit compatibility adapter, not a competing intake or pricing path.
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
