import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceBetaAssistantManifest,
  buildVoiceRealtimeMvpManifest,
  VOICE_BETA_ASSISTANT_NAME,
  VOICE_BETA_CUTOFF_MESSAGE,
  VOICE_BETA_MAX_DURATION_SECONDS,
  VOICE_BETA_TIME_ELAPSED_HOOKS_SECONDS,
  VOICE_BETA_VAPI_ALLOWED_EVENTS,
  VOICE_BETA_WARNING_780,
  VOICE_BETA_WARNING_870,
  VOICE_REALTIME_MVP_MODEL,
  VOICE_REALTIME_MVP_SYSTEM_PROMPT,
  VOICE_REALTIME_VAPI_ALLOWED_EVENTS,
  VOICE_TRANSCRIBER_KEYTERMS,
  VOICE_VAPI_ALLOWED_EVENTS,
} from "./voiceProviderConfig.ts";

const adapterUrl = "https://example.supabase.co/functions/v1/voice-llm-adapter";
const serverEventsUrl =
  "https://example.supabase.co/functions/v1/voice-vapi-events";

Deno.test("manifest: assistant name is exact and accepted by Vapi", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.name, VOICE_BETA_ASSISTANT_NAME);
  assertEquals(m.name, "BluLadder Voice Beta (isolated)");
  assert(m.name.length <= 40);
});

Deno.test("manifest: exact duration and hook copy", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.duration.maxDurationSeconds, 900);
  assertEquals(VOICE_BETA_MAX_DURATION_SECONDS, 900);
  assertEquals(VOICE_BETA_TIME_ELAPSED_HOOKS_SECONDS as unknown as number[], [
    780,
    870,
  ]);
  assertEquals(m.duration.timeElapsedHooks[0].seconds, 780);
  assertEquals(m.duration.timeElapsedHooks[1].seconds, 870);
  assertEquals(m.duration.timeElapsedHooks[0].say, VOICE_BETA_WARNING_780);
  assertEquals(m.duration.timeElapsedHooks[1].say, VOICE_BETA_WARNING_870);
  assertEquals(m.duration.hardCutoffMessage, VOICE_BETA_CUTOFF_MESSAGE);
  assert(
    !/text will be sent|we'll text you|sending you a text/i.test(
      VOICE_BETA_WARNING_780,
    ),
  );
  assert(
    !/text will be sent|we'll text you|sending you a text/i.test(
      VOICE_BETA_WARNING_870,
    ),
  );
  assert(
    !/text will be sent|we'll text you|sending you a text/i.test(
      VOICE_BETA_CUTOFF_MESSAGE,
    ),
  );
});

Deno.test("manifest: every configurable retained call-content surface is off", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  const s = m.artifactPlan;
  assertEquals(s.recordingEnabled, false);
  assertEquals(s.videoRecordingEnabled, false);
  assertEquals(s.pcapEnabled, false);
  assertEquals(s.loggingEnabled, false);
  assertEquals(s.fullMessageHistoryEnabled, false);
  assertEquals(s.transcriptPlan.enabled, false);
  assertEquals(m.analysisPlan.summaryPlan.enabled, false);
  assertEquals(m.analysisPlan.structuredDataPlan.enabled, false);
  assertEquals(m.analysisPlan.successEvaluationPlan.enabled, false);
});

Deno.test("manifest: explicit English Nova-3 primary and AssemblyAI fallback", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.transcriber.provider, "deepgram");
  assertEquals(m.transcriber.model, "nova-3");
  assertEquals(m.transcriber.language, "en");
  assertEquals(m.transcriber.smartFormat, true);
  assertEquals(m.transcriber.keyterm, [...VOICE_TRANSCRIBER_KEYTERMS]);
  assertEquals(m.transcriber.fallbackPlan.autoFallback.enabled, false);
  assertEquals(m.transcriber.fallbackPlan.transcribers, [{
    provider: "assembly-ai",
    speechModel: "universal-streaming-english",
    language: "en",
    keytermsPrompt: [...VOICE_TRANSCRIBER_KEYTERMS],
    vadAssistedEndpointingEnabled: true,
  }]);
  assertEquals(
    Object.keys(m.transcriber.fallbackPlan.transcribers[0]).sort(),
    [
      "keytermsPrompt",
      "language",
      "provider",
      "speechModel",
      "vadAssistedEndpointingEnabled",
    ],
  );
  assertEquals(m.startSpeakingPlan.smartEndpointingPlan.provider, "livekit");
  assertEquals(
    m.startSpeakingPlan.smartEndpointingPlan.waitFunction,
    "2000 / (1 + exp(-10 * (x - 0.5)))",
  );
  assert(m.startSpeakingPlan.transcriptionEndpointingPlan.onNumberSeconds >= 1);
  assertEquals(m.stopSpeakingPlan, {
    numWords: 2,
    voiceSeconds: 0.4,
    backoffSeconds: 1,
  });
});

Deno.test("manifest: no tools, no phone number, no transfer, no CallRail", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.tools.length, 0);
  assertEquals(m.phoneNumber, null);
  assertEquals(m.transferDestination, null);
  assertEquals(m.callRail, null);
});

