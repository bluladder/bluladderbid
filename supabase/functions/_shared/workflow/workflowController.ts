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
// The rollout-gated controller owns quote sequencing and invokes the hardened
// pricing/availability/booking boundaries directly. Phone-first reuse is an
// opaque, tenant-scoped contact candidate only; existing-record and destructive
// appointment paths remain explicitly blocked.
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
  normalizePhone,
  type QuoteSession,
  sessionBookingInputsKey,
  sessionInputsKey,
} from "../quoteSession.ts";
import { quoteSessionFieldsToQuoteInput } from "../quoteSessionPricingAdapter.ts";
import {
  type DiscountValidationReason,
  normalizeAuthoritativeDiscountCode,
  validateDiscountCodeAuthoritatively,
} from "../discountCodeValidation.ts";
import {
  confirmationPrompt,
  interpretConfirmation,
  normalizeSpokenPhone,
  REPROMPT_PREFERRED_NUMBER,
} from "./callerIdConfirmation.ts";
import {
  applyCanonicalVoiceAnswer,
  buildCanonicalPrePriceRecap,
  buildCanonicalPriceStatement,
  formatCanonicalCurrency,
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
  type ProductPolicyStatus,
  resolveQuoteDisposition,
} from "../salesEngine/quoteDisposition.ts";
import { parseSlotSelection } from "../slotSelectionParser.ts";
import { runTool } from "../aiTools.ts";
import type { OrganizationAuthorityResolution } from "../organizationAuthority.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "../publicBookingServiceArea.ts";
import {
  type AddressComponentName,
  addressComponentQuestion,
  addressComponentsFromServiceAreaResult,
  buildAddressReadback,
  classifyAddressConfirmation,
  formatAddressComponents,
  nextMissingAddressComponent,
  normalizeAddressComponentAnswer,
} from "../voice/voiceAddressGate.ts";
import {
  buildSpokenEmailReadback,
  parseSpokenEmail,
} from "../voice/spokenEmail.ts";
import { parseSpokenName } from "../voice/quoteByText.ts";
import {
  applyApprovedWindowDefaults,
  applyVolunteeredVoiceFacts,
  classifyContextualVoiceQuoteByTextRejection,
  classifyContextualVoiceQuoteByTextRequest,
  hasVolunteeredDiscountCodeCue,
  isOperationalInstructionClause,
  normalizeVolunteeredDiscountCode,
  splitVoiceClauses,
  VOICE_QUOTE_POLICY,
} from "../voice/voicePolicy.ts";
import {
  resolveCustomerByPhone,
  verifiedNameMatchesCustomerCandidate,
} from "./customerResolver.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

function parseSpelledDiscountCodeAnswer(utterance: string): string | null {
  const text = String(utterance ?? "").toUpperCase().trim();
  const direct = normalizeAuthoritativeDiscountCode(text);
  if (direct) return direct;
  if (!/^[A-Z0-9](?:[\s,.-]+[A-Z0-9]){2,19}[\s.!?]*$/.test(text)) {
    return null;
  }
  return normalizeAuthoritativeDiscountCode(text.replace(/[^A-Z0-9]/g, ""));
}

function discountInvalidSpeech(
  reason: DiscountValidationReason | "malformed" | "non_dfw",
): string {
  switch (reason) {
    case "inactive":
      return "That code is not active, so I cannot apply it.";
    case "expired":
      return "That code has expired, so I cannot apply it.";
    case "exhausted":
      return "That code has already reached its usage limit, so I cannot apply it.";
    case "uncertain":
      return "I cannot verify that code safely right now, so I will not apply it.";
    case "non_dfw":
      return "I cannot apply discount codes for this market yet.";
    case "malformed":
      return "I could not capture a valid discount code, so I will not apply it.";
    default:
      return "I could not find that discount code, so I cannot apply it.";
  }
}

const SCHEDULE_TOPIC =
  /\b(?:schedule|scheduling|book|booking|appointment|availability|appointment times?|time slots?)\b/i;

