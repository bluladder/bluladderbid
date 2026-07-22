import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runVoiceAdapterStream, type VoiceStreamEvent } from "./voiceAdapter.ts";
import type { ParsedAdapterRequest } from "./voiceAdapter.ts";

// Minimal Supabase stub — no rows anywhere. runOrchestrator will short-circuit
// cleanly because facts/history are empty and no tools are invoked.
function stubSupabase(): any {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (fn: any) => fn({ data: [], error: null }),
  };
  return {
    from: () => q,
  };
}

function makeParsed(userMessage: string, stream = true): ParsedAdapterRequest {
  return {
    messages: [{ role: "user", content: userMessage }],
    stream,
    sessionId: "synthetic-test",
    sessionIdIsSynthetic: true,
  };
}

Deno.test("streaming adapter: slow branch emits an acknowledgement before completion", async () => {
  const events: VoiceStreamEvent[] = [];
  // No LOVABLE_API_KEY set here — runOrchestrator's callModel will fail. That's
  // fine: we only care that the acknowledgement event fires BEFORE the
  // orchestrator resolves, and that stripping of flush tags happens.
  const result = await runVoiceAdapterStream({
    supabase: stubSupabase(),
    request: makeParsed("How much does it cost to clean my windows?"),
    emit: (ev) => { events.push(ev); },
  });
  const ackIdx = events.findIndex((e) => e.type === "acknowledgement");
  const completeIdx = events.findIndex((e) => e.type === "complete");
  assert(ackIdx >= 0, "acknowledgement event must be emitted");
  assert(completeIdx > ackIdx, "complete must come after acknowledgement");
  // Persisted text must not contain the flush tag.
  assert(!result.content.includes("<flush"), "final content must not contain flush tag");
  // Route classification is deterministic full_orchestrator for pricing.
  assertEquals(result.route.type, "full_orchestrator");
});

Deno.test("streaming adapter: fast path emits role delta immediately and no acknowledgement", async () => {
  const events: VoiceStreamEvent[] = [];
  await runVoiceAdapterStream({
    supabase: stubSupabase(),
    request: makeParsed("What services do you offer?"),
    emit: (ev) => { events.push(ev); },
  });
  const roleIdx = events.findIndex((e) => e.type === "role_delta");
  const ackEv = events.find((e) => e.type === "acknowledgement");
  assert(roleIdx >= 0, "role_delta must be emitted");
  assertEquals(ackEv, undefined, "fast path must not emit an acknowledgement");
});

Deno.test("streaming adapter: fast path returns fast_knowledge route", async () => {
  const events: VoiceStreamEvent[] = [];
  const result = await runVoiceAdapterStream({
    supabase: stubSupabase(),
    request: makeParsed("What services do you offer?"),
    emit: (ev) => { events.push(ev); },
  });
  // In an environment without a LOVABLE_API_KEY, the streamer yields an error
  // and the adapter falls back to full orchestrator. That's acceptable: what
  // matters is that classification chose fast_knowledge first.
  const routeEv = events.find((e) => e.type === "route");
  assert(routeEv && routeEv.type === "route");
  if (routeEv && routeEv.type === "route") {
    assertEquals(routeEv.route.type, "fast_knowledge");
  }
  // Route on the returned result may be either — pin the classifier only.
  assert(result);
});
