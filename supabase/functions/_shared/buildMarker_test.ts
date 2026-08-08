// Deno tests: build marker present in safe diagnostics, never in spoken content.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BUILD_FEATURES, BUILD_ID } from "./buildMarker.ts";
import {
  type AdapterCompletion,
  buildNonStreamingResponse,
} from "./voiceAdapter.ts";

Deno.test("BUILD_ID is a non-empty stable string", () => {
  assert(typeof BUILD_ID === "string" && BUILD_ID.length > 0);
});

Deno.test("BUILD_FEATURES exposes address-free voice rough quote marker", () => {
  assertEquals(BUILD_FEATURES.voiceEarlyQuote, true);
  assertEquals(BUILD_FEATURES.voiceAddressFreeRoughQuote, true);
  assertEquals(BUILD_FEATURES.voiceBookingDryRun, true);
});

Deno.test("BUILD_FEATURES exposes Phase 4C-β.4A window scope + partial + commercial flags", () => {
  assertEquals(BUILD_FEATURES.progressiveQuoteSession, true);
  assertEquals(BUILD_FEATURES.windowScopeClassification, true);
  assertEquals(BUILD_FEATURES.partialWindowPricing, true);
  assertEquals(BUILD_FEATURES.commercialCustomBidIntake, true);
});

Deno.test("BUILD_FEATURES exposes Phase 4C-β.4B stable-session + workflow-controller flags", () => {
  assertEquals(BUILD_FEATURES.stableVoiceSessionId, true);
  // Controller remains gated until parity is proven end-to-end.
  assertEquals(BUILD_FEATURES.useWorkflowController, "gated");
});

Deno.test("BUILD_FEATURES exposes the post-hangup bid-link follow-up flag", () => {
  assertEquals(BUILD_FEATURES.voiceHangupBidLinkFollowup, true);
});

Deno.test("BUILD marker exposes the 6.7 voice remediation flags", () => {
  assertEquals(BUILD_FEATURES.voiceSpokenAddressNormalization, true);
  assertEquals(BUILD_FEATURES.voiceAddressConfirmationGate, true);
  assertEquals(BUILD_FEATURES.voiceReplySafety, true);
  assertEquals(BUILD_FEATURES.voiceExitIntentHandling, true);
});

Deno.test("BUILD marker exposes the 6.13 owner-call recovery flags", () => {
  assert(BUILD_ID.includes("6.13"));
  assertEquals(BUILD_ID, "voice-adapter-4C-b.6.13-owner-call-recovery");
  assertEquals(BUILD_FEATURES.voiceControllerDeferredSse, true);
  assertEquals(
    BUILD_FEATURES.voiceControllerBoundedFlushAcknowledgement,
    true,
  );
  assertEquals(BUILD_FEATURES.voiceProviderEndCallPhrasesDisabled, true);
  assertEquals(BUILD_FEATURES.voiceControllerSynchronousStreamStart, true);
  assertEquals(BUILD_FEATURES.voiceCompletedTurnReplay, true);
  assertEquals(BUILD_FEATURES.voiceStaleCompletedTurnReplay, true);
  assertEquals(BUILD_FEATURES.voiceConfirmedPhoneProjection, true);
  assertEquals(BUILD_FEATURES.voiceProviderBoundedInterruption, true);
  assertEquals(BUILD_FEATURES.voiceControllerPromptAuthority, true);
  assertEquals(BUILD_FEATURES.voiceSpokenPhoneWords, true);
  assertEquals(BUILD_FEATURES.voiceSingleTurnNameVerification, true);
  assertEquals(BUILD_FEATURES.voiceLazyPricingProbe, true);
  assertEquals(BUILD_FEATURES.voiceNaturalSlowTurnAcknowledgement, true);
  assertEquals(BUILD_FEATURES.voiceWaitCompletedTurnReplay, true);
  assertEquals(BUILD_FEATURES.voiceContextualOutsideHomophone, true);
  assertEquals(BUILD_FEATURES.voiceCompleteIdentityPrompts, true);
  assertEquals(BUILD_FEATURES.voiceDeliberateContactReadback, true);
  assertEquals(BUILD_FEATURES.voiceSentenceAwareStreaming, true);
  assertEquals(BUILD_FEATURES.voiceFirstContentChunkLatency, true);
  assertEquals(BUILD_FEATURES.voiceLatestAuthoritativeStaleReplay, true);
});

Deno.test("BUILD marker exposes the 6.8 address-gate enforcement flags", () => {
  assertEquals(BUILD_FEATURES.voiceAddressGateEnforcedPersistence, true);
  assertEquals(BUILD_FEATURES.voiceAddressPendingConfirmationState, true);
  assertEquals(BUILD_FEATURES.voiceDeterministicRailPriority, true);
  assertEquals(BUILD_FEATURES.voiceReplyFinalizeFunnel, true);
  assertEquals(BUILD_FEATURES.voiceHouseNumberMismatchRecovery, true);
  assertEquals(BUILD_FEATURES.voiceTruthfulEscalationLanguage, true);
});

Deno.test("buildNonStreamingResponse: buildId is in bluladder diagnostics", async () => {
  const completion: AdapterCompletion = {
    content: "Your rough exterior window quote is ready.",
    action: { kind: "tool_result_speak" },
    orchestrator: {
      reply: "",
      toolEvents: [],
      events: [],
      state: "quote_ready",
      voice: null,
    },
  };
  const res = buildNonStreamingResponse("m", completion);
  const body = await res.json();
  assertEquals(body.bluladder.buildId, BUILD_ID);
});

Deno.test("buildNonStreamingResponse: buildId is NOT in the assistant content spoken to caller", async () => {
  const completion: AdapterCompletion = {
    content: "Your rough exterior window quote is ready.",
    action: { kind: "tool_result_speak" },
    orchestrator: {
      reply: "",
      toolEvents: [],
      events: [],
      state: "quote_ready",
      voice: null,
    },
  };
  const res = buildNonStreamingResponse("m", completion);
  const body = await res.json();
  const spoken = body.choices[0].message.content as string;
  assert(
    !spoken.includes(BUILD_ID),
    "build id must never appear in spoken content",
  );
});
