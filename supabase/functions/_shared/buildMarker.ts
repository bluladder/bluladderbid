// ============================================================================
// buildMarker.ts — non-sensitive build/version marker.
//
// Emitted in safe diagnostics (adapter SSE trailer + GET diagnostics), never
// spoken to callers. Bump BUILD_ID whenever a voice-adapter behavioral change
// is deployed so tests can assert which code version handled a call.
// ============================================================================

export const BUILD_ID = "voice-realtime-link-mvp.3-openai-tool-envelope";
export const BUILD_FEATURES = {
  // Issue #91 — native OpenAI Realtime provider target plus two exact,
  // no-argument customer-link tools on the authenticated Vapi webhook.
  voiceRealtimeLinkMvp: true,
  voiceRealtimeNativeAudio: true,
  voiceRealtimeQuoteLinkTool: true,
  voiceRealtimeBookingManagementLinkTool: true,
  voiceRealtimeStringToolResults: true,
  voiceRealtimeOpenAiToolEnvelope: true,
  voiceRealtimeSchedulingFaq: true,
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
  // 6.10 — the stream producer no longer exposes an async start barrier;
  // exact completed-turn retries may replay only their durable canonical
  // reply, and provider interruption thresholds reject incidental audio.
  voiceControllerSynchronousStreamStart: true,
  voiceCompletedTurnReplay: true,
  // 6.11 — explicit full-number answers advance the confirmed contact gate,
  // and interrupted-response stale claims enter the same exact-lineage replay
  // resolver without rerunning controller or provider work.
  voiceStaleCompletedTurnReplay: true,
  voiceConfirmedPhoneProjection: true,
  voiceProviderBoundedInterruption: true,
  // 6.12 — preserve the controller's pending contact question, understand
  // spoken phone digits, accept a directly supplied full name without a
  // redundant readback, avoid eager pricing work, and use a natural bounded
  // acknowledgement while slow deterministic work finishes.
  voiceControllerPromptAuthority: true,
  voiceSpokenPhoneWords: true,
  voiceSingleTurnNameVerification: true,
  voiceLazyPricingProbe: true,
  voiceNaturalSlowTurnAcknowledgement: true,
  voiceWaitCompletedTurnReplay: true,
  // 6.13 — failed owner-call recovery: contextual outside-only ASR,
  // one-turn identity prompts, deliberately paced contact/address readbacks,
  // sentence-aware speech chunks, content-chunk latency evidence, and a
  // tenant/call-scoped latest-authoritative fallback for stale retries whose
  // exact old journal row is unavailable.
  voiceContextualOutsideHomophone: true,
  voiceCompleteIdentityPrompts: true,
  voiceDeliberateContactReadback: true,
  voiceSentenceAwareStreaming: true,
  voiceFirstContentChunkLatency: true,
  voiceLatestAuthoritativeStaleReplay: true,
  // 6.14 — ordinary whole-home callers hear both canonical window packages
  // before choosing; colloquial contact confirmations persist durably without
  // widening booking authority; projection reuses the optimistic winner row,
  // journal writes run concurrently, and wait retries cover the measured tail.
  voiceDualWholeHomeWindowPackages: true,
  voiceScopedContactConfirmation: true,
  voiceConfirmedEmailPersistence: true,
  voiceProjectionWinnerReuse: true,
  voiceConcurrentTurnJournal: true,
  voiceMeasuredWaitReplayWindow: true,
} as const;
