// ============================================================================
// Transaction boundary for the rollout-gated deterministic voice controller.
//
// The Edge handler delegates here so direct tests cover the real ordering:
// decide -> persist QuoteSession -> project conversation -> prepare local
// identity/property -> re-project lineage -> journal the exact spoken turn.
// ============================================================================

import { deterministicUuid } from "../deterministicUuid.ts";
import type { QuoteSession } from "../quoteSession.ts";
import type { ConversationFacts } from "../conversationState.ts";
import type { OrganizationAuthorityResolution } from "../organizationAuthority.ts";
import {
  type ControllerPreAction,
  type ControllerTurnResult,
  persistControllerPatch,
  runControllerTurn,
} from "../workflow/workflowController.ts";
import type { ChatMessage } from "../voiceAdapter.ts";
import {
  buildQuoteSessionConversationProjection,
  projectQuoteSessionToConversation,
  type QuoteSessionProjectionResult,
  readScopedQuoteSession,
} from "./quoteSessionProjection.ts";
import {
  prepareVoiceBookingIdentity,
  type VoiceIdentityPreparationResult,
} from "./voiceBookingIdentityPreparation.ts";
import {
  recordVoiceTurns,
  voiceTranscriptRetentionExpiresAt,
  type VoiceTurnJournalResult,
} from "./turnJournal.ts";
import { planQuoteByTextResponse } from "./quoteByText.ts";
import {
  type CallEdgeFunction,
  deliverVoiceQuoteByText,
  type VoiceQuoteDeliveryResult,
} from "./quoteByTextDelivery.ts";
import {
  buildCanonicalPrePriceRecap,
  promptForCanonicalField,
} from "./voiceCanonicalIntake.ts";
import { classifyContextualVoiceQuoteByTextRequest } from "./voicePolicy.ts";
import type { runTool } from "../aiTools.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export interface ControllerRouteTimings {
  controllerMs: number;
  persistenceMs: number;
  projectionMs: number;
  identityPreparationMs: number;
  journalMs: number;
  pricingMs: number;
  addressServiceAreaMs: number;
  availabilityMs: number;
  bookingMs: number;
}

export interface ExecuteControllerRouteInput {
  supabase: SB;
  conversationId: string;
  organizationId: string;
  organizationAuthority: OrganizationAuthorityResolution;
  callId: string;
  messages: ChatMessage[];
  /** Original provider messages before parsing-only normalization. */
  journalMessages?: ChatMessage[];
  callerIdE164?: string | null;
  callFunction?: CallEdgeFunction;
  runTool?: typeof runTool;
}

export interface ExecuteControllerRouteDeps {
  runController?: typeof runControllerTurn;
  persist?: typeof persistControllerPatch;
  project?: typeof projectQuoteSessionToConversation;
  readSession?: typeof readScopedQuoteSession;
  prepareIdentity?: typeof prepareVoiceBookingIdentity;
  journal?: typeof recordVoiceTurns;
  deliverQuote?: typeof deliverVoiceQuoteByText;
}

export interface ExecuteControllerRouteResult {
  spoken: string;
  pre: ControllerPreAction;
  sessionId: string;
  stateCommitted: boolean;
  projection: QuoteSessionProjectionResult | null;
  identityPreparation: VoiceIdentityPreparationResult | null;
  journal: VoiceTurnJournalResult;
  timings: ControllerRouteTimings;
  event: string;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function elapsed(started: number): number {
  return Math.max(0, Math.round(now() - started));
}

function objectContains(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return Object.is(expected, actual);
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => objectContains(value, actual[index]));
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  return Object.entries(expected as Record<string, unknown>).every(
    ([key, value]) =>
      Object.prototype.hasOwnProperty.call(actual, key) &&
      objectContains(value, (actual as Record<string, unknown>)[key]),
  );
}

function proposedFieldsAlreadyPresent(
  turn: ControllerTurnResult,
  latest: QuoteSession | null,
): boolean {
  const expected = turn.sessionPatch.fields;
  return !!latest && !!expected && objectContains(expected, latest.fields);
}

