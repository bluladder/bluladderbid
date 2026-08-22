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
    timeoutSeconds: 20;
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
    numWords: 2;
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

// ---------------------------------------------------------------------------
// Thin OpenAI Realtime MVP. This is a separate, versioned target; the legacy
// Phase 4C-beta custom-LLM manifest above remains unchanged as rollback.
// ---------------------------------------------------------------------------

export const VOICE_REALTIME_MVP_ASSISTANT_NAME = "BluLadder Realtime Link MVP";
export const VOICE_REALTIME_MVP_MODEL = "gpt-realtime-2025-08-28";
export const VOICE_REALTIME_MVP_VOICE = "marin";

export const VOICE_REALTIME_MVP_SYSTEM_PROMPT = `# Role & objective
You are BluLadder's friendly phone receptionist. Help callers quickly in English.

# Approved facts
- BluLadder provides window cleaning, gutter cleaning, roof soft washing, house washing, driveway and flatwork pressure washing, solar-panel cleaning, and screen repair.
- Exact prices, service-area checks, available times, and new bookings are handled by BluLadder's online bid flow.
- Existing appointments are viewed or changed through BluLadder's secure customer portal.
- If asked how far out BluLadder is scheduling, say: "We're usually scheduling about one to two weeks out, though sooner openings sometimes become available. Once we have your service details and know how long the appointment will take, we can show you the exact available times."

# Call flow
- Keep each reply to one or two short sentences.
- Speak naturally at a moderate pace. Do not rush, fade out, or use filler such as "one second."
- Do not repeat a question already answered.
- NEVER calculate, estimate, invent, or speak a price.
- Treat natural new-service requests such as “I need my windows cleaned,” “I need a quote for gutter cleaning,” “Can I schedule pressure washing?” or equivalent wording as price, quote, or new-booking intent. Callers do not need to ask for an “online quote.”
- For that intent, say naturally: “I can text you a link to get an exact price and choose an available appointment. Would you like me to send it?” After clear consent, call send_online_quote_link immediately.
- For an existing appointment, reschedule, or cancellation request, offer to text the secure portal link. After clear consent, call send_booking_management_link immediately.
- A reschedule or cancellation request alone is NEVER a human-transfer request. Do not call request_human_transfer unless the caller separately and explicitly asks for a person.
- Never ask for a phone number, email, address, name, square footage, or service details before sending either link. The server uses trusted caller ID.
- Never directly book, cancel, reschedule, or modify an appointment.
- Send at most one link purpose per call. If intent conflicts, ask which single link they want.
- After either link returns provider_accepted, acknowledge it once and do not call request_human_transfer later in that call. A successful customer link and a human transfer are mutually exclusive within one call.
- Before a link is provider-accepted, if the caller explicitly asks for a person, manager, owner, or transfer—or a link fails and the caller explicitly asks for human help—say: "Absolutely—I'll connect you now." Then call request_human_transfer immediately. Never ask for or speak the transfer number.
- If request_human_transfer reports transfer_requested, say only that you are connecting the caller; never claim a human answered. For any failed, uncertain, or follow-up result, follow the tool message exactly.
- If asked about an unlisted policy or fact, say you do not want to guess and direct the caller to the website.

# Tool truthfulness
- Say a link was sent only when the tool returns provider_accepted.
- For queued, uncertain, suppressed, opted_out, paused, failed, unsupported, or invalid_request, follow the tool message exactly and never claim delivery.`;

export interface VoiceRealtimeFunctionTool {
  type: "function";
  function: {
    name:
      | "send_online_quote_link"
      | "send_booking_management_link"
      | "request_human_transfer";
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, never>;
      required: [];
      additionalProperties: false;
    };
  };
}

export interface VoiceRealtimeMvpManifest {
  name: string;
  isolated: true;
  inboundOnly: true;
  language: "en";
  firstMessage: string;
  firstMessageMode: "assistant-speaks-first";
  firstMessageInterruptionsEnabled: true;
  model: {
    provider: "openai";
    model: "gpt-realtime-2025-08-28";
    messages: [{ role: "system"; content: string }];
    temperature: 0.6;
    maxTokens: 250;
    tools: [
      VoiceRealtimeFunctionTool,
      VoiceRealtimeFunctionTool,
      VoiceRealtimeFunctionTool,
    ];
  };
  voice: {
    provider: "openai";
    voiceId: "marin";
  };
  /** Native audio-in/audio-out: a separate STT configuration must be absent. */
  transcriber: null;
  startSpeakingPlan: {
    waitSeconds: 0.3;
    smartEndpointingPlan: { provider: "livekit" };
  };
  stopSpeakingPlan: {
    numWords: 2;
    voiceSeconds: 0.4;
    backoffSeconds: 1;
  };
  backgroundSound: "off";
  modelOutputInMessagesEnabled: false;
  endCallPhrases: [];
  phoneNumber: null;
  transferDestination: null;
  duration: VoiceBetaManifest["duration"];
  artifactPlan: {
    recordingEnabled: false;
    videoRecordingEnabled: false;
    pcapEnabled: false;
    loggingEnabled: false;
    fullMessageHistoryEnabled: false;
    /** Owner-requested QA transcript; audio recording remains disabled. */
    transcriptPlan: { enabled: true };
  };
  analysisPlan: VoiceBetaManifest["analysisPlan"];
  serverEvents: {
    url: string;
    authenticationMode: "shared-header-credential";
    events: typeof VOICE_REALTIME_VAPI_ALLOWED_EVENTS;
  };
  callRail: null;
}

