import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizedBrowserCallFixture } from "./__fixtures__/voice/browserCallStructural.ts";

Deno.test("browser-call fixture has whitelisted top-level keys only", () => {
  const allowed = new Set([
    "id", "assistantId", "type",
    "startedAt", "endedAt", "createdAt", "updatedAt",
    "endedReason", "artifact", "monitor",
    "phoneNumberIdPresent", "customerPresent", "customerNumberPresent",
  ]);
  for (const k of Object.keys(sanitizedBrowserCallFixture)) {
    assert(allowed.has(k), `unexpected key: ${k}`);
  }
});

Deno.test("browser-call fixture: PSTN fields are explicitly absent", () => {
  assertEquals(sanitizedBrowserCallFixture.phoneNumberIdPresent, false);
  assertEquals(sanitizedBrowserCallFixture.customerPresent, false);
  assertEquals(sanitizedBrowserCallFixture.customerNumberPresent, false);
});

Deno.test("browser-call fixture: performanceMetrics is nested under artifact", () => {
  assert(sanitizedBrowserCallFixture.artifact.performanceMetrics);
  const pm = sanitizedBrowserCallFixture.artifact.performanceMetrics;
  for (const key of [
    "turnLatencyAverage", "endpointingLatencyAverage", "transcriberLatencyAverage",
    "modelLatencyAverage", "voiceLatencyAverage",
    "fromTransportLatencyAverage", "toTransportLatencyAverage",
  ]) {
    assert(key in pm, `missing perf key ${key}`);
  }
});

Deno.test("browser-call fixture: monitor uses presence flags, not URLs", () => {
  const m = sanitizedBrowserCallFixture.monitor as Record<string, unknown>;
  assert("listenUrlPresent" in m && "controlUrlPresent" in m);
  for (const v of Object.values(m)) assertEquals(typeof v, "boolean");
});

Deno.test("browser-call fixture: no transcript/messages/recording/log paths", () => {
  const s = JSON.stringify(sanitizedBrowserCallFixture);
  for (const forbidden of ["transcript", "messages", "recording", "logUrl", "logs", "recordingUrl"]) {
    assert(!s.includes(forbidden), `fixture must not include ${forbidden}`);
  }
});
