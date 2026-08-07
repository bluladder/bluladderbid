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
/** Vapi limits assistant names to 40 characters. */
export const VOICE_BETA_ASSISTANT_NAME = "BluLadder Voice Beta (isolated)";

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
  transcriber: {
    provider: "deepgram";
    model: "nova-3";
    language: "en";
    smartFormat: true;
    keyterm: string[];
    fallbackPlan: {
      // Fail closed: implicit fallback could send caller audio to an
      // unreviewed transcription provider.
      autoFallback: { enabled: false };
      transcribers: Array<{
        provider: "assembly-ai";
        speechModel: "universal-streaming-english";
        language: "en";
        keytermsPrompt: string[];
        vadAssistedEndpointingEnabled: true;
      }>;
    };
  };
  startSpeakingPlan: {
    waitSeconds: number;
    smartEndpointingPlan: {
      provider: "livekit";
      waitFunction: string;
    };
    transcriptionEndpointingPlan: {
      onPunctuationSeconds: number;
      onNoPunctuationSeconds: number;
      onNumberSeconds: number;
    };
  };
  stopSpeakingPlan: {
    numWords: 0;
    voiceSeconds: number;
    backoffSeconds: number;
  };
  /** Fail-closed: no provider-side phrase may end a call. */
  endCallPhrases: [];
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
  artifactPlan: {
    recordingEnabled: false;
    videoRecordingEnabled: false;
    pcapEnabled: false;
    // The owner declined Vapi's paid ZDR add-on. Disable every configurable
    // retained call-content surface instead. This is deliberately not
    // represented as equivalent to organization-level ZDR.
    loggingEnabled: false;
    fullMessageHistoryEnabled: false;
    transcriptPlan: { enabled: false };
  };
  analysisPlan: {
    summaryPlan: { enabled: false };
    structuredDataPlan: { enabled: false };
    successEvaluationPlan: { enabled: false };
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

export const VOICE_TRANSCRIBER_KEYTERMS = [
  "BluLadder",
  "McKinney",
  "Frisco",
  "Prosper",
  "Allen",
  "Celina",
  "Aubrey",
  "Little Elm",
  "Melissa",
  "Anna",
  "Plano",
  "Binbranch",
  "Parkland",
  "window cleaning",
  "gutter cleaning",
  "house washing",
  "pressure washing",
  "solar screens",
] as const;

export function buildVoiceBetaAssistantManifest(
  input: BuildManifestInput,
): VoiceBetaManifest {
  const { adapterUrl, serverEventsUrl } = input;
  if (!isHttpsUrl(adapterUrl)) {
    throw new Error("adapterUrl must be an https URL");
  }
  if (!isHttpsUrl(serverEventsUrl)) {
    throw new Error("serverEventsUrl must be an https URL");
  }
  return {
    name: VOICE_BETA_ASSISTANT_NAME,
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
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      smartFormat: true,
      keyterm: [...VOICE_TRANSCRIBER_KEYTERMS],
      fallbackPlan: {
        autoFallback: { enabled: false },
        transcribers: [{
          provider: "assembly-ai",
          speechModel: "universal-streaming-english",
          language: "en",
          keytermsPrompt: [...VOICE_TRANSCRIBER_KEYTERMS],
          vadAssistedEndpointingEnabled: true,
        }],
      },
    },
    // English calls use Vapi's recommended LiveKit smart endpointing with an
    // explicit short playback delay. The transcription thresholds remain as
    // a conservative fallback; the application still confirms names, email,
    // address, and all price-changing assumptions.
    startSpeakingPlan: {
      waitSeconds: 0.4,
      smartEndpointingPlan: {
        provider: "livekit",
        waitFunction: "2000 / (1 + exp(-10 * (x - 0.5)))",
      },
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: 0.3,
        onNoPunctuationSeconds: 1.2,
        onNumberSeconds: 1.0,
      },
    },
    stopSpeakingPlan: {
      numWords: 0,
      voiceSeconds: 0.2,
      backoffSeconds: 1.0,
    },
    endCallPhrases: [],
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
    artifactPlan: {
      recordingEnabled: false,
      videoRecordingEnabled: false,
      pcapEnabled: false,
      loggingEnabled: false,
      fullMessageHistoryEnabled: false,
      transcriptPlan: { enabled: false },
    },
    analysisPlan: {
      summaryPlan: { enabled: false },
      structuredDataPlan: { enabled: false },
      successEvaluationPlan: { enabled: false },
    },
    serverEvents: {
      url: serverEventsUrl,
      authenticationMode: "shared-header-credential",
      events: [
        "assistant.started",
        "status-update",
        "hang",
        "end-of-call-report",
      ],
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
