// Verifies the Phase 4C-β server-side dry-run safeguard: a voice-channel call
// to create_bluladder_booking must NEVER touch Jobber, regardless of prompt
// content or arguments. Web and SMS behavior remains unchanged and is
// exercised by aiOrchestrator/aiTools tests elsewhere in the suite.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool } from "./aiTools.ts";

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
  }
});