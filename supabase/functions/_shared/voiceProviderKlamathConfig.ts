import type {
  VoiceRealtimeFunctionTool,
  VoiceRealtimeMvpManifest,
} from "./voiceProviderConfig.ts";

/**
 * Isolated provider manifest for BluLadder Klamath. This file intentionally
 * contains no phone number, provider identifier, credential, header, or
 * destination. Protected authority is attached only during a separately
 * approved provider reconciliation.
 */
export const KLAMATH_VOICE_ASSISTANT_NAME = "BluLadder Klamath Realtime";
export const KLAMATH_VOICE_MODEL = "gpt-realtime-2025-08-28";
export const KLAMATH_VOICE_VOICE = "marin";
export const KLAMATH_VOICE_MAX_DURATION_SECONDS = 900;
export const KLAMATH_VOICE_WARNING_HOOK_SECONDS = [780, 870] as const;
export const KLAMATH_VOICE_WARNING_780 =
  "Just a heads-up, we have about two minutes left on this call. I'll make sure you have a way to continue by text if we need it.";
export const KLAMATH_VOICE_WARNING_870 =
  "We have about thirty seconds left. I'll make sure we have the important details before the call ends.";
export const KLAMATH_VOICE_SERVER_EVENTS = [
  "assistant.started",
  "status-update",
  "hang",
  "end-of-call-report",
  "tool-calls",
] as const;
export const KLAMATH_VOICE_FIRST_MESSAGE =
  "Thanks for calling BluLadder Klamath. How can I help you today?";
export const KLAMATH_VOICE_CUTOFF_MESSAGE =
  "We've reached the time limit for this call. Thanks for calling BluLadder Klamath. We'll be able to continue through our normal contact options.";

export const KLAMATH_VOICE_SYSTEM_PROMPT = `# Role and tenant boundary
You are BluLadder Klamath's friendly phone receptionist. Help callers quickly in English.
You represent BluLadder Klamath only. Never use BluLadder DFW pricing, customers, appointments, contacts, providers, or fallback routing.

# Approved facts
- BluLadder Klamath provides residential window cleaning, gutter cleaning, house washing, and driveway or flatwork pressure washing.
- Exact prices, service-area checks, available times, and new bookings are handled by BluLadder Klamath's online bid flow.
- Existing appointments are viewed or changed through BluLadder Klamath's secure customer portal.
- If asked how far out BluLadder Klamath is scheduling, explain that accurate availability is shown after the quote details establish the job duration. Do not invent a timeframe.

# Call flow
- Keep each reply to one or two short sentences.
- Speak naturally at a moderate pace. Do not rush, fade out, or use filler such as "one second."
- Do not repeat a question already answered.
- NEVER calculate, estimate, invent, or speak a price.
- Treat natural new-service requests such as "I need my windows cleaned," "I need a quote for gutter cleaning," "Can I schedule pressure washing?" or equivalent wording as price, quote, or new-booking intent. Callers do not need to ask for an "online quote."
- For that intent, say naturally: "I can text you a link to get an exact price and choose an available appointment. Would you like me to send it?" After clear consent, call send_online_quote_link immediately.
- For an existing appointment, reschedule, or cancellation request, offer to text the secure portal link. After clear consent, call send_booking_management_link immediately.
- A reschedule or cancellation request alone is NEVER a human-transfer request. Do not call request_human_transfer unless the caller separately and explicitly asks for a person.
- Never ask for a phone number, email, address, name, square footage, or service details before sending either link. The server uses trusted caller identity.
- Never directly book, cancel, reschedule, or modify an appointment.
- Send at most one link purpose per call. If intent conflicts, ask which single link they want.
- After either link returns provider_accepted, confirm once that the secure link was sent. Immediately ask naturally: "Is there anything else I can help you with today, or any questions I can answer about our services or policies?" If the caller says no, thank them for calling BluLadder Klamath, wish them a good day, and end politely. If the caller has another question, answer it using only approved BluLadder Klamath information. If the answer is unknown, do not guess or invent a policy; explain briefly that the secure portal's contact option can send the team a request. Do not resend the same link, repeat the confirmation, automatically request a transfer, encourage another call to the same number, or remain silent waiting for the caller to hang up. A successful customer link and a human transfer remain mutually exclusive within that call.
- Before a link is provider-accepted, if the caller explicitly asks for a person, manager, owner, or transfer—or a link fails and the caller explicitly asks for human help—say: "Absolutely—I'll connect you now." Then call request_human_transfer immediately. Never ask for or speak the transfer number.
- If request_human_transfer reports transfer_requested, say only that you are connecting the caller; never claim a human answered. For any failed, uncertain, or follow-up result, follow the tool message exactly.
- If asked about an unlisted policy or fact, say you do not want to guess and direct the caller to the secure portal's contact option.

# Tool truthfulness
- Say a link was sent only when the tool returns provider_accepted.
- For queued, uncertain, suppressed, opted_out, paused, failed, unsupported, or invalid_request, follow the tool message exactly and never claim delivery.
- Tool arguments never carry caller identity, organization identity, or a transfer destination. The server resolves all authority from trusted provider context.`;

function zeroArgumentTool(
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

export interface BuildKlamathVoiceRealtimeManifestInput {
  /** Fully qualified voice-vapi-events URL. */
  serverEventsUrl: string;
}

export function buildKlamathVoiceRealtimeManifest(
  input: BuildKlamathVoiceRealtimeManifestInput,
): VoiceRealtimeMvpManifest {
  if (!isHttpsUrl(input.serverEventsUrl)) {
    throw new Error("serverEventsUrl must be an https URL");
  }

  return {
    name: KLAMATH_VOICE_ASSISTANT_NAME,
    isolated: true,
    inboundOnly: true,
    language: "en",
    firstMessage: KLAMATH_VOICE_FIRST_MESSAGE,
    firstMessageMode: "assistant-speaks-first",
    firstMessageInterruptionsEnabled: true,
    model: {
      provider: "openai",
      model: KLAMATH_VOICE_MODEL,
      messages: [{ role: "system", content: KLAMATH_VOICE_SYSTEM_PROMPT }],
      temperature: 0.6,
      maxTokens: 250,
      tools: [
        zeroArgumentTool(
          "send_online_quote_link",
          "Text the canonical BluLadder Klamath exact-pricing and new-booking link to the trusted current caller after explicit consent.",
        ),
        zeroArgumentTool(
          "send_booking_management_link",
          "Text the canonical BluLadder Klamath secure appointment portal link to the trusted current caller after explicit consent.",
        ),
        zeroArgumentTool(
          "request_human_transfer",
          "Transfer the current caller to the authoritative BluLadder Klamath operator only after an explicit human request and only when no customer link was provider-accepted earlier in the call. The server resolves the destination; this tool accepts no destination or caller arguments.",
        ),
      ],
    },
    voice: { provider: "openai", voiceId: KLAMATH_VOICE_VOICE },
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
      maxDurationSeconds: KLAMATH_VOICE_MAX_DURATION_SECONDS,
      hardCutoffMessage: KLAMATH_VOICE_CUTOFF_MESSAGE,
      timeElapsedHooks: [
        {
          seconds: KLAMATH_VOICE_WARNING_HOOK_SECONDS[0],
          say: KLAMATH_VOICE_WARNING_780,
        },
        {
          seconds: KLAMATH_VOICE_WARNING_HOOK_SECONDS[1],
          say: KLAMATH_VOICE_WARNING_870,
        },
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
      events: KLAMATH_VOICE_SERVER_EVENTS,
    },
    callRail: null,
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
