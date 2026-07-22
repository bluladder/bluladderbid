// ============================================================================
// buildMarker.ts — non-sensitive build/version marker.
//
// Emitted in safe diagnostics (adapter SSE trailer + GET diagnostics), never
// spoken to callers. Bump BUILD_ID whenever a voice-adapter behavioral change
// is deployed so tests can assert which code version handled a call.
// ============================================================================

export const BUILD_ID = "voice-adapter-4C-b.3G.1-voice-early-quote";
export const BUILD_FEATURES = {
  voiceEarlyQuote: true,
  voiceBookingDryRun: true,
} as const;
