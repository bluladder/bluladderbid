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
// pricing/availability/booking boundaries directly. Tenant-scoped existing
// record and destructive appointment paths remain explicitly blocked until
// server-derived organization authority is available.
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
  type QuoteSession,
  sessionBookingInputsKey,
  sessionInputsKey,
} from "../quoteSession.ts";
import { quoteSessionFieldsToQuoteInput } from "../quoteSessionPricingAdapter.ts";
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
} from "../voice/voicePolicy.ts";

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
  /** Server-derived only. Missing/blocked authority is never replaced by DFW. */
  organizationAuthority?: OrganizationAuthorityResolution | null;
  /** Test seam for canonical provider/tool boundaries. */
  runTool?: typeof runTool;
  /** Sanitized stage timing callback; receives no customer content or ids. */
  onTiming?: (
    stage: "pricing" | "address_service_area" | "availability" | "booking",
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
        ? await probePricingMissing(input.supabase, session)
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
// intake, pricing, availability, and booking continuation. Tenant-scoped
// returning-customer lookup remains deferred.
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
  if (/\bstreet|road|drive|lane|avenue|boulevard\b|\bnot\b/i.test(text)) {
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

export async function runControllerTurn(
  input: ControllerInput,
): Promise<ControllerTurnResult> {
  const organizationId = requireControllerOrganization(input);
  const measure = async <T>(
    stage: "pricing" | "address_service_area" | "availability" | "booking",
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
  let session = await reloadSession(input.supabase, {
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    channel: input.channel,
    phone: input.phone,
    email: input.email,
    resolvedOrganizationId: organizationId,
  });
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
    capture(enriched, session.lastStep ?? "voice_policy_applied");
  }

  if (session.quoteStatus !== "none") {
    const requestedNextStep = /\b(text|send|message)\b/i.test(input.utterance)
      ? "text_quote" as const
      : /\b(schedule|book|appointment|time)\b/i.test(input.utterance)
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

  let f = session.fields;

  // Step 1: caller-ID confirmation dance (only when we have an ANI and no
  // confirmed phone yet). Never speaks the full number.
  const havePhone = !!f.phone &&
    (session.fieldStatus.phone === "captured" ||
      session.fieldStatus.phone === "verified");
  if (!havePhone && input.callerIdE164 && session.quoteStatus !== "none") {
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
      if (reply === "confirmed") {
        const proposed = f.callerIdProposedE164 || input.callerIdE164;
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

  // Step 2: tenant-scoped returning-customer resolution is intentionally not
  // wired until server-derived organization authority exists. The former
  // phone-only service-role lookup was cross-organization and could reveal a
  // stored first name. Remove any controller-era unscoped marker and continue
  // as ordinary intake without reading or disclosing customer records.
  if (f.returningCustomerId || f.awaitingDisambiguator) {
    const {
      returningCustomerId: _discardedCustomerId,
      awaitingDisambiguator: _discardedDisambiguation,
      ...safeFields
    } = session.fields;
    capture({ ...session, fields: safeFields }, "tenant_identity_deferred");
    f = session.fields;
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
      return {
        sessionId: session.id,
        sessionPatch,
        pre: {
          kind: "fsm",
          action: {
            kind: "ask",
            field: "address",
            prompt: buildAddressReadback(formatted),
          } as unknown as WorkflowAction,
          spoken: buildAddressReadback(formatted),
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
      const spoken = addressComponentQuestion(missing);
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
    capture(
      mergeFields(session, {
        serviceAreaStatus: "unavailable",
        serviceAreaResult: raw,
      }, { markDerived: ["serviceAreaStatus", "serviceAreaResult"] }),
      "service_area_unavailable",
    );
    const spoken =
      typeof raw.customerMessage === "string" && raw.customerMessage.trim()
        ? raw.customerMessage
        : "I couldn't verify that address right now, so I have not checked appointment times.";
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
          ? "eligible"
          : candidateStatus === "manual_review_required"
          ? "manual_review_required"
          : "unavailable";
        capture(
          mergeFields(session, {
            address: session.fields.address,
            serviceAreaStatus: confirmedStatus,
          }, { markVerified: ["address", "serviceAreaStatus"] }),
          "address_confirmed",
        );
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
      if (component) {
        const correction = normalizeAddressComponentAnswer(
          component,
          input.utterance,
        );
        if (correction) {
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
                pendingAddressComponent: null,
              },
            }),
            "address_correction_captured",
          );
          return await validateVoiceAddress(completed);
        }
      }
      const spoken =
        "Which part should I correct: the house number, street, city, state, or ZIP code?";
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            pendingAddressComponent: null,
          },
        }),
        "address_component:choose",
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
    if (!component) {
      const spoken =
        "Which part should I correct: the house number, street, city, state, or ZIP code?";
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
    if (token === "choose") {
      capture(
        mergeFields(session, {
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            pendingAddressComponent: component,
          },
        }),
        `address_component:${component}`,
      );
      const spoken = addressComponentQuestion(component);
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
    const value = normalizeAddressComponentAnswer(component, input.utterance);
    if (!value) {
      const spoken = addressComponentQuestion(component);
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
    const components = {
      ...(session.fields.addressComponents ?? {}),
      [component]: value,
    };
    const missing = nextMissingAddressComponent(components);
    if (
      !components.house_number || !components.street || !components.city ||
      !components.state || !components.postal_code
    ) {
      capture(
        mergeFields(session, {
          addressComponents: components,
          voiceJourney: {
            ...(session.fields.voiceJourney ?? {}),
            pendingAddressComponent: missing,
          },
        }),
        `address_component:${missing}`,
      );
      const spoken = addressComponentQuestion(missing);
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
    capture(
      mergeFields(session, { addressComponents: components }),
      "address_components_complete",
    );
    return await validateVoiceAddress(formatAddressComponents(components));
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
  if (askedField) {
    const parsed = applyCanonicalVoiceAnswer(
      session,
      askedField,
      input.utterance,
    );
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

  const pricingMissing = organizationId === PUBLIC_BOOKING_ORGANIZATION_ID
    ? await probePricingMissing(input.supabase, session)
    : null;
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
    const loaded = await measure("pricing", () => loadPricing(input.supabase));
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
    const result = await measure("pricing", () =>
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
    const spoken = disposition.finalQuoteDisposition === "firm" &&
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