function recoveryPrompt(latest: QuoteSession | null): string {
  const field = latest?.lastStep?.startsWith("asked:")
    ? latest.lastStep.slice("asked:".length)
    : null;
  if (!field) return "Please repeat your last answer.";
  return field === "priceChangingAssumptionConfirmation"
    ? buildCanonicalPrePriceRecap(latest!.fields)
    : promptForCanonicalField(field);
}

function persistenceFailureSpoken(turn: ControllerTurnResult): string {
  const bookingAlreadyConfirmed = turn.pre.kind === "fsm" &&
    turn.pre.action.kind === "confirm_result" &&
    turn.pre.action.success === true;
  const bookingWasAttempted = turn.pre.kind === "fsm" &&
    turn.pre.action.kind === "confirm_result";
  return bookingAlreadyConfirmed
    ? `${turn.pre.spoken} I couldn't save the call's progress marker, so please don't repeat the booking request.`
    : bookingWasAttempted
    ? `${turn.pre.spoken} I also couldn't save the call's progress marker. I will not repeat the booking request automatically; a team member should verify the result.`
    : "I couldn't safely save that answer because the call state changed. I have not advanced the request. Please try that answer once more, or a team member can help.";
}

function reconstruct(messages: ChatMessage[]): {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  lastUserIndex: number;
  nonSystemCount: number;
} {
  const nonSystem = messages.filter((message) =>
    message.role !== "system" && message.role !== "tool"
  );
  let lastUserIndex = -1;
  for (let index = nonSystem.length - 1; index >= 0; index--) {
    if (nonSystem[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return {
    history: lastUserIndex >= 0
      ? nonSystem.slice(0, lastUserIndex).map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }))
      : [],
    userMessage: lastUserIndex >= 0 ? nonSystem[lastUserIndex].content : "",
    lastUserIndex,
    nonSystemCount: nonSystem.length,
  };
}

