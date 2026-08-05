import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceTurnCorrelationId,
  emitVoiceTurnLatency,
  extractProviderFinalUserTurnAtMs,
  VoiceTurnLatencyRecorder,
} from "./voiceTurnLatency.ts";

Deno.test("phase9 correlation is deterministic, opaque and unique per authoritative turn", async () => {
  const raw = "provider-call-secret:turn-secret";
  const first = await buildVoiceTurnCorrelationId(raw);
  const replay = await buildVoiceTurnCorrelationId(raw);
  const next = await buildVoiceTurnCorrelationId(`${raw}:next`);
  assertEquals(first, replay);
  assertNotEquals(first, next);
  assert(/^[0-9a-f-]{36}$/.test(first));
  assert(!first.includes("provider"));
  assert(!first.includes("secret"));
});

Deno.test("phase9 recorder produces deterministic boundary and delay buckets", () => {
  let now = 1000;
  const recorder = new VoiceTurnLatencyRecorder({
    correlationId: "00000000-0000-5000-8000-000000000009",
    stream: true,
    originMs: 1000,
    receivedWallClockMs: 10_000,
    providerFinalUserTurnAtMs: 9_750,
    now: () => now,
  });
  now = 1005;
  recorder.mark("finalUserTurnReceivedMs");
  now = 1012;
  recorder.add("singleFlightMs", 7);
  recorder.add("databaseMs", 7);
  recorder.mark("singleFlightClaimedMs");
  now = 1020;
  recorder.add("conversationSessionLoadMs", 8);
  recorder.add("databaseMs", 8);
  recorder.mark("conversationSessionLoadedMs");
  recorder.add("pricingMs", 3);
  recorder.add("addressIdentityMs", 2);
  recorder.add("externalToolMs", 4);
  recorder.add("persistenceMs", 5);
  recorder.add("databaseMs", 5);
  now = 1040;
  recorder.mark("controllerCompletedMs");
  recorder.mark("persistenceCompletedMs");
  now = 1045;
  recorder.mark("firstResponseChunkMs");
  now = 1050;
  const event = recorder.finish({ route: "controller", outcome: "responded" });
  assert(event);
  assertEquals(event.milestones, {
    providerEventReceivedMs: 0,
    finalUserTurnReceivedMs: 5,
    singleFlightClaimedMs: 12,
    conversationSessionLoadedMs: 20,
    controllerCompletedMs: 40,
    persistenceCompletedMs: 40,
    firstResponseChunkMs: 45,
    responseCompletedMs: 50,
  });
  assertEquals(event.durations, {
    providerTranscriptionMs: 250,
    singleFlightMs: 7,
    databaseMs: 20,
    conversationSessionLoadMs: 8,
    pricingMs: 3,
    addressIdentityMs: 2,
    externalToolMs: 4,
    persistenceMs: 5,
    applicationToFirstChunkMs: 40,
    applicationTotalMs: 45,
  });
  assertEquals(
    recorder.finish({ route: "controller", outcome: "responded" }),
    null,
  );
});

Deno.test("phase9 provider delay reads only allow-listed timestamps and fails unmeasurable values closed", () => {
  assertEquals(
    extractProviderFinalUserTurnAtMs({
      messages: [
        { role: "assistant", timestamp: "2026-08-05T12:00:00.000Z" },
        { role: "user", timestamp: "2026-08-05T12:00:01.250Z" },
      ],
      transcript: "not inspected",
    }),
    Date.parse("2026-08-05T12:00:01.250Z"),
  );
  assertEquals(
    extractProviderFinalUserTurnAtMs({
      messages: [{ role: "user", timestamp: "not-a-date" }],
      arbitrary: { timestamp: "2026-08-05T12:00:01.250Z" },
    }),
    null,
  );
  const recorder = new VoiceTurnLatencyRecorder({
    correlationId: "00000000-0000-5000-8000-000000000009",
    stream: false,
    originMs: 0,
    receivedWallClockMs: 1_000_000,
    providerFinalUserTurnAtMs: 0,
    now: () => 1,
  });
  recorder.mark("finalUserTurnReceivedMs");
  recorder.mark("firstResponseChunkMs");
  const event = recorder.finish({ route: "unknown", outcome: "failed_closed" });
  assertEquals(event?.durations.providerTranscriptionMs, null);
});

Deno.test("phase9 telemetry event schema cannot carry PII or transcript fields", () => {
  const recorder = new VoiceTurnLatencyRecorder({
    correlationId: "00000000-0000-5000-8000-000000000009",
    stream: true,
    originMs: 0,
    receivedWallClockMs: 0,
    now: () => 5,
  });
  recorder.mark("finalUserTurnReceivedMs", 1);
  recorder.mark("firstResponseChunkMs", 4);
  const event = recorder.finish({ route: "controller", outcome: "responded" });
  const serialized = JSON.stringify(event);
  for (
    const forbidden of [
      "phone",
      "address",
      "transcript",
      "messageContent",
      "providerCallId",
      "customer",
      "credential",
    ]
  ) {
    assert(!serialized.includes(forbidden));
  }
});

Deno.test("phase9 emission stays flag-gated and emits one sanitized event", () => {
  const event = {
    at: "voice-turn-latency" as const,
    version: "voice-turn-latency-v1" as const,
    correlationId: "00000000-0000-5000-8000-000000000009",
    channel: "voice" as const,
    route: "controller" as const,
    outcome: "responded" as const,
    stream: true,
    milestones: { providerEventReceivedMs: 0 },
    durations: { applicationTotalMs: 12 },
  };
  const logs: string[] = [];
  const original = console.log;
  console.log = (value: unknown) => logs.push(String(value));
  try {
    emitVoiceTurnLatency(event, { VOICE_LATENCY_METRICS: "false" });
    emitVoiceTurnLatency(event, { VOICE_LATENCY_METRICS: "true" });
  } finally {
    console.log = original;
  }
  assertEquals(logs.length, 1);
  assertEquals(JSON.parse(logs[0]).correlationId, event.correlationId);
});

Deno.test("phase9 adapter contract marks actual first enqueue and completed stream once", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/voice-llm-adapter/index.ts",
  );
  assertEquals(
    source.match(/buildVoiceTurnCorrelationId\(turn\.turnId\)/g)?.length,
    1,
  );
  assertStringIncludes(source, 'latency.mark("finalUserTurnReceivedMs"');
  assertStringIncludes(source, 'latency.add("singleFlightMs"');
  assertStringIncludes(source, 'latency.add("conversationSessionLoadMs"');
  assertStringIncludes(source, "route.timings.pricingMs");
  assertStringIncludes(source, "route.timings.addressServiceAreaMs");
  assertStringIncludes(source, "route.timings.externalToolMs");
  assertStringIncludes(source, "route.timings.persistenceMs");
  const firstCallback = source.indexOf("lifecycle.onFirstChunk?.()");
  const firstEnqueue = source.indexOf(
    "controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\\n\\n`))",
  );
  const close = source.indexOf("controller.close();", firstEnqueue);
  const completeCallback = source.indexOf("lifecycle.onComplete?.()", close);
  assert(firstCallback >= 0 && firstCallback < firstEnqueue);
  assert(firstEnqueue >= 0 && firstEnqueue < close);
  assert(close >= 0 && close < completeCallback);
});
