// ============================================================================
// buildMarker.ts — non-sensitive build/version marker.
//
// Emitted in safe diagnostics (adapter SSE trailer + GET diagnostics), never
// spoken to callers. Bump BUILD_ID whenever a voice-adapter behavioral change
// is deployed so tests can assert which code version handled a call.
// ============================================================================

export const BUILD_ID = "voice-adapter-4C-b.6.3-quote-by-text-live-delivery";
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
  // Voice quote-by-text now performs a real customer-facing delivery through
  // save-quote + send-sms. It is NOT gated on the booking rollout flags.
  voiceQuoteByTextDelivery: true,
} as const;