function isGenericPostPriceRejection(text: string): boolean {
  return splitVoiceClauses(text).some((clause) => {
    const normalized = clause.toLowerCase().replaceAll("’", "'").trim();
    if (/^no problem\b/.test(normalized)) return false;
    return /^(?:no(?:pe|,?\s+thanks?|\s+need)?|not (?:right )?now|not today|not at this time|maybe later|never mind|forget it|stop|cancel that|i changed my mind|i(?:'d| would) rather not|i(?:'m| am) not ready|(?:please\s+)?(?:i\s+)?(?:do not|don't|dont)\s+(?:(?:want|need)\s+to\s+)?(?:continue|proceed|go ahead|do (?:that|it)))\b/
      .test(
        normalized,
      );
  });
}

export function classifyContextualVoiceScheduleRejection(
  text: string,
): boolean {
  return splitVoiceClauses(text).some((clause) => {
    if (
      isOperationalInstructionClause(clause) && !SCHEDULE_TOPIC.test(clause)
    ) {
      return false;
    }
    const normalized = clause.toLowerCase().replaceAll("’", "'");
    return /\b(?:do not|don't|dont|never|not ready to|not going to|rather not|no longer want to|let(?:'s| us) not|skip|stop|cancel)\b[^.;!?]{0,48}\b(?:schedule|scheduling|book|booking|check (?:current )?availability|continue (?:toward|to|with) scheduling)\b/
      .test(
        normalized,
      ) ||
      /\b(?:do not|don't|dont|never|not ready for|rather not have|do not want|don't want|no)\b[^.;!?]{0,36}\b(?:an? )?appointment\b/
        .test(
          normalized,
        ) ||
      /\b(?:schedule|scheduling|book|booking|appointment)\b[^.;!?]{0,32}\b(?:not now|later|never mind)\b/
        .test(
          normalized,
        ) ||
      /\b(?:not now|maybe later|never mind)\b[^.;!?]{0,32}\b(?:schedule|scheduling|book|booking|appointment|availability)\b/
        .test(
          normalized,
        ) ||
      /\bno\s+(?:scheduling|booking|appointment)(?:\s+(?:now|yet|today))?\b/
        .test(
          normalized,
        );
  });
}

export function classifyContextualVoiceScheduleRequest(text: string): boolean {
  return splitVoiceClauses(text).some((clause) => {
    if (!SCHEDULE_TOPIC.test(clause)) return false;
    if (classifyContextualVoiceScheduleRejection(clause)) return false;
    if (
      isOperationalInstructionClause(clause) && !SCHEDULE_TOPIC.test(clause)
    ) {
      return false;
    }
    return /\bcontinue\s+(?:on\s+)?(?:toward|to|with)\s+scheduling\b/i.test(
      clause,
    ) ||
      /\b(?:schedule|book)\s+(?:it|this|that|me|an? appointment|the appointment)\b/i
        .test(
          clause,
        ) ||
      /\b(?:let(?:'s| us)|please|can we|could we|i(?:'d| would)? like to|i want to|i am ready to|i'm ready to|go ahead(?: and)?|yes,?|sure,?|okay,?)\b[^.;!?]{0,48}\b(?:schedule|scheduling|book|booking|check (?:current )?availability|see (?:current )?appointment times?)\b/i
        .test(
          clause,
        ) ||
      /\b(?:check|show|see)\s+(?:me\s+)?(?:current\s+)?(?:availability|appointment times?|time slots?)\b/i
        .test(
          clause,
        ) ||
      /\bwhen can (?:you|they|the crew)\b/i.test(clause);
  });
}

function isExplicitPriceCorrectionAttempt(text: string): boolean {
  const normalized = String(text ?? "").toLowerCase();
  if (
    !/\b(?:actually|correction|correct that|change that|make that)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b\d[\d,]*\s*(?:square\s*(?:feet|foot)|sq\.?\s*ft\.?|sf)\b/.test(
    normalized,
  ) ||
    /\b(?:inside\s+(?:and|&)\s+outside|outside(?:\s+only)?|exterior(?:\s+only)?)\b/
      .test(
        normalized,
      ) ||
    /\b(?:unusual\s+(?:ladder\s+)?access|ladder\s+(?:work|access)|hard[ -]?water|french panes?|solar screens?|screened patio|sunroom)\b/
      .test(
        normalized,
      );
}

function isExplicitPriceRepeatRequest(text: string): boolean {
  return splitVoiceClauses(text).some((clause) =>
    /\b(?:what (?:was|is) (?:the|my) (?:price|quote|estimate|total)(?: again)?|(?:say|tell me|repeat|remind me(?: of)?) (?:the|my) (?:price|quote|estimate|total)(?: again)?|how much was (?:it|the quote|the estimate)(?: again)?)\b/i
      .test(clause)
  );
}

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
  /** Server-derived only. Missing/blocked authority is never replaced by DFW. */
  organizationAuthority?: OrganizationAuthorityResolution | null;
  /** Test seam for canonical provider/tool boundaries. */
  runTool?: typeof runTool;
  /** Sanitized stage timing callback; receives no customer content or ids. */
  onTiming?: (
    stage:
      | "session_load"
      | "pricing"
      | "address_service_area"
      | "availability"
      | "booking",
    durationMs: number,
  ) => void;
}

function requireControllerOrganization(input: ControllerInput): string | null {
  const organizationId = input.organizationAuthority?.status === "resolved"
    ? input.organizationAuthority.organizationId.trim()
    : "";
  if (organizationId) return organizationId;
  if (input.channel === "voice") {
    // This check deliberately precedes every session read, tool call, and
    // persistence decision. A blocked authority result is not a nullable org.
    throw new Error("voice_organization_authority_required");
  }
  return null;
}

/**
 * Translate the current QuoteSession into a minimal QuoteInput so the
 * canonical pricing engine can tell us what is still missing. We never trust
 * this to compute a customer-facing price — that path stays in the
 * controller's `calculate_price` action.
 */
/** Probe the canonical pricing engine for `missing[]`. Returns null if pricing
 *  config cannot be loaded (the FSM will fall back to its manifest tokens). */
async function probeCanonicalPricing(
  supabase: SB,
  session: QuoteSession,
): Promise<
  {
    missing: string[];
    loaded: Awaited<ReturnType<typeof loadPricing>>;
    result: ReturnType<typeof calculateQuote>;
  } | null
> {
  try {
    const loaded = await loadPricing(supabase);
    if (!loaded.ok || !loaded.pricing) return null;
    const result = calculateQuote(
      quoteSessionFieldsToQuoteInput(session.fields),
      loaded.pricing,
      loaded.ruleVersion,
    );
    return { missing: result.missing ?? [], loaded, result };
  } catch {
    return null;
  }
}

/** Turn B will fill this in. Returning the decided action + empty spoken text
 *  is enough for controller-level unit tests that assert sequencing without
 *  requiring the model. */
export async function runTurn(input: ControllerInput): Promise<TurnResult> {
  const t0 = Date.now();
  const organizationId = requireControllerOrganization(input);
  const session = await reloadSession(input.supabase, {
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    channel: input.channel,
    phone: input.phone,
    email: input.email,
    resolvedOrganizationId: organizationId,
  });
  const workflow = classifyWorkflow(input.utterance, session);
  let action: WorkflowAction;
  switch (workflow) {
    case "new_quote":
    case "schedule_service": {
      // Canonical engine is the sole authority on pricing readiness.
      const pricingMissing = organizationId === PUBLIC_BOOKING_ORGANIZATION_ID
        ? (await probeCanonicalPricing(input.supabase, session))?.missing ??
          null
        : null;
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
// Rollout-gated wrapper: caller-ID contact confirmation, canonical quote
// intake, pricing, availability, booking continuation, and tenant-scoped
// phone candidate reuse after the contact number is explicitly confirmed.
// ---------------------------------------------------------------------------

export type ControllerPreAction =
  | { kind: "ask_intent"; spoken: string }
  | { kind: "ask_confirm_caller_id"; last4: string; spoken: string }
  | { kind: "ask_preferred_phone"; spoken: string }
  | { kind: "fsm"; action: WorkflowAction; spoken: string };

export interface ControllerTurnResult {
  pre: ControllerPreAction;
  sessionId: string;
  sessionPatch: Record<string, unknown>;
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

export function buildNameReadback(name: string): string {
  const spelled = name.split(/\s+/).filter(Boolean).map((part) =>
    `${part}, spelled ${
      part.replace(/[^A-Za-z]/g, "").toUpperCase().split("").join("-")
    }`
  ).join("; ");
  return `I have ${spelled}. Is that exactly right?`;
}

export function correctedName(
  utterance: string,
  current: string,
): string | null {
  const firstCorrection = utterance.match(
    /\b([A-Za-z][A-Za-z'’-]{0,23})\s+(?:not|instead of)\s+[A-Za-z][A-Za-z'’-]{0,23}/i,
  )?.[1];
  const currentParts = current.trim().split(/\s+/).filter(Boolean);
  if (firstCorrection && currentParts.length >= 2) {
    const first = firstCorrection.charAt(0).toUpperCase() +
      firstCorrection.slice(1).toLowerCase();
    return [first, ...currentParts.slice(1)].join(" ");
  }
  const direct = parseSpokenName(utterance);
  if (direct && direct.split(/\s+/).length >= 2) return direct;
  return null;
}

function correctedAddressComponent(text: string): AddressComponentName | null {
  if (/\b(house|street)\s+number\b|\bnumber\b/i.test(text)) {
    return "house_number";
  }
  if (/\bzip|postal\b/i.test(text)) return "postal_code";
  if (/\bcity\b/i.test(text)) return "city";
  if (/\bstate\b/i.test(text)) return "state";
  if (/\bunit|suite|apartment\b/i.test(text)) return "unit";
  if (/\bstreet|road|drive|lane|avenue|boulevard\b/i.test(text)) {
    return "street";
  }
  return null;
}

function tenantAuthorityBlockedLanguage(
  intent: "existing_quote" | "reschedule" | "cancel" | "field_memo",
): string {
  const action = intent === "existing_quote"
    ? "access a saved quote"
    : intent === "reschedule"
    ? "reschedule an appointment"
    : intent === "cancel"
    ? "cancel an appointment"
    : "record a field-team note";
  return `I can't safely ${action} from this voice path until I can verify both the customer and the BluLadder account organization. Nothing was disclosed or changed. A team member will need to help with this request.`;
}

function isFieldMemoRequest(utterance: string): boolean {
  return /\b(note|memo|message for|tell the (crew|team|technician)|left behind|touch[- ]?up|gate code|gate instruction)\b/i
    .test(utterance);
}

/** Spoken text for simple decided FSM actions. Provider-backed actions are
 * handled explicitly in runControllerTurn. */
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

function expressPriceStatement(session: QuoteSession, total: number): string {
  const scope = session.fields.windowCleaningSides === "inside_and_outside"
    ? "For inside and outside window cleaning, "
    : session.fields.windowCleaningSides === "outside_only"
    ? "For all exterior windows, "
    : "";
  return `${scope}${
    buildCanonicalPriceStatement(total)
  } Would you like the quote texted, or would you like to continue toward scheduling?`;
}

function postPriceChoicePrompt(): string {
  return "Would you like the quote texted, or would you like to continue toward scheduling?";
}

function postPriceChoiceClarification(): string {
  return "Just to make sure I heard you: should I text the written quote, or check appointment times?";
}

function scheduleContinuationIsAuthorized(session: QuoteSession): boolean {
  return session.quoteStatus === "firm" &&
    session.fields.voiceJourney?.requestedNextStep === "schedule";
}

function isControllerOwnedManualReviewTerminal(
  lastStep: string | null | undefined,
): boolean {
  return lastStep?.startsWith("manual_review:retry_exhausted:") === true ||
    lastStep?.startsWith("manual_review:conditional_modifier_budget:") ===
      true ||
    lastStep === "manual_review:address_uncertain";
}

export async function runControllerTurn(
  input: ControllerInput,
): Promise<ControllerTurnResult> {
  const organizationId = requireControllerOrganization(input);
  const measure = async <T>(
    stage:
      | "session_load"
      | "pricing"
      | "address_service_area"
      | "availability"
      | "booking",
    operation: () => Promise<T> | T,
  ): Promise<T> => {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      try {
        input.onTiming?.(stage, Math.round(performance.now() - started));
      } catch { /* telemetry must never change the call */ }
    }
  };
  let session = await measure(
    "session_load",
    () =>
      reloadSession(input.supabase, {
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        channel: input.channel,
        phone: input.phone,
        email: input.email,
        resolvedOrganizationId: organizationId,
      }),
  );
  const persistedScheduleContinuationAuthorized =
    scheduleContinuationIsAuthorized(session);
  const persistedPostPriceBranch = session.quoteStatus === "firm"
    ? session.fields.voiceJourney?.requestedNextStep ?? "none"
    : "none";
  const persistedFirmInputsKey = session.quoteStatus === "firm"
    ? sessionInputsKey(session.fields)
    : null;
  const explicitPriceCorrectionAttempt = isExplicitPriceCorrectionAttempt(
    input.utterance,
  );
  // Controller-only metadata is stripped by persistControllerPatch. Keeping
  // the observed row version beside the patch makes every early return use the
  // same optimistic-concurrency boundary without writing it into JSONB.
  const sessionPatch: Record<string, unknown> = {
    __expected_updated_at: session.updatedAt ?? null,
    __expected_organization_id: session.organizationId ?? null,
  };
  const capture = (next: QuoteSession, lastStep = next.lastStep ?? null) => {
    session = { ...next, lastStep };
    sessionPatch.fields = session.fields;
    sessionPatch.field_status = session.fieldStatus;
    sessionPatch.required_remaining = computeRequired(session.fields);
    sessionPatch.quote_status = session.quoteStatus;
    sessionPatch.booking_ready = session.bookingReady;
    sessionPatch.last_step = lastStep;
  };
  const addressClarificationAttempts = (): number =>
    Math.max(
      0,
      Number(session.fields.voiceJourney?.retryCounts?.address ?? 0) || 0,
    );

  const addressManualReview = (
    spoken =
      "I couldn't confirm the service address safely, so I kept your quote but stopped scheduling. A team member can verify the address with you.",
  ): ControllerTurnResult => {
    const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
    const next = mergeFields(
      session,
      {
        serviceAreaStatus: "manual_review_required",
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          retryCounts,
          pendingAddressComponent: null,
          requestedNextStep: "none",
          availability: null,
          booking: { status: "not_started" as const },
        },
      },
      { markDerived: ["serviceAreaStatus"] },
    );
    capture(
      { ...next, quoteStatus: session.quoteStatus, bookingReady: false },
      "manual_review:address_uncertain",
    );
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action: { kind: "handoff", reason: "safety_or_access_flag" },
        spoken,
      },
    };
  };

  const beginAddressClarification = (
    lastStep: string,
    spoken: string,
  ): ControllerTurnResult => {
    const attempts = addressClarificationAttempts();
    if (attempts >= VOICE_QUOTE_POLICY.address.clarificationLimit) {
      return addressManualReview();
    }
    const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
    capture(
      mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          retryCounts: { ...retryCounts, address: attempts + 1 },
        },
      }),
      lastStep,
    );
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action: {
          kind: "ask",
          field: "address",
          prompt: spoken,
        } as unknown as WorkflowAction,
        spoken,
      },
    };
  };

  if (isControllerOwnedManualReviewTerminal(session.lastStep)) {
    const action = {
      kind: "handoff" as const,
      reason: "safety_or_access_flag" as const,
    } as unknown as WorkflowAction;
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken:
          "This quote is already flagged for manual review, so I won't ask more pricing questions or guess. A team member can finish it.",
      },
    };
  }

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
    capture(
      mergeFields(session, {
        voiceJourney: { ...(session.fields.voiceJourney ?? {}), intent },
      }),
      "intent_confirmed",
    );
  }

  let validDiscountAppliedToFirmQuote = false;
  let discountSpeechPrefix = "";
  const volunteeredDiscountCode = normalizeVolunteeredDiscountCode(
    input.utterance,
  );
  if (volunteeredDiscountCode) {
    if (organizationId !== PUBLIC_BOOKING_ORGANIZATION_ID) {
      // Oregon limitation: the current hosted discount_codes table is global
      // DFW configuration, so voice fails closed for any non-DFW organization
      // before the global lookup can run.
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            coupon: {
              code: volunteeredDiscountCode,
              status: "invalid",
              reason: "non_dfw",
            },
          },
        }),
        "discount_code_rejected:non_dfw",
      );
      discountSpeechPrefix = `${discountInvalidSpeech("non_dfw")} `;
      if (session.quoteStatus === "firm") {
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: { kind: "answer_side_question", topic: "discount_code" },
            spoken: `${discountSpeechPrefix}${postPriceChoicePrompt()}`,
          },
        };
      }
    } else {
      const validation = await validateDiscountCodeAuthoritatively(
        input.supabase,
        volunteeredDiscountCode,
      );
      if (validation.status === "valid") {
        const existingCoupon = session.fields.voiceJourney?.coupon;
        const identicalAlreadyApplied = session.quoteStatus === "firm" &&
          session.fields.discountCode === validation.code &&
          existingCoupon?.status === "valid" &&
          existingCoupon.discountType === validation.discountType &&
          existingCoupon.discountValue === validation.discountValue;
        if (identicalAlreadyApplied) {
          return {
            sessionId: session.id,
            sessionPatch,
            pre: {
              kind: "fsm",
              action: { kind: "answer_side_question", topic: "discount_code" },
              spoken:
                `That code is already applied. ${postPriceChoicePrompt()}`,
            },
          };
        }
        validDiscountAppliedToFirmQuote = session.quoteStatus === "firm";
        discountSpeechPrefix = "I have that discount code. ";
        capture(
          mergeFields(session, {
            discountCode: validation.code,
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              coupon: {
                code: validation.code,
                status: "valid",
                reason: null,
                discountType: validation.discountType,
                discountValue: validation.discountValue,
                authoritativeAmount: null,
              },
            },
          }, { markVerified: ["discountCode"] }),
          "discount_code_validated",
        );
      } else {
        capture(
          mergeFields(session, {
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              coupon: {
                code: validation.code,
                status: "invalid",
                reason: validation.reason,
              },
            },
          }),
          `discount_code_rejected:${validation.reason}`,
        );
        discountSpeechPrefix = `${discountInvalidSpeech(validation.reason)} `;
        if (session.quoteStatus === "firm") {
          return {
            sessionId: session.id,
            sessionPatch,
            pre: {
              kind: "fsm",
              action: { kind: "answer_side_question", topic: "discount_code" },
              spoken: `${discountSpeechPrefix}${postPriceChoicePrompt()}`,
            },
          };
        }
      }
    }
  } else if (hasVolunteeredDiscountCodeCue(input.utterance)) {
    const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
    const currentRetries = Number(retryCounts.discountCode ?? 0);
    if (currentRetries < VOICE_QUOTE_POLICY.coupon.retryLimit) {
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            retryCounts: { ...retryCounts, discountCode: currentRetries + 1 },
            coupon: { code: "", status: "unclear", reason: "malformed" },
          },
        }),
        "asked:discountCode",
      );
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: {
            kind: "ask",
            field: "discountCode",
            prompt:
              "Please spell the discount code once, one letter or number at a time.",
          } as unknown as WorkflowAction,
          spoken:
            "Please spell the discount code once, one letter or number at a time.",
        },
      };
    }
    capture(
      mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          retryCounts,
          coupon: { code: "", status: "invalid", reason: "malformed" },
        },
      }),
      "discount_code_rejected:malformed",
    );
    discountSpeechPrefix = `${discountInvalidSpeech("malformed")} `;
    if (session.quoteStatus === "firm") {
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: { kind: "answer_side_question", topic: "discount_code" },
          spoken: `${discountSpeechPrefix}${postPriceChoicePrompt()}`,
        },
      };
    }
  }

  // Policy-owned capture handles direct quote details, approved assumptions,
  // volunteered modifiers, and inert notes before selecting one question.
  const volunteered = applyVolunteeredVoiceFacts(session, input.utterance);
  // Defaults establish a priceable express quote; they must not be injected
  // during post-price contact collection because that would invalidate the
  // already-authoritative quote on an unrelated email or address answer.
  const enriched = volunteered.quoteStatus === "none"
    ? applyApprovedWindowDefaults(volunteered)
    : volunteered;
  if (JSON.stringify(enriched.fields) !== JSON.stringify(session.fields)) {
    // mergeFields deliberately nulls lastStep when a canonical price input
    // changes. Never reattach the stale scheduling/delivery step here.
    const correctionInvalidatedFirmQuote = persistedFirmInputsKey !== null &&
      enriched.quoteStatus === "none";
    capture(
      enriched,
      correctionInvalidatedFirmQuote
        ? enriched.lastStep ?? "voice_policy_applied"
        : session.lastStep ?? "voice_policy_applied",
    );
  }

  const hasScopedConfirmationPending =
    session.fields.callerIdConfirmationStatus === "pending" ||
    session.fields.callerIdConfirmationStatus === "manual_pending" ||
    session.lastStep?.startsWith("confirming:") === true ||
    session.lastStep?.startsWith("asked:contact_") === true;
  const genericPostPriceRejection = !hasScopedConfirmationPending &&
    isGenericPostPriceRejection(input.utterance);
  const currentBranchRejected = session.quoteStatus === "firm" &&
    ((persistedPostPriceBranch === "text_quote" &&
      (classifyContextualVoiceQuoteByTextRejection(input.utterance) ||
        genericPostPriceRejection)) ||
      (persistedPostPriceBranch === "schedule" &&
        (classifyContextualVoiceScheduleRejection(input.utterance) ||
          genericPostPriceRejection)));
  if (currentBranchRejected) {
    const rejectedBranch = persistedPostPriceBranch;
    const bookingStatus = session.fields.voiceJourney?.booking?.status;
    const schedulingOutcomeMayExist = bookingStatus === "submitting" ||
      bookingStatus === "confirmed" || bookingStatus === "recovery_pending";
    capture(
      mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          requestedNextStep: "none",
        },
      }),
      rejectedBranch === "schedule"
        ? "scheduling_declined"
        : "quote_text_declined",
    );
    const action: WorkflowAction = rejectedBranch === "schedule"
      ? { kind: "end", reason: "scheduling_declined" }
      : { kind: "answer_side_question", topic: "post_price_choice" };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: rejectedBranch === "schedule"
          ? schedulingOutcomeMayExist
            ? "I won't take another scheduling action. The existing appointment status has not been changed."
            : "No appointment was created. Your quote remains available if you would like to schedule later."
          : `I won't send another quote text. ${postPriceChoicePrompt()}`,
      },
    };
  }

  if (
    session.quoteStatus === "firm" &&
    isExplicitPriceRepeatRequest(input.utterance)
  ) {
    const last = session.fields.lastQuoteResult;
    const total = Number(last?.estimatedTotal ?? last?.total ?? 0);
    if (last?.finalQuoteDisposition === "firm" && total > 0) {
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: { kind: "speak_price" },
          spoken: `Your authoritative tax-inclusive total is ${
            formatCanonicalCurrency(total)
          }. ${postPriceChoicePrompt()}`,
        },
      };
    }
  }

  if (
    session.quoteStatus === "firm" && explicitPriceCorrectionAttempt &&
    persistedFirmInputsKey === sessionInputsKey(session.fields)
  ) {
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action: { kind: "answer_side_question", topic: "post_price_choice" },
        spoken: `That matches the current quote. ${postPriceChoicePrompt()}`,
      },
    };
  }

  if (session.quoteStatus === "firm") {
    const requestedNextStep =
      classifyContextualVoiceQuoteByTextRequest(input.utterance)
        ? "text_quote" as const
        : classifyContextualVoiceScheduleRequest(input.utterance)
        ? "schedule" as const
        : null;
    if (requestedNextStep) {
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            requestedNextStep,
          },
        }),
        "post_price_choice_captured",
      );
    }
  }

  if (
    session.quoteStatus === "firm" &&
    session.fields.voiceJourney?.intent === "new_quote" &&
    session.fields.voiceJourney?.requestedNextStep !== "text_quote" &&
    session.fields.voiceJourney?.requestedNextStep !== "schedule"
  ) {
    const action: WorkflowAction = {
      kind: "answer_side_question",
      topic: "post_price_choice",
    };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: postPriceChoiceClarification(),
      },
    };
  }

  let f = session.fields;

  // Step 1: caller-ID confirmation dance (only when we have an ANI and no
  // confirmed phone yet). Never speaks the full number.
  const havePhone = !!f.phone &&
    (session.fieldStatus.phone === "captured" ||
      session.fieldStatus.phone === "verified");
  if (!havePhone && input.callerIdE164 && session.quoteStatus === "firm") {
    const status = f.callerIdConfirmationStatus;
    if (!status) {
      // First time: propose the caller ID for confirmation.
      capture(
        mergeFields(session, {
          callerIdConfirmationStatus: "pending",
          callerIdProposedE164: input.callerIdE164,
        }),
        "confirming_caller_id",
      );
      const last4 = digits(input.callerIdE164).slice(-4);
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "ask_confirm_caller_id",
          last4,
          spoken: confirmationPrompt(input.callerIdE164),
        },
      };
    }
    if (status === "pending") {
      const reply = interpretConfirmation(input.utterance);
      const proposed = f.callerIdProposedE164 || input.callerIdE164;
      const spokenPhone = normalizeSpokenPhone(input.utterance);
      const explicitlySelectedProposed = !!spokenPhone &&
        spokenPhone === proposed && reply !== "declined";
      const explicitlyConfirmsProposed = reply === "confirmed" &&
        (!spokenPhone || spokenPhone === proposed);
      if (explicitlyConfirmsProposed || explicitlySelectedProposed) {
        capture(
          mergeFields(session, {
            phone: proposed,
            callerIdConfirmationStatus: "contact_confirmed",
          }),
          "contact_number_confirmed",
        );
        // ANI is caller-controlled and therefore confirms only the preferred
        // contact number. It does not verify identity or authorize lookup of a
        // stored customer record.
        f = session.fields;
      } else if (spokenPhone) {
        capture(
          mergeFields(session, {
            phone: spokenPhone,
            callerIdConfirmationStatus: "manual_pending",
          }),
          "confirming:contact_phone",
        );
        const spoken = `I have the mobile number ending in ${
          digits(spokenPhone).slice(-4)
        }. Is that right?`;
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: {
              kind: "ask",
              field: "contact_phone",
              prompt: spoken,
            } as unknown as WorkflowAction,
            spoken,
          },
        };
      } else if (reply === "declined") {
        capture(
          mergeFields(session, { callerIdConfirmationStatus: "declined" }),
          "collecting_preferred_phone",
        );
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "ask_preferred_phone",
            spoken: REPROMPT_PREFERRED_NUMBER,
          },
        };
      } else {
        const last4 = digits(input.callerIdE164).slice(-4);
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "ask_confirm_caller_id",
            last4,
            spoken: `Sorry, I didn't catch that. ${
              confirmationPrompt(input.callerIdE164)
            }`,
          },
        };
      }
    }
    if (status === "declined") {
      const parsed = normalizeSpokenPhone(input.utterance);
      if (parsed) {
        capture(
          mergeFields(session, {
            phone: parsed,
            callerIdConfirmationStatus: "manual_pending",
          }),
          "confirming:contact_phone",
        );
        const spoken = `I have the mobile number ending in ${
          digits(parsed).slice(-4)
        }. Is that right?`;
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: {
              kind: "ask",
              field: "contact_phone",
              prompt: spoken,
            } as unknown as WorkflowAction,
            spoken,
          },
        };
      } else {
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "ask_preferred_phone",
            spoken: REPROMPT_PREFERRED_NUMBER,
          },
        };
      }
    }
  }

  // Step 2: a confirmed phone may seed one opaque same-tenant candidate. It
  // remains non-authoritative until the caller independently supplies and
  // confirms the full name. No stored name, email, address, quote, booking, or
  // history is projected or spoken during this comparison.
  const clearPhoneReuse = (
    status: NonNullable<
      QuoteSession["fields"]["returningCustomerLookupStatus"]
    >,
  ): QuoteSession => {
    const {
      returningCustomerCandidateId: _candidate,
      returningCustomerId: _customer,
      returningCustomerResolved: _resolved,
      awaitingDisambiguator: _awaiting,
      ...safeFields
    } = session.fields;
    return {
      ...session,
      fields: { ...safeFields, returningCustomerLookupStatus: status },
    };
  };
  const setVerifiedPhoneReuse = (customerId: string): QuoteSession => {
    const next = clearPhoneReuse("verified");
    return {
      ...next,
      fields: {
        ...next.fields,
        returningCustomerId: customerId,
        returningCustomerResolved: true,
        awaitingDisambiguator: false,
      },
    };
  };
  if (
    (f.returningCustomerId && f.returningCustomerResolved !== true) ||
    (f.awaitingDisambiguator && !f.returningCustomerCandidateId)
  ) {
    capture(clearPhoneReuse("unavailable"), "tenant_identity_legacy_cleared");
    f = session.fields;
  }
  const phoneConfirmedForReuse = !!f.phone &&
    (session.fieldStatus.phone === "verified" ||
      session.fieldStatus.phone === "corrected" ||
      f.callerIdConfirmationStatus === "contact_confirmed" ||
      f.callerIdConfirmationStatus === "confirmed");
  const phoneReuseScopeEligible = input.channel === "voice" &&
    !!organizationId && session.quoteStatus === "firm" &&
    f.voiceJourney?.intent === "new_quote" &&
    (f.voiceJourney?.requestedNextStep === "text_quote" ||
      f.voiceJourney?.requestedNextStep === "schedule") &&
    phoneConfirmedForReuse;

  const verifyPendingPhoneCandidate = async (): Promise<void> => {
    const candidateId = session.fields.returningCustomerCandidateId;
    const phone = session.fields.phone;
    const name = session.fields.name;
    const nameConfirmed = session.fieldStatus.name === "verified" ||
      session.fieldStatus.name === "corrected";
    if (
      !phoneReuseScopeEligible || !candidateId || !phone || !name ||
      !nameConfirmed || !organizationId
    ) return;
    const current = await resolveCustomerByPhone(
      input.supabase,
      organizationId,
      phone,
    );
    if (
      current.kind === "resolved" &&
      current.customer.customerId === candidateId &&
      await verifiedNameMatchesCustomerCandidate({
        organizationId,
        phoneE164: phone,
        suppliedName: name,
        customer: current.customer,
      })
    ) {
      capture(setVerifiedPhoneReuse(candidateId), session.lastStep);
      f = session.fields;
      return;
    }
    const status = current.kind === "resolved"
      ? "name_conflict" as const
      : current.kind;
    capture(clearPhoneReuse(status), session.lastStep);
    f = session.fields;
  };

  if (
    phoneReuseScopeEligible && !f.returningCustomerResolved &&
    !f.returningCustomerCandidateId && !f.returningCustomerLookupStatus &&
    organizationId && f.phone
  ) {
    const result = await resolveCustomerByPhone(
      input.supabase,
      organizationId,
      f.phone,
    );
    if (result.kind === "resolved") {
      capture({
        ...session,
        fields: {
          ...session.fields,
          returningCustomerCandidateId: result.customer.customerId,
          returningCustomerResolved: false,
          awaitingDisambiguator: true,
          returningCustomerLookupStatus: "candidate",
        },
      }, session.lastStep);
      f = session.fields;
      const nameConfirmed = (session.fieldStatus.name === "verified" ||
        session.fieldStatus.name === "corrected") && !!f.name;
      if (nameConfirmed) {
        await verifyPendingPhoneCandidate();
      } else {
        const spoken = "What full name should I use for this quote?";
        capture(session, "asked:contact_name");
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: {
              kind: "ask",
              field: "contact_name",
              prompt: spoken,
            } as unknown as WorkflowAction,
            spoken,
          },
        };
      }
    } else {
      capture(clearPhoneReuse(result.kind), session.lastStep);
      f = session.fields;
    }
  }

  // Deterministic scheduling continuation. Availability and booking still run
  // through the existing hardened tool boundary, but the model no longer
  // decides whether a conversational "yes" means fetch, select, or mutate.
  const toolContext = {
    supabase: input.supabase,
    conversationId: input.conversationId,
    sessionToken: "",
    organizationId,
    channel: input.channel === "voice"
      ? "voice" as const
      : input.channel === "sms"
      ? "sms" as const
      : "web" as const,
  };
  const executeTool = input.runTool ?? runTool;

  const askConfirmation = (
    field: "contact_name" | "contact_email" | "contact_phone" | "address",
    spoken: string,
  ): ControllerTurnResult => {
    capture(session, `confirming:${field}`);
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action: {
          kind: "ask",
          field,
          prompt: spoken,
        } as unknown as WorkflowAction,
        spoken,
      },
    };
  };

  const validateVoiceAddress = async (
    candidate: string,
    requireConfirmation = true,
  ): Promise<ControllerTurnResult> => {
    const raw = await measure(
      "address_service_area",
      () =>
        executeTool(
          "validate_service_area",
          toolContext,
          { address: candidate },
        ),
    ) as Record<string, unknown>;
    const components = addressComponentsFromServiceAreaResult(raw);
    const status = String(raw.status ?? "validation_unavailable");
    const formatted = typeof raw.formattedAddress === "string"
      ? raw.formattedAddress.trim()
      : "";
    if (
      (status === "eligible" || status === "manual_review_required") &&
      formatted
    ) {
      const confirmedStatus = status === "eligible"
        ? "eligible" as const
        : "manual_review_required" as const;
      if (!requireConfirmation) {
        if (confirmedStatus !== "eligible") {
          return addressManualReview(
            "I corrected the address, but it still needs a team member to verify the service area. I kept your quote and stopped scheduling.",
          );
        }
        const corrected = mergeFields(
          session,
          {
            address: formatted,
            addressComponents: components,
            serviceAreaStatus: confirmedStatus,
            serviceAreaResult: raw,
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              pendingAddressComponent: null,
            },
          },
          { markVerified: ["address", "serviceAreaStatus"] },
        );
        const nextAction = decideResidentialQuoteAction(corrected, []);
        if (nextAction.kind === "ask") {
          capture(corrected, `asked:${nextAction.field}`);
          return {
            sessionId: session.id,
            sessionPatch,
            pre: {
              kind: "fsm",
              action: nextAction,
              spoken: nextAction.prompt,
            },
          };
        }
        if (nextAction.kind === "offer_scheduling") {
          capture(corrected, "offered_scheduling");
          return {
            sessionId: session.id,
            sessionPatch,
            pre: {
              kind: "fsm",
              action: nextAction,
              spoken:
                "Thanks, I corrected the address. Would you like me to check current appointment times?",
            },
          };
        }
        return addressManualReview(
          "I corrected the address, but I couldn't safely continue toward scheduling. I kept your quote for a team member to review.",
        );
      }
      const next = mergeFields(session, {
        address: formatted,
        addressComponents: components,
        serviceAreaStatus: "pending_confirmation",
        serviceAreaResult: raw,
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          pendingAddressComponent: null,
        },
      });
      capture(next, "confirming:address");
      const spoken = buildAddressReadback(formatted);
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: {
            kind: "ask",
            field: "address",
            prompt: spoken,
          } as unknown as WorkflowAction,
          spoken,
        },
      };
    }
    if (status === "address_incomplete") {
      const missing = nextMissingAddressComponent(components);
      capture(
        mergeFields(session, {
          addressComponents: components,
          serviceAreaStatus: "unavailable",
          serviceAreaResult: raw,
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            pendingAddressComponent: missing,
          },
        }),
        `address_component:${missing}`,
      );
      return beginAddressClarification(
        `address_component:${missing}`,
        `${
          addressComponentQuestion(missing)
        } This is the one address clarification I need before scheduling.`,
      );
    }
    const customerMessage =
      typeof raw.customerMessage === "string" && raw.customerMessage.trim()
        ? raw.customerMessage
        : "I couldn't verify that address right now.";
    if (status === "ineligible") {
      capture(
        mergeFields(
          session,
          {
            serviceAreaStatus: "ineligible",
            serviceAreaResult: raw,
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              requestedNextStep: "none",
              availability: null,
              booking: { status: "not_started" as const },
            },
          },
          { markDerived: ["serviceAreaStatus", "serviceAreaResult"] },
        ),
        "service_area_ineligible",
      );
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: { kind: "handoff", reason: "safety_or_access_flag" },
          spoken: customerMessage,
        },
      };
    }
    capture(
      mergeFields(session, {
        serviceAreaStatus: "unavailable",
        serviceAreaResult: raw,
      }, { markDerived: ["serviceAreaStatus", "serviceAreaResult"] }),
      "service_area_unavailable",
    );
    return addressManualReview(
      `${customerMessage} I kept your quote but stopped scheduling so a team member can verify the address.`,
    );
  };

  if (session.lastStep?.startsWith("confirming:")) {
    const field = session.lastStep.slice("confirming:".length);
    const answer = field === "address"
      ? classifyAddressConfirmation(input.utterance)
      : classifyExplicitConfirmation(input.utterance);
    if (answer === "yes" || answer === "confirmed") {
      if (field === "contact_name" && session.fields.name) {
        capture(
          mergeFields(session, { name: session.fields.name }, {
            markVerified: ["name"],
          }),
          "contact_name_confirmed",
        );
        await verifyPendingPhoneCandidate();
      } else if (field === "contact_email" && session.fields.email) {
        capture(
          mergeFields(session, { email: session.fields.email }, {
            markVerified: ["email"],
          }),
          "contact_email_confirmed",
        );
      } else if (field === "contact_phone" && session.fields.phone) {
        capture(
          mergeFields(session, {
            phone: session.fields.phone,
            callerIdConfirmationStatus: "contact_confirmed",
          }, { markVerified: ["phone"] }),
          "contact_number_confirmed",
        );
      } else if (field === "address" && session.fields.address) {
        const candidateStatus = String(
          session.fields.serviceAreaResult?.status ?? "",
        );
        const confirmedStatus = candidateStatus === "eligible"
          ? "eligible" as const
          : candidateStatus === "manual_review_required"
          ? "manual_review_required" as const
          : "unavailable" as const;
        capture(
          mergeFields(session, {
            address: session.fields.address,
            serviceAreaStatus: confirmedStatus,
          }, { markVerified: ["address", "serviceAreaStatus"] }),
          "address_confirmed",
        );
        if (confirmedStatus !== "eligible") {
          return addressManualReview(
            "I confirmed the address, but the service area still needs a team member to verify it. I kept your quote and stopped scheduling.",
          );
        }
      }
      f = session.fields;
    } else if (field === "contact_name") {
      const correction = correctedName(
        input.utterance,
        session.fields.name ?? "",
      );
      if (correction) {
        capture(
          mergeFields(session, { name: correction }),
          "confirming:contact_name",
        );
        return askConfirmation("contact_name", buildNameReadback(correction));
      }
      capture(session, "asked:contact_name");
      const spoken = promptForCanonicalField("contact_name");
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: {
            kind: "ask",
            field: "contact_name",
            prompt: spoken,
          } as unknown as WorkflowAction,
          spoken,
        },
      };
    } else if (field === "contact_email") {
      const correction = parseSpokenEmail(input.utterance);
      if (correction) {
        capture(
          mergeFields(session, { email: correction }),
          "confirming:contact_email",
        );
        return askConfirmation(
          "contact_email",
          buildSpokenEmailReadback(correction),
        );
      }
      capture(session, "asked:contact_email");
      const spoken = promptForCanonicalField("contact_email");
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: {
            kind: "ask",
            field: "contact_email",
            prompt: spoken,
          } as unknown as WorkflowAction,
          spoken,
        },
      };
    } else if (field === "contact_phone") {
      const correction = normalizeSpokenPhone(input.utterance);
      if (correction) {
        capture(
          mergeFields(session, {
            phone: correction,
            callerIdConfirmationStatus: "manual_pending",
          }),
          "confirming:contact_phone",
        );
        const spoken = `I have the mobile number ending in ${
          digits(correction).slice(-4)
        }. Is that right?`;
        return askConfirmation("contact_phone", spoken);
      }
      const spoken = REPROMPT_PREFERRED_NUMBER;
      capture(session, "asked:contact_phone");
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: {
            kind: "ask",
            field: "contact_phone",
            prompt: spoken,
          } as unknown as WorkflowAction,
          spoken,
        },
      };
    } else if (field === "address") {
      const component = correctedAddressComponent(input.utterance);
      const correction = component
        ? normalizeAddressComponentAnswer(component, input.utterance)
        : null;
      if (component && correction) {
        const attempts = addressClarificationAttempts();
        if (attempts >= VOICE_QUOTE_POLICY.address.clarificationLimit) {
          return addressManualReview();
        }
        const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
        const components = {
          ...(session.fields.addressComponents ?? {}),
          [component]: correction,
        };
        const completed = formatAddressComponents(components);
        capture(
          mergeFields(session, {
            addressComponents: components,
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              retryCounts: { ...retryCounts, address: attempts + 1 },
              pendingAddressComponent: null,
            },
          }),
          "address_correction_captured",
        );
        return await validateVoiceAddress(completed, false);
      }
      return beginAddressClarification(
        "address_component:choose",
        "Which part should I correct: the house number, street, city, state, or ZIP code?",
      );
    } else {
      return askConfirmation(
        field as "contact_name",
        "Please say yes if that is exactly right, or tell me the correction.",
      );
    }
  }

  if (session.lastStep?.startsWith("address_component:")) {
    const token = session.lastStep.slice("address_component:".length);
    const component = token === "choose"
      ? correctedAddressComponent(input.utterance)
      : token as AddressComponentName;
    if (!component) return addressManualReview();
    const value = normalizeAddressComponentAnswer(component, input.utterance);
    if (!value) return addressManualReview();
    const components = {
      ...(session.fields.addressComponents ?? {}),
      [component]: value,
    };
    if (
      !components.house_number || !components.street || !components.city ||
      !components.state || !components.postal_code
    ) {
      capture(
        mergeFields(session, {
          addressComponents: components,
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            pendingAddressComponent: nextMissingAddressComponent(components),
          },
        }),
        "address_correction_incomplete",
      );
      return addressManualReview();
    }
    capture(
      mergeFields(session, {
        addressComponents: components,
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          pendingAddressComponent: null,
        },
      }),
      "address_components_complete",
    );
    return await validateVoiceAddress(
      formatAddressComponents(components),
      false,
    );
  }
  if (session.lastStep === "offered_scheduling") {
    const answer = classifyExplicitConfirmation(input.utterance);
    if (answer === "declined") {
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            availability: { status: "not_requested" },
            booking: { status: "not_started" },
          },
        }),
        "scheduling_declined",
      );
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
    if (!persistedScheduleContinuationAuthorized) {
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: { kind: "answer_side_question", topic: "post_price_choice" },
          spoken: postPriceChoicePrompt(),
        },
      };
    }
    const raw = await measure(
      "availability",
      () =>
        executeTool(
          "get_bluladder_availability",
          toolContext,
          {},
        ),
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
      const blockers = Array.isArray(raw.blockers)
        ? raw.blockers.filter((blocker): blocker is Record<string, unknown> =>
          !!blocker && typeof blocker === "object"
        ).map((blocker) => ({
          code: String(blocker.code ?? "readiness_blocked").slice(0, 80),
          category: typeof blocker.category === "string"
            ? blocker.category.slice(0, 80)
            : null,
          detail: typeof blocker.staff_message === "string"
            ? blocker.staff_message.slice(0, 240)
            : null,
        }))
        : [];
      const firstRecovery = Array.isArray(raw.blockers)
        ? raw.blockers.find((blocker) =>
          blocker && typeof blocker === "object" &&
          typeof (blocker as Record<string, unknown>).customer_safe_message ===
            "string"
        ) as Record<string, unknown> | undefined
        : undefined;
      const message = typeof firstRecovery?.customer_safe_message === "string"
        ? firstRecovery.customer_safe_message
        : typeof raw.message === "string" && raw.message.trim()
        ? raw.message
        : VOICE_RECOVERY_LANGUAGE.availability_unavailable;
      const rawStatus = String(raw.status ?? "engine_error");
      const status = rawStatus === "no_slots"
        ? "no_slots" as const
        : rawStatus === "schedule_drifted" || rawStatus === "quote_changed"
        ? "refresh_required" as const
        : rawStatus.startsWith("provider_")
        ? "provider_unavailable" as const
        : rawStatus === "not_ready"
        ? "readiness_blocked" as const
        : rawStatus === "gate_blocked"
        ? "policy_blocked" as const
        : rawStatus === "preference_ambiguous"
        ? "preference_required" as const
        : "engine_error" as const;
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            availability: {
              status,
              forBookingKey: sessionBookingInputsKey(session.fields),
              readinessBlockers: blockers,
              nextAction: typeof raw.nextAction === "string"
                ? raw.nextAction.slice(0, 80)
                : null,
              failureCategory: typeof raw.failureCategory === "string"
                ? raw.failureCategory.slice(0, 80)
                : rawStatus.slice(0, 80),
              safeDetail: typeof raw.safeDetail === "string"
                ? raw.safeDetail.slice(0, 240)
                : null,
              providerContacted: raw.providerContacted === true,
            },
          },
        }),
        "availability_blocked",
      );
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
    capture(
      mergeFields(session, {
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
            providerContacted: raw.providerContacted === true,
            readinessBlockers: [],
            nextAction: "select_slot",
            failureCategory: null,
            safeDetail: null,
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
      }),
      "awaiting_slot_selection",
    );
    const action: WorkflowAction = { kind: "offer_slots", slots: offeredSlots };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: `${
          offeredSlots.map((slot, index) =>
            `Option ${index + 1}: ${slot.label}`
          ).join(". ")
        }. Which option works best?`,
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
      const action: WorkflowAction = {
        kind: "offer_slots",
        slots: offeredSlots,
      };
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
    capture(
      mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          availability: { ...availability!, selectedSlotId: selected.slotId },
          booking: { status: "confirmation_required" },
        },
      }),
      "confirming_booking",
    );
    const total = session.fields.voiceJourney?.quoteContext?.estimatedTotal ??
      session.fields.lastQuoteResult?.total;
    const totalLanguage = typeof total === "number"
      ? ` for ${formatCanonicalCurrency(total)}`
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
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            availability: availability
              ? { ...availability, selectedSlotId: null }
              : null,
            booking: { status: "not_started" },
          },
        }),
        "booking_declined",
      );
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
            `No appointment has been created. Please explicitly confirm whether you want me to submit ${
              selected?.label ?? "that selected time"
            }.`,
        },
      };
    }
    if (!persistedScheduleContinuationAuthorized) {
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: { kind: "answer_side_question", topic: "post_price_choice" },
          spoken: postPriceChoicePrompt(),
        },
      };
    }
    capture(
      mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          booking: { status: "submitting" },
        },
      }),
      "booking_submitting",
    );
    const raw = await measure(
      "booking",
      () =>
        executeTool(
          "create_bluladder_booking",
          toolContext,
          { slotId: selectedSlotId, confirmed: true },
        ),
    ) as Record<string, unknown>;
    const confirmed = raw.status === "confirmed" && raw.simulated !== true;
    const recovery = raw.status === "needs_attention" ||
      raw.status === "temporarily_unavailable" || raw.status === "uncertain";
    capture(
      mergeFields(session, {
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
      }),
      confirmed ? "booking_confirmed" : "booking_not_confirmed",
    );
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
  if (askedField === "discountCode") {
    const spelledCode = parseSpelledDiscountCodeAnswer(input.utterance);
    if (spelledCode) {
      if (organizationId !== PUBLIC_BOOKING_ORGANIZATION_ID) {
        capture(
          mergeFields(session, {
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              coupon: {
                code: spelledCode,
                status: "invalid",
                reason: "non_dfw",
              },
            },
          }),
          "discount_code_rejected:non_dfw",
        );
        if (session.quoteStatus === "firm") {
          return {
            sessionId: session.id,
            sessionPatch,
            pre: {
              kind: "fsm",
              action: { kind: "answer_side_question", topic: "discount_code" },
              spoken: `${
                discountInvalidSpeech("non_dfw")
              } ${postPriceChoicePrompt()}`,
            },
          };
        }
      } else {
        const validation = await validateDiscountCodeAuthoritatively(
          input.supabase,
          spelledCode,
        );
        if (validation.status === "valid") {
          validDiscountAppliedToFirmQuote = session.quoteStatus === "firm";
          capture(
            mergeFields(session, {
              discountCode: validation.code,
              voiceJourney: {
                ...(session.fields.voiceJourney ?? {}),
                coupon: {
                  code: validation.code,
                  status: "valid",
                  reason: null,
                  discountType: validation.discountType,
                  discountValue: validation.discountValue,
                  authoritativeAmount: null,
                },
              },
            }, { markVerified: ["discountCode"] }),
            "discount_code_validated",
          );
        } else {
          capture(
            mergeFields(session, {
              voiceJourney: {
                ...(session.fields.voiceJourney ?? {}),
                coupon: {
                  code: validation.code,
                  status: "invalid",
                  reason: validation.reason,
                },
              },
            }),
            `discount_code_rejected:${validation.reason}`,
          );
          if (session.quoteStatus === "firm") {
            return {
              sessionId: session.id,
              sessionPatch,
              pre: {
                kind: "fsm",
                action: {
                  kind: "answer_side_question",
                  topic: "discount_code",
                },
                spoken: `${
                  discountInvalidSpeech(validation.reason)
                } ${postPriceChoicePrompt()}`,
              },
            };
          }
        }
      }
    } else {
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            coupon: { code: "", status: "invalid", reason: "malformed" },
          },
        }),
        "discount_code_rejected:malformed",
      );
      if (session.quoteStatus === "firm") {
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: { kind: "answer_side_question", topic: "discount_code" },
            spoken: `${
              discountInvalidSpeech("malformed")
            } ${postPriceChoicePrompt()}`,
          },
        };
      }
    }
  }
  if (askedField && askedField !== "discountCode") {
    const parsed = applyCanonicalVoiceAnswer(
      session,
      askedField,
      input.utterance,
    );
    if (!parsed.accepted) {
      const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
      const currentRetries = Number(retryCounts[askedField] ?? 0);
      if (currentRetries >= 1) {
        const terminal = mergeFields(session, {
          lastQuoteResult: undefined,
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            retryCounts,
            requestedNextStep: "none",
            quoteContext: null,
            delivery: null,
            availability: null,
            booking: { status: "not_started" as const },
          },
        });
        delete terminal.fields.lastQuoteResult;
        terminal.quoteStatus = "manual_review";
        terminal.bookingReady = false;
        capture(terminal, `manual_review:retry_exhausted:${askedField}`);
        const action = {
          kind: "handoff" as const,
          reason: "safety_or_access_flag" as const,
        } as unknown as WorkflowAction;
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action,
            spoken:
              "I still couldn't capture that detail safely, so I've flagged the quote for manual review. A team member can finish it without me guessing.",
          },
        };
      }
      const retried = mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          retryCounts: { ...retryCounts, [askedField]: currentRetries + 1 },
        },
      });
      capture(retried, `asked:${askedField}`);
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
    if (askedField === "contact_name" && f.name) {
      return askConfirmation("contact_name", buildNameReadback(f.name));
    }
    if (askedField === "contact_email" && f.email) {
      return askConfirmation(
        "contact_email",
        buildSpokenEmailReadback(f.email),
      );
    }
    if (askedField === "contact_phone" && f.phone) {
      capture(
        mergeFields(session, { callerIdConfirmationStatus: "manual_pending" }),
        "confirming:contact_phone",
      );
      return askConfirmation(
        "contact_phone",
        `I have the mobile number ending in ${
          digits(f.phone).slice(-4)
        }. Is that right?`,
      );
    }
    if (askedField === "address" && f.address) {
      return await validateVoiceAddress(f.address);
    }
  }

  // Step 3: dispatch by the sticky intent. Customer-scoped existing-record
  // actions remain deterministic and reveal no stored detail at this stage.
  const workflow = classifyWorkflow(input.utterance, session);
  if (workflow === "existing_quote") {
    const action: WorkflowAction = {
      kind: "handoff",
      reason: "tenant_authority_required",
    };
    capture(session, "blocked:tenant_authority_required");
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: tenantAuthorityBlockedLanguage(workflow),
      },
    };
  }
  if (workflow === "reschedule") {
    const action: WorkflowAction = {
      kind: "handoff",
      reason: "tenant_authority_required",
    };
    capture(session, "blocked:tenant_authority_required");
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: tenantAuthorityBlockedLanguage(workflow),
      },
    };
  }
  if (workflow === "cancel") {
    const action: WorkflowAction = {
      kind: "handoff",
      reason: "tenant_authority_required",
    };
    capture(session, "blocked:tenant_authority_required");
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: tenantAuthorityBlockedLanguage(workflow),
      },
    };
  }
  if (workflow === "question_or_memo" && isFieldMemoRequest(input.utterance)) {
    const action: WorkflowAction = {
      kind: "handoff",
      reason: "tenant_authority_required",
    };
    capture(session, "blocked:tenant_authority_required");
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken: tenantAuthorityBlockedLanguage("field_memo"),
      },
    };
  }
  if (workflow === "question_or_memo" || workflow === "general_inquiry") {
    const action: WorkflowAction = {
      kind: "answer_side_question",
      topic: input.utterance.slice(0, 120),
    };
    return {
      sessionId: session.id,
      sessionPatch,
      pre: {
        kind: "fsm",
        action,
        spoken:
          "What specific question can I help with? I won’t change your quote or appointment unless you explicitly ask me to.",
      },
    };
  }

  // The readiness decision and customer-facing calculation consume the same
  // canonical pricing snapshot. Reusing it within this immutable section
  // removes one database read and one complete calculation without relaxing
  // freshness, tenant, coupon, promotion, tax, or duration authority.
  const pricingProbe = organizationId === PUBLIC_BOOKING_ORGANIZATION_ID
    ? await measure(
      "pricing",
      () => probeCanonicalPricing(input.supabase, session),
    )
    : null;
  const pricingMissing = pricingProbe?.missing ?? null;
  let action = decideResidentialQuoteAction(session, pricingMissing);
  if (action.kind === "handoff" && action.reason === "unsupported_service") {
    const allowedUnsupportedClarificationFields = [
      // Stories are deliberately neutral for window-only pricing, but remain
      // a canonical input for a separately volunteered house-wash service.
      "stories",
      "ladderAffectedWindowEquivalents",
      "hardWaterAffectedWindowEquivalents",
    ];
    const missing = computeRequired(session.fields);
    const allowedField = allowedUnsupportedClarificationFields.find((field) =>
      missing.includes(field)
    );
    if (allowedField) {
      action = {
        kind: "ask",
        field: allowedField,
        prompt: promptForCanonicalField(allowedField),
      } as unknown as WorkflowAction;
    }
  }
  if (action.kind === "ask") {
    const conditionalQuantityFields = new Set([
      "ladderAffectedWindowEquivalents",
      "hardWaterAffectedWindowEquivalents",
    ]);
    if (conditionalQuantityFields.has(action.field)) {
      const alreadyAsked = session.fields.voiceJourney
        ?.conditionalModifierQuestionAsked;
      if (alreadyAsked && alreadyAsked !== action.field) {
        const terminal = mergeFields(session, {
          lastQuoteResult: undefined,
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            requestedNextStep: "none",
            quoteContext: null,
            delivery: null,
            availability: null,
            booking: { status: "not_started" as const },
          },
        });
        delete terminal.fields.lastQuoteResult;
        terminal.quoteStatus = "manual_review";
        terminal.bookingReady = false;
        capture(
          terminal,
          `manual_review:conditional_modifier_budget:${action.field}`,
        );
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: { kind: "handoff", reason: "safety_or_access_flag" },
            spoken:
              "This quote needs a quick manual review because there are multiple specialty window details. A team member can finish it without me guessing.",
          },
        };
      }
      if (!alreadyAsked) {
        capture(
          mergeFields(session, {
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              conditionalModifierQuestionAsked: action.field,
            },
          }),
          session.lastStep,
        );
      }
    }
    const prompt = action.field === "priceChangingAssumptionConfirmation"
      ? buildCanonicalPrePriceRecap(session.fields)
      : action.prompt;
    action = { ...action, prompt };
    capture(session, `asked:${action.field}`);
    return {
      sessionId: session.id,
      sessionPatch,
      pre: { kind: "fsm", action, spoken: `${discountSpeechPrefix}${prompt}` },
    };
  }
  if (action.kind === "calculate_price") {
    if (organizationId !== PUBLIC_BOOKING_ORGANIZATION_ID) {
      const blocked: WorkflowAction = {
        kind: "handoff",
        reason: "tenant_authority_required",
      };
      capture(session, "blocked:pricing_connector_unavailable");
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: blocked,
          spoken:
            "Pricing is not configured for this BluLadder organization, so I will not calculate or state a price.",
        },
      };
    }
    const loaded = pricingProbe?.loaded ??
      await measure("pricing", () => loadPricing(input.supabase));
    if (!loaded.ok || !loaded.pricing) {
      const failed: WorkflowAction = {
        kind: "handoff",
        reason: "pricing_error",
      };
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: failed,
          spoken: VOICE_RECOVERY_LANGUAGE.human_follow_up,
        },
      };
    }
    const pricing = loaded.pricing;
    const result = pricingProbe?.result ??
      await measure("pricing", () =>
        calculateQuote(
          quoteSessionFieldsToQuoteInput(session.fields),
          pricing,
          loaded.ruleVersion,
        ));
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
    const canonicalCustomerTotal =
      typeof result.estimatedTotal === "number" && result.estimatedTotal > 0
        ? result.estimatedTotal
        : result.total;
    const nextFields = {
      ...session.fields,
      lastQuoteResult: stamped,
      voiceJourney: {
        ...(session.fields.voiceJourney ?? {}),
        coupon: session.fields.voiceJourney?.coupon
          ? {
            ...session.fields.voiceJourney.coupon,
            authoritativeAmount: result.discount?.amount ?? null,
          }
          : null,
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
          spokenAt: new Date().toISOString(),
          acceptedAt: null,
        },
        availability: null,
        booking: { status: "not_started" as const },
      },
    };
    capture(
      { ...session, fields: nextFields, quoteStatus },
      "offered_post_price_choice",
    );
    const validDiscountCouldNotStack = validDiscountAppliedToFirmQuote &&
      disposition.finalQuoteDisposition === "firm" &&
      canonicalCustomerTotal > 0 &&
      session.fields.promotionId && !result.discount;
    const spoken = validDiscountCouldNotStack
      ? `That code is valid, but it cannot be combined with this promotion. Your total remains ${
        formatCanonicalCurrency(canonicalCustomerTotal)
      }, including tax.`
      : validDiscountAppliedToFirmQuote &&
          disposition.finalQuoteDisposition === "firm" &&
          canonicalCustomerTotal > 0
      ? `That code is valid. Your updated total is ${
        formatCanonicalCurrency(canonicalCustomerTotal)
      }, including tax.`
      : disposition.finalQuoteDisposition === "firm" &&
          canonicalCustomerTotal > 0
      ? expressPriceStatement(session, canonicalCustomerTotal)
      : disposition.finalQuoteDisposition === "estimated" &&
          canonicalCustomerTotal > 0
      ? `The current estimate is ${
        formatCanonicalCurrency(canonicalCustomerTotal)
      }. It is not a firm price yet.`
      : (disposition.finalQuoteDisposition === "manual_review" ||
          disposition.finalQuoteDisposition === "owner_decision_required")
      ? `${VOICE_RECOVERY_LANGUAGE.manual_review}${
        canonicalCustomerTotal > 0
          ? ` The independently priced portions currently total ${
            formatCanonicalCurrency(canonicalCustomerTotal)
          }.`
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
    const total = Number(last?.estimatedTotal ?? last?.total ?? 0);
    const disposition = String(last?.finalQuoteDisposition ?? "");
    const spoken = disposition === "firm" && total > 0
      ? expressPriceStatement(session, total)
      : disposition === "estimated" && total > 0
      ? `The current estimate is ${
        formatCanonicalCurrency(total)
      }. It is not a firm price yet.`
      : disposition === "manual_review" ||
          disposition === "owner_decision_required"
      ? VOICE_RECOVERY_LANGUAGE.manual_review
      : VOICE_RECOVERY_LANGUAGE.quote_needs_clarification;
    const currentQuoteContext = session.fields.voiceJourney?.quoteContext;
    capture(
      mergeFields(session, {
        voiceJourney: {
          ...(session.fields.voiceJourney ?? {}),
          quoteContext: currentQuoteContext
            ? { ...currentQuoteContext, spokenAt: new Date().toISOString() }
            : null,
        },
      }),
      "offered_post_price_choice",
    );
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
  // No controller-selected call may bypass deterministic safety gates through
  // the competing legacy orchestrator. Future actions must be wired here or
  // remain explicitly unavailable.
  const blocked: WorkflowAction = {
    kind: "handoff",
    reason: "out_of_scope_workflow",
  };
  capture(session, "blocked:unsupported_controller_action");
  return {
    sessionId: session.id,
    sessionPatch,
    pre: {
      kind: "fsm",
      action: blocked,
      spoken:
        "I can't safely complete that action in this call path yet. Nothing was changed.",
    },
  };
}

export type ControllerPatchPersistence =
  | { status: "persisted" | "noop" }
  | { status: "conflict" | "error"; reason: string };

/** Persist the sessionPatch returned by runControllerTurn. The update is
 * optimistic when the loaded row exposed updated_at, so interleaved turns
 * cannot silently overwrite one another's JSONB state. */
export async function persistControllerPatch(
  supabase: SB,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<ControllerPatchPersistence> {
  if (!sessionId || !patch) return { status: "noop" };
  const {
    __expected_updated_at: expectedUpdatedAt,
    __expected_organization_id: expectedOrganizationId,
    ...databasePatch
  } = patch;
  if (Object.keys(databasePatch).length === 0) return { status: "noop" };
  if (
    typeof expectedOrganizationId !== "string" || !expectedOrganizationId
  ) {
    return {
      status: "error",
      reason: "organization_authority_required",
    };
  }
  const fields = databasePatch.fields &&
      typeof databasePatch.fields === "object" &&
      !Array.isArray(databasePatch.fields)
    ? databasePatch.fields as QuoteSession["fields"]
    : null;
  const fieldStatus = databasePatch.field_status &&
      typeof databasePatch.field_status === "object" &&
      !Array.isArray(databasePatch.field_status)
    ? databasePatch.field_status as QuoteSession["fieldStatus"]
    : null;
  const phoneContactConfirmed = !!fields && (
    fields.callerIdConfirmationStatus === "contact_confirmed" ||
    fields.callerIdConfirmationStatus === "confirmed" ||
    fieldStatus?.phone === "verified" ||
    fieldStatus?.phone === "corrected"
  );
  const confirmedPhone = phoneContactConfirmed
    ? normalizePhone(fields?.phone)
    : null;
  if (confirmedPhone) databasePatch.phone_e164 = confirmedPhone;
  try {
    let query = supabase.from("quote_sessions").update(databasePatch).eq(
      "id",
      sessionId,
    );
    if (typeof expectedUpdatedAt === "string" && expectedUpdatedAt) {
      query = query.eq("updated_at", expectedUpdatedAt);
    }
    query = query.eq("organization_id", expectedOrganizationId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      return { status: "error", reason: "quote_session_update_failed" };
    }
    if (!data) {
      return { status: "conflict", reason: "quote_session_changed" };
    }
    return { status: "persisted" };
  } catch {
    return { status: "error", reason: "quote_session_update_failed" };
  }
}