Deno.test("manifest: custom-llm model config points at adapter and streams", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.model.provider, "custom-llm");
  assertEquals(m.model.url, adapterUrl);
  assertEquals(m.model.stream, true);
  assertEquals(m.model.timeoutSeconds, 20);
});

Deno.test("manifest: allow-listed server events only", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.serverEvents.url, serverEventsUrl);
  assertEquals(
    [...m.serverEvents.events].sort(),
    [...VOICE_BETA_VAPI_ALLOWED_EVENTS].sort(),
  );
});

Deno.test("manifest: no secret literals in the built object", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  const s = JSON.stringify(m);
  assert(!/bearer\s+[A-Za-z0-9._-]{8,}/i.test(s));
  assert(!/sk-[A-Za-z0-9]{16,}/i.test(s));
  assert(!s.includes("+14692150144"));
  assert(!s.includes("+14692426556"));
  assert(!s.includes("+14697472877"));
});

Deno.test("manifest: rejects non-https urls", () => {
  assertThrows(() =>
    buildVoiceBetaAssistantManifest({
      adapterUrl: "http://insecure/adapter",
      serverEventsUrl,
    })
  );
  assertThrows(() =>
    buildVoiceBetaAssistantManifest({
      adapterUrl,
      serverEventsUrl: "not a url",
    })
  );
});

Deno.test("realtime manifest: native audio replaces the custom adapter and transcriber", () => {
  const m = buildVoiceRealtimeMvpManifest({ serverEventsUrl });
  assertEquals(m.model.provider, "openai");
  assertEquals(m.model.model, VOICE_REALTIME_MVP_MODEL);
  assertEquals(m.voice, { provider: "openai", voiceId: "marin" });
  assertEquals(m.transcriber, null);
  assertEquals("url" in m.model, false);
  assertEquals(m.backgroundSound, "off");
  assertEquals(m.model.maxTokens, 250);
});

Deno.test("realtime manifest: exact tools accept no model authority arguments", () => {
  const m = buildVoiceRealtimeMvpManifest({ serverEventsUrl });
  assertEquals(
    m.model.tools.map((tool) => tool.function.name),
    [
      "send_online_quote_link",
      "send_booking_management_link",
      "request_human_transfer",
    ],
  );
  for (const tool of m.model.tools) {
    assertEquals(tool.function.parameters, {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  }
  assertEquals(m.serverEvents.events, VOICE_REALTIME_VAPI_ALLOWED_EVENTS);
  assertEquals(VOICE_VAPI_ALLOWED_EVENTS, VOICE_REALTIME_VAPI_ALLOWED_EVENTS);
});

Deno.test("realtime manifest: prompt sends callers to proven web flows without phone pricing or mutations", () => {
  const prompt = VOICE_REALTIME_MVP_SYSTEM_PROMPT;
  assert(/NEVER calculate, estimate, invent, or speak a price/.test(prompt));
  assert(/Never directly book, cancel, reschedule, or modify/.test(prompt));
  assert(
    /Never ask for a phone number, email, address, name, square footage/.test(
      prompt,
    ),
  );
  assert(/send_online_quote_link/.test(prompt));
  assert(/I need my windows cleaned/.test(prompt));
  assert(/Callers do not need to ask for an “online quote.”/.test(prompt));
  assert(/get an exact price and choose an available appointment/.test(prompt));
  assert(/send_booking_management_link/.test(prompt));
  assert(/provider_accepted/.test(prompt));
  assert(/moderate pace/.test(prompt));
  assert(/Do not repeat a question already answered/.test(prompt));
  assert(/usually scheduling about one to two weeks out/.test(prompt));
  assert(/sooner openings sometimes become available/.test(prompt));
  assert(/know how long the appointment will take/.test(prompt));
  assert(/exact available times/.test(prompt));
  assert(/request_human_transfer immediately/.test(prompt));
  assert(/Never ask for or speak the transfer number/.test(prompt));
  assert(/never claim a human answered/.test(prompt));
});

Deno.test("realtime manifest: QA transcript is explicit while audio and logs remain off", () => {
  const m = buildVoiceRealtimeMvpManifest({ serverEventsUrl });
  assertEquals(m.artifactPlan.transcriptPlan.enabled, true);
  assertEquals(m.artifactPlan.recordingEnabled, false);
  assertEquals(m.artifactPlan.videoRecordingEnabled, false);
  assertEquals(m.artifactPlan.loggingEnabled, false);
  assertEquals(m.artifactPlan.fullMessageHistoryEnabled, false);
});

Deno.test("realtime manifest: old custom-LLM rollback output remains exact", () => {
  const old = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(old.model.provider, "custom-llm");
  assertEquals(old.model.url, adapterUrl);
  assertEquals(old.tools, []);
  assertEquals(old.transcriber.provider, "deepgram");
  assertEquals(old.artifactPlan.transcriptPlan.enabled, false);
  assertEquals(old.serverEvents.events, VOICE_BETA_VAPI_ALLOWED_EVENTS);
});

Deno.test("realtime manifest: rejects non-https server URL", () => {
  assertThrows(() =>
    buildVoiceRealtimeMvpManifest({
      serverEventsUrl: "http://insecure.example.com/events",
    })
  );
});
