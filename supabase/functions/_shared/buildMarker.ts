// ============================================================================
// buildMarker.ts — non-sensitive build/version marker.
//
// Emitted in safe diagnostics (adapter SSE trailer + GET diagnostics), never
// spoken to callers. Bump BUILD_ID whenever a voice-adapter behavioral change
// is deployed so tests can assert which code version handled a call.
// ============================================================================

export const BUILD_ID = "voice-adapter-4C-b.4-progressive-quote-session";
export const BUILD_FEATURES = {
  voiceEarlyQuote: true,
  voiceAddressFreeRoughQuote: true,
  voiceBookingDryRun: true,
  progressiveQuoteSession: true,
} as const;
