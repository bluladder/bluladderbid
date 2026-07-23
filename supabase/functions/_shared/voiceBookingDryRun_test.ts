// Verifies the Phase 4C-β server-side dry-run safeguard: a voice-channel call
// to create_bluladder_booking must NEVER touch Jobber, regardless of prompt
// content or arguments. Web and SMS behavior remains unchanged and is
// exercised by aiOrchestrator/aiTools tests elsewhere in the suite.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool, voiceLiveBookingEnabled } from "./aiTools.ts";

const stubSupabase: any = {
  from() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
          order: () => ({ limit: async () => ({ data: [] }) }),
        }),
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    };
  },
  rpc: async () => ({ data: null, error: null }),
};

Deno.test("voice channel: create_bluladder_booking returns dry-run without any network write", async () => {
  const prev = Deno.env.get("VOICE_LIVE_BOOKING_ENABLED");
  Deno.env.delete("VOICE_LIVE_BOOKING_ENABLED");
  assertEquals(voiceLiveBookingEnabled(), false);
  const ctx = {
    supabase: stubSupabase,
    conversationId: "conv_voice",
    sessionToken: "",
    channel: "voice" as const,
  };
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const result = await runTool("create_bluladder_booking", ctx, {
      confirmed: true,
      slotId: "slot_xyz",
      address: "123 Test St",
    }) as { status: string; simulated: boolean; message: string };
    assertEquals(result.status, "voice_beta_dry_run");
    assertEquals(result.simulated, true);
    assert(typeof result.message === "string" && result.message.length > 0);
    assertEquals(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev === undefined) Deno.env.delete("VOICE_LIVE_BOOKING_ENABLED");
    else Deno.env.set("VOICE_LIVE_BOOKING_ENABLED", prev);
  }
});

Deno.test("voice channel: VOICE_LIVE_BOOKING_ENABLED=true unlocks the shared booking pipeline (still gated downstream)", async () => {
  const prev = Deno.env.get("VOICE_LIVE_BOOKING_ENABLED");
  Deno.env.set("VOICE_LIVE_BOOKING_ENABLED", "true");
  assertEquals(voiceLiveBookingEnabled(), true);
  const ctx = {
    supabase: stubSupabase,
    conversationId: "conv_voice_live",
    sessionToken: "",
    channel: "voice" as const,
  };
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };
  try {
    // With no quote/slot context in the stub, the shared pipeline must NOT
    // return the voice-beta dry-run — it must exercise the same guardrails as
    // SMS/web (missing slot → refresh), proving the branch is unified.
    const result = await runTool("create_bluladder_booking", ctx, {
      confirmed: true,
      slotId: "slot_xyz",
      address: "123 Test St",
    }) as { status: string };
    assert(result.status !== "voice_beta_dry_run");
    // Never a live Jobber write on this path either — the pipeline stops at
    // slot/quote validation before any external call.
    assertEquals(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev === undefined) Deno.env.delete("VOICE_LIVE_BOOKING_ENABLED");
    else Deno.env.set("VOICE_LIVE_BOOKING_ENABLED", prev);
  }
});