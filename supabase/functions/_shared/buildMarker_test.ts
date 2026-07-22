// Deno tests: build marker present in safe diagnostics, never in spoken content.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BUILD_FEATURES, BUILD_ID } from "./buildMarker.ts";
import { buildNonStreamingResponse, type AdapterCompletion } from "./voiceAdapter.ts";

Deno.test("BUILD_ID is a non-empty stable string", () => {
  assert(typeof BUILD_ID === "string" && BUILD_ID.length > 0);
});

Deno.test("BUILD_FEATURES exposes address-free voice rough quote marker", () => {
  assertEquals(BUILD_FEATURES.voiceEarlyQuote, true);
  assertEquals(BUILD_FEATURES.voiceAddressFreeRoughQuote, true);
  assertEquals(BUILD_FEATURES.voiceBookingDryRun, true);
});

Deno.test("BUILD_FEATURES exposes Phase 4C-β.4A window scope + partial + commercial flags", () => {
  assertEquals(BUILD_FEATURES.progressiveQuoteSession, true);
  assertEquals(BUILD_FEATURES.windowScopeClassification, true);
  assertEquals(BUILD_FEATURES.partialWindowPricing, true);
  assertEquals(BUILD_FEATURES.commercialCustomBidIntake, true);
});

Deno.test("BUILD_FEATURES exposes Phase 4C-β.4B stable-session + workflow-controller flags", () => {
  assertEquals(BUILD_FEATURES.stableVoiceSessionId, true);
  // Controller is scaffolded but off by default until parity is proven end-to-end.
  assertEquals(BUILD_FEATURES.useWorkflowController, false);
});

Deno.test("buildNonStreamingResponse: buildId is in bluladder diagnostics", async () => {
  const completion: AdapterCompletion = {
    content: "Your rough exterior window quote is ready.",
    action: { kind: "tool_result_speak" },
    orchestrator: { reply: "", toolEvents: [], events: [], state: "quote_ready", voice: null },
  };
  const res = buildNonStreamingResponse("m", completion);
  const body = await res.json();
  assertEquals(body.bluladder.buildId, BUILD_ID);
});

Deno.test("buildNonStreamingResponse: buildId is NOT in the assistant content spoken to caller", async () => {
  const completion: AdapterCompletion = {
    content: "Your rough exterior window quote is ready.",
    action: { kind: "tool_result_speak" },
    orchestrator: { reply: "", toolEvents: [], events: [], state: "quote_ready", voice: null },
  };
  const res = buildNonStreamingResponse("m", completion);
  const body = await res.json();
  const spoken = body.choices[0].message.content as string;
  assert(!spoken.includes(BUILD_ID), "build id must never appear in spoken content");
});
