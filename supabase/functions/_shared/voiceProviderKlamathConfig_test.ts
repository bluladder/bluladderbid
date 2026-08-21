import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildKlamathVoiceRealtimeManifest,
  KLAMATH_VOICE_ASSISTANT_NAME,
  KLAMATH_VOICE_CUTOFF_MESSAGE,
  KLAMATH_VOICE_FIRST_MESSAGE,
  KLAMATH_VOICE_SYSTEM_PROMPT,
} from "./voiceProviderKlamathConfig.ts";

const serverEventsUrl =
  "https://example.supabase.co/functions/v1/voice-vapi-events";

Deno.test("Klamath manifest is isolated and branded", () => {
  const manifest = buildKlamathVoiceRealtimeManifest({ serverEventsUrl });
  assertEquals(manifest.name, KLAMATH_VOICE_ASSISTANT_NAME);
  assert(manifest.name.length <= 40);
  assertEquals(manifest.firstMessage, KLAMATH_VOICE_FIRST_MESSAGE);
  assert(manifest.firstMessage.includes("BluLadder Klamath"));
  assert(KLAMATH_VOICE_SYSTEM_PROMPT.includes("BluLadder Klamath only"));
  assert(KLAMATH_VOICE_SYSTEM_PROMPT.includes("Never use BluLadder DFW"));
});

Deno.test("Klamath manifest pins the approved Realtime pipeline literals", () => {
  const manifest = buildKlamathVoiceRealtimeManifest({ serverEventsUrl });
  assertEquals(manifest.model.provider, "openai");
  assertEquals(manifest.model.model, "gpt-realtime-2025-08-28");
  assertEquals(manifest.voice, {
    provider: "openai",
    voiceId: "marin",
  });
  assertEquals(manifest.transcriber, null);
  assertEquals(manifest.backgroundSound, "off");
  assertEquals(manifest.modelOutputInMessagesEnabled, false);
});

Deno.test("Klamath manifest exposes exactly three zero-authority tools", () => {
  const manifest = buildKlamathVoiceRealtimeManifest({ serverEventsUrl });
  assertEquals(manifest.model.tools.map((tool) => tool.function.name), [
    "send_online_quote_link",
    "send_booking_management_link",
    "request_human_transfer",
  ]);
  for (const tool of manifest.model.tools) {
    assertEquals(tool.function.parameters, {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  }
});

Deno.test("Klamath manifest keeps provider-side routing and fallbacks absent", () => {
  const manifest = buildKlamathVoiceRealtimeManifest({ serverEventsUrl });
  assertEquals(manifest.phoneNumber, null);
  assertEquals(manifest.transferDestination, null);
  assertEquals(manifest.endCallPhrases, []);
  assertEquals(manifest.callRail, null);
  assertEquals(manifest.serverEvents.url, serverEventsUrl);
  assertEquals(manifest.serverEvents.events, [
    "assistant.started",
    "status-update",
    "hang",
    "end-of-call-report",
    "tool-calls",
  ]);
});

Deno.test("Klamath manifest pins duration, privacy, and analysis gates", () => {
  const manifest = buildKlamathVoiceRealtimeManifest({ serverEventsUrl });
  assertEquals(manifest.duration.maxDurationSeconds, 900);
  assertEquals(manifest.duration.timeElapsedHooks, [
    {
      seconds: 780,
      say:
        "Just a heads-up, we have about two minutes left on this call. I'll make sure you have a way to continue by text if we need it.",
    },
    {
      seconds: 870,
      say:
        "We have about thirty seconds left. I'll make sure we have the important details before the call ends.",
    },
  ]);
  assertEquals(
    manifest.duration.hardCutoffMessage,
    KLAMATH_VOICE_CUTOFF_MESSAGE,
  );
  assertEquals(manifest.artifactPlan, {
    recordingEnabled: false,
    videoRecordingEnabled: false,
    pcapEnabled: false,
    loggingEnabled: false,
    fullMessageHistoryEnabled: false,
    transcriptPlan: { enabled: true },
  });
  assertEquals(manifest.analysisPlan, {
    summaryPlan: { enabled: false },
    structuredDataPlan: { enabled: false },
    successEvaluationPlan: { enabled: false },
  });
});

Deno.test("Klamath prompt preserves link and transfer truthfulness", () => {
  const prompt = KLAMATH_VOICE_SYSTEM_PROMPT;
  assert(
    prompt.includes("NEVER calculate, estimate, invent, or speak a price"),
  );
  assert(prompt.includes("send_online_quote_link immediately"));
  assert(prompt.includes("send_booking_management_link immediately"));
  assert(prompt.includes("request_human_transfer immediately"));
  assert(prompt.includes("mutually exclusive within that call"));
  assert(prompt.includes("never claim a human answered"));
  assert(prompt.includes("The server resolves all authority"));
});

Deno.test("Klamath manifest contains no protected values", () => {
  const manifest = buildKlamathVoiceRealtimeManifest({ serverEventsUrl });
  const serialized = JSON.stringify(manifest);
  assert(!/\+[1-9][0-9]{7,14}/.test(serialized));
  assert(
    !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(
      serialized,
    ),
  );
  assert(!/bearer\s+[A-Za-z0-9._-]{8,}/i.test(serialized));
  assert(!/sk-[A-Za-z0-9]{16,}/i.test(serialized));
});

Deno.test("Klamath manifest rejects non-HTTPS server URLs", () => {
  assertThrows(() =>
    buildKlamathVoiceRealtimeManifest({
      serverEventsUrl: "http://insecure.example.com/events",
    })
  );
});
