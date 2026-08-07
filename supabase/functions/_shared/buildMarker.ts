// ============================================================================
// buildMarker.ts — non-sensitive build/version marker.
//
// Emitted in safe diagnostics (adapter SSE trailer + GET diagnostics), never
// spoken to callers. Bump BUILD_ID whenever a voice-adapter behavioral change
// is deployed so tests can assert which code version handled a call.
// ============================================================================

export const BUILD_ID = "voice-adapter-4C-b.6.9-deferred-sse";
export const BUILD_FEATURES = {
  voiceEarlyQuote: true,
  voiceAddressFreeRoughQuote: true,
  voiceBookingDryRun: true,
  progressiveQuoteSession: true,
  windowScopeClassification: true,
  partialWindowPricing: true,
  commercialCustomBidIntake: true,
  stableVoiceSessionId: true,
  useWorkflowController: "gated" as const,
  workflowControllerCallerIdConfirmation: true,
  workflowControllerReturningCustomer: true,
  sharedIntakeManifest: true,
  contactFirstIntake: true,
  voiceRoughQuoteReplayGuard: true,
  slowBranchAcknowledgementVariety: true,
  residentialWindowConditionIntakeParity: true,
  // Voice quote-by-text performs a real customer-facing delivery through
  // save-quote + send-sms, gated by the existing voice live flag + allowlist.
  voiceQuoteByTextDelivery: true,
  voiceQuoteByTextLive: true,
  // Post-hangup online-bid SMS fallback, triggered only by the authoritative
  // final call-ended event and delivered through the durable SMS outbox.
  voiceHangupBidLinkFollowup: true,
  // 6.7 — deterministic spoken-address normalization + explicit voice address
  // confirmation gate, spoken-reply safety (no internal reasoning, one
  // question per turn) and deterministic exit/human-request handling.
  voiceSpokenAddressNormalization: true,
  voiceAddressConfirmationGate: true,
  voiceReplySafety: true,
  voiceExitIntentHandling: true,
  // 6.8 — the gate is now enforced on every write path: the canonical
  // service-area columns are gated + mirrored, pending_confirmation is a
  // validating state (never manual review), the deterministic rails run first,
  // finalize is the single voice reply funnel, house-number mismatch recovers
  // across turns and human/hangup language is truthful.
  voiceAddressGateEnforcedPersistence: true,
  voiceAddressPendingConfirmationState: true,
  voiceDeterministicRailPriority: true,
  voiceReplyFinalizeFunnel: true,
  voiceHouseNumberMismatchRecovery: true,
  voiceTruthfulEscalationLanguage: true,
  // 6.9 — controller streams establish the provider response before deferred
  // processing, use one bounded neutral flush acknowledgement, and never let
  // provider-side phrases terminate an active quote turn.
  voiceControllerDeferredSse: true,
  voiceControllerBoundedFlushAcknowledgement: true,
  voiceProviderEndCallPhrasesDisabled: true,
} as const;
