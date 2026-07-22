// ============================================================================
// voiceProviderConfig.ts — Vapi assistant manifest for the isolated Phase 4C-β
// direct-DID test. This is the version-controlled source of truth for the
// exact provider configuration the owner must create in the Vapi dashboard.
//
// The manifest is provider-shaped but deliberately free of secrets, phone
// numbers, tool bindings, transfer destinations, and CallRail configuration.
// It ONLY describes an isolated inbound English-only assistant whose custom
// LLM is the BluLadder voice-llm-adapter. Business logic remains inside
// runOrchestrator().
//
// Anything that must vary per-environment (adapter URL, provider secrets) is
// resolved from environment variables at build time by the owner tooling — it
// is never inlined into the manifest at rest.
// ============================================================================

/** Fixed spoken duration warnings. Exact copy per Phase 4C-β spec. */
export const VOICE_BETA_WARNING_780 =
  "Just a heads-up, we have about two minutes left on this call. I'll make sure you have a way to continue by text if we need it.";
export const VOICE_BETA_WARNING_870 =
  "We have about thirty seconds left. I'll make sure we have the important details before the call ends.";
/** Fixed spoken cutoff copy at the 900-second hard boundary. Does not promise
 *  a follow-up SMS — post-call SMS is deferred to Phase 4C-γ. */
export const VOICE_BETA_CUTOFF_MESSAGE =
  "We've reached the time limit for this call. Thanks for calling BluLadder. We'll be able to continue through our normal contact options.";

export const VOICE_BETA_MAX_DURATION_SECONDS = 900;
export const VOICE_BETA_TIME_ELAPSED_HOOKS_SECONDS = [780, 870] as const;

export interface VoiceBetaManifest {
  name: string;
  isolated: true;
  inboundOnly: true;
  language: "en";
  model: {
    provider: "custom-llm";
    url: string;
    // Provider-agnostic hint. The real credential is attached in the Vapi
    // dashboard as a server-side API key; it never appears in this manifest.
    authenticationMode: "bearer-api-key";
    stream: true;
  };
  // No provider tools of any kind in this phase. The orchestrator owns every
  // business decision. Explicit empty list so future edits are deliberate.
  tools: [];
  // No phone number configuration in this manifest — the isolated test DID is
  // attached in the Vapi dashboard by the owner and never checked into the
  // repository.
  phoneNumber: null;
  // No transfer destination configured. Human transfer is Phase 4C-γ.
  transferDestination: null;
  duration: {
    maxDurationSeconds: 900;
    hardCutoffMessage: string;
    timeElapsedHooks: Array<{ seconds: number; say: string }>;
  };
  artifactSuppression: {
    recordingEnabled: false;
    videoRecordingEnabled: false;
    pcapEnabled: false;
    loggingEnabled: false;
    fullMessageHistoryEnabled: false;
    transcriptArtifactEnabled: false;
    summaryGenerationEnabled: false;
    structuredOutputEnabled: false;
    analysisEnabled: false;
  };
  serverEvents: {
    url: string;
    // Auth is a shared header credential; the actual secret value is attached
    // in the Vapi dashboard by the owner.
    authenticationMode: "shared-header-credential";
    // Restricted allowlist for the direct-DID slice.
    events: ReadonlyArray<
      "assistant.started" | "status-update" | "hang" | "end-of-call-report"
    >;
  };
  callRail: null;
}

export interface BuildManifestInput {
  /** Fully-qualified voice-llm-adapter URL, e.g. https://<ref>.supabase.co/functions/v1/voice-llm-adapter */
  adapterUrl: string;
  /** Fully-qualified voice-vapi-events URL. */
  serverEventsUrl: string;
}

export function buildVoiceBetaAssistantManifest(input: BuildManifestInput): VoiceBetaManifest {
  const { adapterUrl, serverEventsUrl } = input;
  if (!isHttpsUrl(adapterUrl)) throw new Error("adapterUrl must be an https URL");
  if (!isHttpsUrl(serverEventsUrl)) throw new Error("serverEventsUrl must be an https URL");
  return {
    name: "BluLadder Voice Beta (isolated direct-DID test)",
    isolated: true,
    inboundOnly: true,
    language: "en",
    model: {
      provider: "custom-llm",
      url: adapterUrl,
      authenticationMode: "bearer-api-key",
      stream: true,
    },
    tools: [],
    phoneNumber: null,
    transferDestination: null,
    duration: {
      maxDurationSeconds: 900,
      hardCutoffMessage: VOICE_BETA_CUTOFF_MESSAGE,
      timeElapsedHooks: [
        { seconds: 780, say: VOICE_BETA_WARNING_780 },
        { seconds: 870, say: VOICE_BETA_WARNING_870 },
      ],
    },
    artifactSuppression: {
      recordingEnabled: false,
      videoRecordingEnabled: false,
      pcapEnabled: false,
      loggingEnabled: false,
      fullMessageHistoryEnabled: false,
      transcriptArtifactEnabled: false,
      summaryGenerationEnabled: false,
      structuredOutputEnabled: false,
      analysisEnabled: false,
    },
    serverEvents: {
      url: serverEventsUrl,
      authenticationMode: "shared-header-credential",
      events: ["assistant.started", "status-update", "hang", "end-of-call-report"],
    },
    callRail: null,
  };
}

function isHttpsUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Server events accepted by voice-vapi-events during Phase 4C-β. */
export const VOICE_VAPI_ALLOWED_EVENTS = [
  "assistant.started",
  "status-update",
  "hang",
  "end-of-call-report",
] as const;
export type VoiceVapiAllowedEvent = typeof VOICE_VAPI_ALLOWED_EVENTS[number];