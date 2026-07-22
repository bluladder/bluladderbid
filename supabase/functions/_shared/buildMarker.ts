// ============================================================================
// buildMarker.ts — non-sensitive build/version marker.
//
// Emitted in safe diagnostics (adapter SSE trailer + GET diagnostics), never
// spoken to callers. Bump BUILD_ID whenever a voice-adapter behavioral change
// is deployed so tests can assert which code version handled a call.
// ============================================================================

export const BUILD_ID = "voice-adapter-4C-b.6.2-window-condition-intake-parity";
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
} as const;
