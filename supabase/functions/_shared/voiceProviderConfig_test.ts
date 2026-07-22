import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceBetaAssistantManifest,
  VOICE_BETA_CUTOFF_MESSAGE,
  VOICE_BETA_MAX_DURATION_SECONDS,
  VOICE_BETA_TIME_ELAPSED_HOOKS_SECONDS,
  VOICE_BETA_WARNING_780,
  VOICE_BETA_WARNING_870,
  VOICE_VAPI_ALLOWED_EVENTS,
} from "./voiceProviderConfig.ts";

const adapterUrl = "https://example.supabase.co/functions/v1/voice-llm-adapter";
const serverEventsUrl = "https://example.supabase.co/functions/v1/voice-vapi-events";

Deno.test("manifest: exact duration and hook copy", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.duration.maxDurationSeconds, 900);
  assertEquals(VOICE_BETA_MAX_DURATION_SECONDS, 900);
  assertEquals(VOICE_BETA_TIME_ELAPSED_HOOKS_SECONDS as unknown as number[], [780, 870]);
  assertEquals(m.duration.timeElapsedHooks[0].seconds, 780);
  assertEquals(m.duration.timeElapsedHooks[1].seconds, 870);
  assertEquals(m.duration.timeElapsedHooks[0].say, VOICE_BETA_WARNING_780);
  assertEquals(m.duration.timeElapsedHooks[1].say, VOICE_BETA_WARNING_870);
  assertEquals(m.duration.hardCutoffMessage, VOICE_BETA_CUTOFF_MESSAGE);
  assert(!/text will be sent|we'll text you|sending you a text/i.test(VOICE_BETA_WARNING_780));
  assert(!/text will be sent|we'll text you|sending you a text/i.test(VOICE_BETA_WARNING_870));
  assert(!/text will be sent|we'll text you|sending you a text/i.test(VOICE_BETA_CUTOFF_MESSAGE));
});

Deno.test("manifest: artifact suppression fully disabled", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  const s = m.artifactSuppression;
  assertEquals(s.recordingEnabled, false);
  assertEquals(s.videoRecordingEnabled, false);
  assertEquals(s.pcapEnabled, false);
  assertEquals(s.loggingEnabled, false);
  assertEquals(s.fullMessageHistoryEnabled, false);
  assertEquals(s.transcriptArtifactEnabled, false);
  assertEquals(s.summaryGenerationEnabled, false);
  assertEquals(s.structuredOutputEnabled, false);
  assertEquals(s.analysisEnabled, false);
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
});

Deno.test("manifest: allow-listed server events only", () => {
  const m = buildVoiceBetaAssistantManifest({ adapterUrl, serverEventsUrl });
  assertEquals(m.serverEvents.url, serverEventsUrl);
  assertEquals(
    [...m.serverEvents.events].sort(),
    [...VOICE_VAPI_ALLOWED_EVENTS].sort(),
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
  assertThrows(() => buildVoiceBetaAssistantManifest({
    adapterUrl: "http://insecure/adapter",
    serverEventsUrl,
  }));
  assertThrows(() => buildVoiceBetaAssistantManifest({
    adapterUrl,
    serverEventsUrl: "not a url",
  }));
});