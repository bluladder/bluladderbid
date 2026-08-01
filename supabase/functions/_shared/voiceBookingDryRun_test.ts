// Verifies the Phase 4C-β server-side dry-run safeguard: a voice-channel call
// to create_bluladder_booking must NEVER touch Jobber, regardless of prompt
// content or arguments. Web and SMS behavior remains unchanged and is
// exercised by aiOrchestrator/aiTools tests elsewhere in the suite.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool, voiceLiveBookingEnabled } from "./aiTools.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "./publicBookingServiceArea.ts";

const ORGANIZATION_ID = PUBLIC_BOOKING_ORGANIZATION_ID;

const stubSupabase: any = {
  from(table: string) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({
        data: table === "chat_conversations"
          ? {
            organization_id: ORGANIZATION_ID,
            prospect_phone: "+14692150144",
          }
          : null,
        error: null,
      }),
      update: () => chain,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return chain;
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
    organizationId: ORGANIZATION_ID,
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

Deno.test("voice channel: live flag alone cannot unlock the booking pipeline", async () => {
  const prev = Deno.env.get("VOICE_LIVE_BOOKING_ENABLED");
  const prevList = Deno.env.get("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST");
  Deno.env.set("VOICE_LIVE_BOOKING_ENABLED", "true");
  Deno.env.delete("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST");
  assertEquals(voiceLiveBookingEnabled(), true);
  const ctx = {
    supabase: stubSupabase,
    conversationId: "conv_voice_live",
    sessionToken: "",
    channel: "voice" as const,
    organizationId: ORGANIZATION_ID,
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
    }) as { status: string };
    assertEquals(result.status, "voice_beta_dry_run");
    assertEquals(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev === undefined) Deno.env.delete("VOICE_LIVE_BOOKING_ENABLED");
    else Deno.env.set("VOICE_LIVE_BOOKING_ENABLED", prev);
    if (prevList === undefined) {
      Deno.env.delete("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST");
    } else Deno.env.set("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST", prevList);
  }
});