export async function executeControllerRoute(
  input: ExecuteControllerRouteInput,
  deps: ExecuteControllerRouteDeps = {},
): Promise<ExecuteControllerRouteResult> {
  const runController = deps.runController ?? runControllerTurn;
  const persist = deps.persist ?? persistControllerPatch;
  const project = deps.project ?? projectQuoteSessionToConversation;
  const readSession = deps.readSession ?? readScopedQuoteSession;
  const prepareIdentity = deps.prepareIdentity ?? prepareVoiceBookingIdentity;
  const journalTurns = deps.journal ?? recordVoiceTurns;
  const deliverQuote = deps.deliverQuote ?? deliverVoiceQuoteByText;
  const reconstructed = reconstruct(input.messages);
  const journalReconstructed = reconstruct(
    input.journalMessages ?? input.messages,
  );
  const stageTimings = {
    pricing: 0,
    address_service_area: 0,
    availability: 0,
    booking: 0,
  };
  const timings: ControllerRouteTimings = {
    controllerMs: 0,
    persistenceMs: 0,
    projectionMs: 0,
    identityPreparationMs: 0,
    journalMs: 0,
    pricingMs: 0,
    addressServiceAreaMs: 0,
    availabilityMs: 0,
    bookingMs: 0,
  };

  const controllerStarted = now();
  const turn = await runController({
    supabase: input.supabase,
    conversationId: input.conversationId,
    channel: "voice",
    utterance: reconstructed.userMessage,
    history: reconstructed.history,
    callerIdE164: input.callerIdE164,
    organizationAuthority: input.organizationAuthority,
    runTool: input.runTool,
    onTiming(stage, durationMs) {
      stageTimings[stage] += durationMs;
    },
  });
  timings.controllerMs = elapsed(controllerStarted);
  timings.pricingMs = stageTimings.pricing;
  timings.addressServiceAreaMs = stageTimings.address_service_area;
  timings.availabilityMs = stageTimings.availability;
  timings.bookingMs = stageTimings.booking;

  let spoken = turn.pre.spoken;
  let event = "workflow_controller";
  let stateCommitted = false;
  let projection: QuoteSessionProjectionResult | null = null;
  let identityPreparation: VoiceIdentityPreparationResult | null = null;
  let committedSession: QuoteSession | null = null;

  const persistenceStarted = now();
  let persistence = await persist(
    input.supabase,
    turn.sessionId,
    turn.sessionPatch,
  );
  timings.persistenceMs = elapsed(persistenceStarted);
  let conflictPrompt: string | null = null;
  if (persistence.status === "conflict") {
    const latest = await readSession(
      input.supabase,
      turn.sessionId,
      input.organizationId,
    );
    if (proposedFieldsAlreadyPresent(turn, latest)) {
      persistence = { status: "noop" };
    } else {
      conflictPrompt = recoveryPrompt(latest);
    }
  }
  if (persistence.status === "conflict" || persistence.status === "error") {
    spoken = conflictPrompt ?? persistenceFailureSpoken(turn);
    event = "workflow_controller_persistence_blocked";
  } else {
    stateCommitted = true;
    const projectionStarted = now();
    projection = await project(input.supabase, {
      sessionId: turn.sessionId,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
    });
    timings.projectionMs += elapsed(projectionStarted);
    if (projection.status === "conflict" || projection.status === "error") {
      spoken =
        "I saved that answer in the quote form, but I couldn't safely synchronize the customer record. I have not checked availability or advanced the request. Please try once more, or a team member can help.";
      event = "workflow_controller_projection_blocked";
    } else {
      const session = await readSession(
        input.supabase,
        turn.sessionId,
        input.organizationId,
      );
      committedSession = session;
      if (!session) {
        spoken =
          "I saved that answer, but I couldn't safely reload the quote form. I have not checked availability or advanced the request.";
        event = "workflow_controller_projection_blocked";
      } else {
        const mayPrepareIdentity = session.quoteStatus === "firm" &&
          session.fields.voiceJourney?.requestedNextStep != null &&
          session.fields.voiceJourney.requestedNextStep !== "none" &&
          turn.pre.kind === "fsm" &&
          (turn.pre.action.kind === "ask" ||
            turn.pre.action.kind === "offer_scheduling");
        if (mayPrepareIdentity) {
          const identityStarted = now();
          identityPreparation = await prepareIdentity(input.supabase, {
            session,
            conversationId: input.conversationId,
            organizationId: input.organizationId,
          });
          timings.identityPreparationMs = elapsed(identityStarted);
          if (
            identityPreparation.status === "blocked" ||
            identityPreparation.status === "error"
          ) {
            spoken =
              "I saved your confirmed answers, but I couldn't safely link the customer and property records. I have not checked availability or booked anything. A team member needs to verify the account.";
            event = "workflow_controller_identity_blocked";
          } else if (identityPreparation.status === "ready") {
            const lineageProjectionStarted = now();
            projection = await project(input.supabase, {
              sessionId: turn.sessionId,
              conversationId: input.conversationId,
              organizationId: input.organizationId,
            });
            timings.projectionMs += elapsed(lineageProjectionStarted);
            if (
              projection.status === "conflict" || projection.status === "error"
            ) {
              spoken =
                "I linked the local customer and property, but I couldn't safely synchronize the call record. I have not checked availability or advanced the request.";
              event = "workflow_controller_projection_blocked";
            }
          }
        }
      }
    }
  }

  // The generated-quote rail is sticky across the bounded post-price intake:
  // the caller asks once, then the rail resumes after each required answer.
  // Once any durable delivery outcome exists, ordinary later turns do not
  // re-enter the operation unless a new quote fingerprint creates new
  // authority.
  if (stateCommitted && event === "workflow_controller") {
    const deliverySession = committedSession;
    const explicitRequest = classifyContextualVoiceQuoteByTextRequest(
      reconstructed.userMessage,
    );
    const delivery = deliverySession?.fields.voiceJourney?.delivery;
    const stickyOpenRequest = !!deliverySession &&
      deliverySession.fields.voiceJourney?.requestedNextStep === "text_quote" &&
      !delivery;
    const deliveryAllowed = !!deliverySession &&
      deliverySession.quoteStatus === "firm" &&
      deliverySession.fields.voiceJourney?.requestedNextStep === "text_quote" &&
      (explicitRequest || stickyOpenRequest);

    if (deliveryAllowed && deliverySession) {
      const projectionForFacts = buildQuoteSessionConversationProjection({
        session: deliverySession,
        conversation: {
          id: input.conversationId,
          organization_id: input.organizationId,
        },
      });
      const facts = projectionForFacts.facts as ConversationFacts;
      const last = deliverySession.fields.lastQuoteResult;
      const total = Number(
        last?.estimatedTotal ?? last?.total ??
          deliverySession.fields.voiceJourney?.quoteContext?.estimatedTotal ??
          0,
      );
      const deliveryState: { current: VoiceQuoteDeliveryResult | null } = {
        current: null,
      };
      const plan = await planQuoteByTextResponse({
        quoteIsFirm: last?.finalQuoteDisposition === "firm",
        total,
        name: deliverySession.fields.name ?? null,
        nameConfirmed: deliverySession.fieldStatus.name === "verified" ||
          deliverySession.fieldStatus.name === "corrected",
        phone: deliverySession.fields.phone ?? null,
        phoneIsFullE164: !!deliverySession.fields.phone,
        phoneConfirmed: deliverySession.fieldStatus.phone === "verified" ||
          deliverySession.fieldStatus.phone === "corrected" ||
          deliverySession.fields.callerIdConfirmationStatus ===
            "contact_confirmed" ||
          deliverySession.fields.callerIdConfirmationStatus === "confirmed",
        address: deliverySession.fields.address ?? null,
        addressEligible:
          deliverySession.fields.serviceAreaStatus === "eligible" &&
          (deliverySession.fieldStatus.address === "verified" ||
            deliverySession.fieldStatus.address === "corrected"),
        deliver: input.callFunction
          ? async () => {
            deliveryState.current = await deliverQuote({
              supabase: input.supabase,
              facts,
              organizationId: input.organizationId,
              quoteSessionId: deliverySession.id,
              conversationId: input.conversationId,
              callFunction: input.callFunction!,
            });
            return deliveryState.current;
          }
          : null,
      });
      spoken = plan.reply;
      event = plan.event;

      // deliverVoiceQuoteByText owns the durable claim and final evidence.
      // This projection only makes the exact outcome visible to the post-call
      // selector; projection failure never changes provider truth.
      if (deliveryState.current) {
        const deliveryProjection = await project(input.supabase, {
          sessionId: deliverySession.id,
          conversationId: input.conversationId,
          organizationId: input.organizationId,
        });
        if (
          deliveryProjection.status === "conflict" ||
          deliveryProjection.status === "error"
        ) {
          projection = deliveryProjection;
          spoken = deliveryState.current.status === "provider_accepted"
            ? `${plan.reply} The call record did not synchronize, so the team should verify it before any manual resend.`
            : `${plan.reply} The call record did not synchronize, so the team should verify the delivery state.`;
          event = "voice_quote_by_text_projection_blocked";
        }
      }
    }
  }

  const turnIdentity = await deterministicUuid(
    "voice-controller-request",
    input.callId,
    String(journalReconstructed.nonSystemCount),
    String(journalReconstructed.lastUserIndex),
    journalReconstructed.userMessage,
  );
  const journalStarted = now();
  const journal = await journalTurns(input.supabase, {
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    callId: input.callId,
    turnIdentity,
    state: turn.pre.kind === "fsm" ? turn.pre.action.kind : turn.pre.kind,
    source: "controller",
    retentionExpiresAt: voiceTranscriptRetentionExpiresAt(),
    turns: [
      { role: "user", content: journalReconstructed.userMessage },
      { role: "assistant", content: spoken },
    ],
  });
  timings.journalMs = elapsed(journalStarted);

  return {
    spoken,
    pre: turn.pre,
    sessionId: turn.sessionId,
    stateCommitted,
    projection,
    identityPreparation,
    journal,
    timings,
    event,
  };
}