export interface BuildVoiceRealtimeMvpManifestInput {
  /** Fully-qualified voice-vapi-events URL. */
  serverEventsUrl: string;
}

function realtimeLinkTool(
  name: VoiceRealtimeFunctionTool["function"]["name"],
  description: string,
): VoiceRealtimeFunctionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  };
}

export function buildVoiceRealtimeMvpManifest(
  input: BuildVoiceRealtimeMvpManifestInput,
): VoiceRealtimeMvpManifest {
  if (!isHttpsUrl(input.serverEventsUrl)) {
    throw new Error("serverEventsUrl must be an https URL");
  }
  return {
    name: VOICE_REALTIME_MVP_ASSISTANT_NAME,
    isolated: true,
    inboundOnly: true,
    language: "en",
    firstMessage: "Thanks for calling BluLadder. How can I help you today?",
    firstMessageMode: "assistant-speaks-first",
    firstMessageInterruptionsEnabled: true,
    model: {
      provider: "openai",
      model: VOICE_REALTIME_MVP_MODEL,
      messages: [{
        role: "system",
        content: VOICE_REALTIME_MVP_SYSTEM_PROMPT,
      }],
      temperature: 0.6,
      maxTokens: 250,
      tools: [
        realtimeLinkTool(
          "send_online_quote_link",
          "Text the canonical BluLadder online quote and new-booking link to the trusted current caller ID after explicit caller consent.",
        ),
        realtimeLinkTool(
          "send_booking_management_link",
          "Text the canonical secure appointment portal link to the trusted current caller ID after explicit caller consent.",
        ),
        realtimeLinkTool(
          "request_human_transfer",
          "Transfer the current caller to the authoritative local operator only after an explicit human request and only when no customer link was provider-accepted earlier in the call. The server resolves the destination; this tool accepts no destination or caller arguments.",
        ),
      ],
    },
    voice: { provider: "openai", voiceId: VOICE_REALTIME_MVP_VOICE },
    transcriber: null,
    startSpeakingPlan: {
      waitSeconds: 0.3,
      smartEndpointingPlan: { provider: "livekit" },
    },
    stopSpeakingPlan: {
      numWords: 2,
      voiceSeconds: 0.4,
      backoffSeconds: 1,
    },
    backgroundSound: "off",
    modelOutputInMessagesEnabled: false,
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
      transcriptPlan: { enabled: true },
    },
    analysisPlan: {
      summaryPlan: { enabled: false },
      structuredDataPlan: { enabled: false },
      successEvaluationPlan: { enabled: false },
    },
    serverEvents: {
      url: input.serverEventsUrl,
      authenticationMode: "shared-header-credential",
      events: VOICE_REALTIME_VAPI_ALLOWED_EVENTS,
    },
    callRail: null,
  };
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
      timeoutSeconds: 20,
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
      numWords: 2,
      voiceSeconds: 0.4,
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

/** Exact legacy server-event target retained for Phase 4C-beta rollback. */
export const VOICE_BETA_VAPI_ALLOWED_EVENTS = [
  "assistant.started",
  "status-update",
  "hang",
  "end-of-call-report",
] as const;

/** Exact Realtime MVP server-event target, including synchronous tool calls. */
export const VOICE_REALTIME_VAPI_ALLOWED_EVENTS = [
  ...VOICE_BETA_VAPI_ALLOWED_EVENTS,
  "tool-calls",
] as const;

/** Runtime receiver allowlist: exact union of reviewed provider targets. */
export const VOICE_VAPI_ALLOWED_EVENTS = VOICE_REALTIME_VAPI_ALLOWED_EVENTS;
export type VoiceVapiAllowedEvent = typeof VOICE_VAPI_ALLOWED_EVENTS[number];
