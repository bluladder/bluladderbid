// ============================================================================
// voiceRemediation68_test.ts — 6.8 address-gate ENFORCEMENT.
//
// 6.7 introduced the gate; this suite proves the execution paths honor it:
// the canonical DB write, the state machine, rail ordering, the single voice
// reply funnel, house-number mismatch recovery and truthful exit language.
// No network, no real message, no provider call.
// ============================================================================
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool } from "../aiTools.ts";
import { applyVoiceReplySafety, persistFacts } from "../aiOrchestrator.ts";
import {
  computeState,
  type ConversationFacts,
  isToolAllowed,
} from "../conversationState.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "../publicBookingServiceArea.ts";
import {
  buildAddressReadback,
  expandStreetSuffix,
  parseSpokenHouseNumber,
  planVoiceAddressGate,
  replaceHouseNumber,
} from "./voiceAddressGate.ts";
import { planVoiceExitIntent } from "./voiceExitIntents.ts";

// ---------------------------------------------------------------------------
// Minimal Supabase + geocode stubs (integration-style, zero network).
// ---------------------------------------------------------------------------
const CONFIG = {
  allowed_cities: ["McKinney", "Frisco"],
  manual_review_counties: [],
  state_code: "TX",
  out_of_area_message: "We'll follow up.",
  is_configured: true,
};
const ORGANIZATION_ID = PUBLIC_BOOKING_ORGANIZATION_ID;

function makeSupabase(organizationId = ORGANIZATION_ID) {
  const updates: { table: string; payload: any }[] = [];
  const upserts: { table: string; payload: any }[] = [];
  const filters: { table: string; key: string; value: unknown }[] = [];
  const rows: Record<string, Record<string, unknown>> = {
    chat_conversations: {
      id: "conv-test",
      quote_session_id: "quote-session-test",
      organization_id: organizationId,
    },
    quote_sessions: {
      id: "quote-session-test",
      organization_id: organizationId,
      channel: "voice",
      conversation_ids: ["conv-test"],
      fields: {},
      field_status: {},
      required_remaining: [],
      quote_status: "none",
      booking_ready: false,
    },
  };
  const api: any = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq(key: string, value: unknown) {
          filters.push({ table, key, value });
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "service_area_config"
              ? CONFIG
              : rows[table] ?? null,
            error: null,
          }),
        single: () => Promise.resolve({ data: null, error: null }),
        update(payload: any) {
          updates.push({ table, payload });
          return chain;
        },
        upsert(payload: any) {
          upserts.push({ table, payload });
          return chain;
        },
        insert() {
          return chain;
        },
        then: (res: any) =>
          Promise.resolve({ data: null, error: null }).then(res),
      };
      return chain;
    },
  };
  return { api, updates, upserts, filters };
}

function stubGeocode(formatted: string, houseNumber: string) {
  const original = globalThis.fetch;
  const previousLovableKey = Deno.env.get("LOVABLE_API_KEY");
  const previousMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  Deno.env.set("LOVABLE_API_KEY", "test-key");
  Deno.env.set("GOOGLE_MAPS_API_KEY", "test-connection");
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: "OK",
          results: [{
            formatted_address: formatted,
            address_components: [
              { types: ["street_number"], long_name: houseNumber },
              { types: ["route"], long_name: "Binbranch Lane" },
              { types: ["locality"], long_name: "McKinney" },
              {
                types: ["administrative_area_level_2"],
                long_name: "Collin County",
              },
              {
                types: ["administrative_area_level_1"],
                short_name: "TX",
                long_name: "Texas",
              },
              { types: ["postal_code"], long_name: "75071" },
              { types: ["country"], short_name: "US" },
            ],
            geometry: { location: { lat: 33.2, lng: -96.6 } },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as typeof fetch;
  return () => {
    globalThis.fetch = original;
    const restoreEnv = (key: string, value: string | undefined) =>
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    restoreEnv("LOVABLE_API_KEY", previousLovableKey);
    restoreEnv("GOOGLE_MAPS_API_KEY", previousMapsKey);
  };
}

const ADDRESS = "5612 Binbranch Lane, McKinney, TX 75071";

Deno.test("every direct voice tool proves conversation organization before side effects", async () => {
  const otherOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const cases: Array<[string, Record<string, unknown>]> = [
    ["calculate_bluladder_quote", { services: ["house_wash"] }],
    ["get_bluladder_availability", {}],
    ["create_bluladder_booking", { confirmed: true, slotId: "slot-1" }],
    ["validate_service_area", { address: ADDRESS }],
    ["request_manual_quote", { reason: "test" }],
    ["request_human_callback", { reason: "test" }],
    ["escalate_to_human", { reason: "test" }],
    [
      "record_consent",
      {
        channel: "sms",
        consentType: "requested_follow_up",
        granted: true,
        phone: "+14690000000",
        languageShown: "Please contact me about this request.",
      },
    ],
  ];

  for (const [name, args] of cases) {
    const { api, updates, upserts } = makeSupabase();
    const result = await runTool(name, {
      supabase: api,
      conversationId: "conv-other-tenant",
      sessionToken: "sess-other-tenant",
      channel: "voice",
      organizationId: otherOrganizationId,
    }, args) as { status: string };
    assertEquals(result.status, "tenant_authority_required", name);
    assertEquals(updates.length, 0, name);
    assertEquals(upserts.length, 0, name);
  }
});

Deno.test("same-tenant voice tools cannot inherit DFW capabilities in another organization", async () => {
  const otherOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { api, updates, upserts } = makeSupabase(otherOrganizationId);
  const result = await runTool("validate_service_area", {
    supabase: api,
    conversationId: "conv-test",
    sessionToken: "sess-other-tenant",
    channel: "voice",
    organizationId: otherOrganizationId,
  }, { address: ADDRESS }) as { status: string };

  assertEquals(result.status, "organization_capability_unavailable");
  assertEquals(updates.length, 0);
  assertEquals(upserts.length, 0);
});

// ---------------------------------------------------------------------------
// 1) The DB write itself is gated on the voice channel.
// ---------------------------------------------------------------------------
Deno.test("voice validate_service_area never writes service_area_status=eligible", async () => {
  const restore = stubGeocode(ADDRESS, "5612");
  try {
    const { api, updates } = makeSupabase();
    const result: any = await runTool("validate_service_area", {
      supabase: api,
      conversationId: "conv-1",
      sessionToken: "sess-1",
      channel: "voice",
      organizationId: ORGANIZATION_ID,
    }, { address: ADDRESS });
    assertEquals(result.status, "eligible");
    const write = updates.find((u) => u.table === "chat_conversations");
    assert(write, "expected a chat_conversations update");
    assertEquals(write!.payload.service_area_status, "pending_confirmation");
    assertEquals(
      write!.payload.service_area_result.status,
      "pending_confirmation",
    );
    assertEquals(write!.payload.service_area_result.gatedFrom, "eligible");
  } finally {
    restore();
  }
});

Deno.test("web validate_service_area still writes eligible (unchanged)", async () => {
  const restore = stubGeocode(ADDRESS, "5612");
  try {
    const { api, updates } = makeSupabase();
    await runTool("validate_service_area", {
      supabase: api,
      conversationId: "conv-2",
      sessionToken: "sess-2",
      channel: "web",
    }, { address: ADDRESS });
    const write = updates.find((u) => u.table === "chat_conversations");
    assertEquals(write!.payload.service_area_status, "eligible");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 2) persistFacts mirrors the gate into the legacy columns every time.
// ---------------------------------------------------------------------------
Deno.test("persistFacts mirrors pending candidate as pending_confirmation", async () => {
  const { api, filters, updates, upserts } = makeSupabase();
  const facts: ConversationFacts = {
    address: ADDRESS,
    serviceArea: { status: "pending_confirmation", formattedAddress: ADDRESS },
    addressCandidate: {
      formattedAddress: ADDRESS,
      spokenAddress: ADDRESS,
      status: "pending",
      confirmedAddress: null,
    },
  };
  await persistFacts(api, "conv-3", facts, "validating_service_area", {
    channel: "voice",
    sessionToken: "sess-3",
    organizationId: ORGANIZATION_ID,
  });
  const write = updates.find((u) => u.table === "chat_conversations");
  assertEquals(write!.payload.service_area_status, "pending_confirmation");
  assertEquals(write!.payload.service_address, ADDRESS);
  assertEquals(upserts.length, 0);
  assertEquals(
    filters.some((filter) =>
      filter.table === "chat_conversations" &&
      filter.key === "organization_id" &&
      filter.value === ORGANIZATION_ID
    ),
    true,
  );
});

Deno.test("persistFacts mirrors an explicit confirmation as eligible", async () => {
  const { api, updates } = makeSupabase();
  const facts: ConversationFacts = {
    address: ADDRESS,
    serviceArea: { status: "eligible", formattedAddress: ADDRESS },
    addressCandidate: {
      formattedAddress: ADDRESS,
      spokenAddress: ADDRESS,
      status: "confirmed",
      confirmedAddress: ADDRESS,
    },
  };
  await persistFacts(api, "conv-4", facts, "pricing", {
    channel: "voice",
    sessionToken: "sess-4",
    organizationId: ORGANIZATION_ID,
  });
  const write = updates.find((u) => u.table === "chat_conversations");
  assertEquals(write!.payload.service_area_status, "eligible");
  assertEquals(write!.payload.service_address, ADDRESS);
});

Deno.test("persistFacts fails closed when facts claim eligible without confirmation", async () => {
  const { api, updates } = makeSupabase();
  await persistFacts(
    api,
    "conv-5",
    {
      address: ADDRESS,
      serviceArea: { status: "eligible", formattedAddress: ADDRESS },
    },
    "validating_service_area",
    {
      channel: "voice",
      sessionToken: "s",
      organizationId: ORGANIZATION_ID,
    },
  );
  const write = updates.find((u) => u.table === "chat_conversations");
  assertEquals(write!.payload.service_area_status, "pending_confirmation");
});

Deno.test("persistFacts clears the columns when the candidate is rejected", async () => {
  const { api, updates } = makeSupabase();
  await persistFacts(
    api,
    "conv-6",
    {
      serviceArea: null,
      addressCandidate: null,
    },
    "collecting_address",
    {
      channel: "voice",
      sessionToken: "s",
      organizationId: ORGANIZATION_ID,
    },
  );
  const write = updates.find((u) => u.table === "chat_conversations");
  assertEquals(write!.payload.service_area_status, null);
  assertEquals(write!.payload.service_area_result, null);
});

// ---------------------------------------------------------------------------
// 3) pending_confirmation is a validating state, never manual review.
// ---------------------------------------------------------------------------
Deno.test("pending_confirmation computes validating_service_area and blocks booking", () => {
  const facts: ConversationFacts = {
    services: ["window_cleaning"],
    address: ADDRESS,
    serviceArea: { status: "pending_confirmation", formattedAddress: ADDRESS },
    quote: {
      status: "firm",
      firm: true,
      total: 400,
      inputsKey: "x",
    },
  };
  const state = computeState(facts, "web");
  assertEquals(state, "validating_service_area");
  assertEquals(
    isToolAllowed(state, "get_bluladder_availability", "web"),
    false,
  );
  assertEquals(isToolAllowed(state, "create_bluladder_booking", "web"), false);
});

// ---------------------------------------------------------------------------
// 4) Deterministic rails must be ordered before rough quote / quote-by-text.
// ---------------------------------------------------------------------------
Deno.test("orchestration source order: exit/address rails run first", async () => {
  const src = await Deno.readTextFile(
    new URL("../aiOrchestrator.ts", import.meta.url),
  );
  const rails = src.indexOf("// ---- Deterministic voice rails (pre-model)");
  const rough = src.indexOf("// Voice rough-quote rail runs before");
  const byText = src.indexOf("// ---- Truthful quote-by-text rail");
  assert(rails > 0 && rough > 0 && byText > 0, "expected all three rails");
  assert(rails < rough, "exit/address rails must precede the rough quote rail");
  assert(rails < byText, "exit/address rails must precede quote-by-text");
});

// ---------------------------------------------------------------------------
// 5) finalize is the single voice reply funnel.
// ---------------------------------------------------------------------------
Deno.test("leaked reasoning from a no-tool completion is never spoken", () => {
  const events: string[] = [];
  const spoken = applyVoiceReplySafety({
    reply:
      "thought Okay, I need `squareFootage` and `stories` for the window cleaning quote. Let me ask the user for these details.",
    facts: { services: ["window_cleaning"] },
    events,
  });
  assertEquals(spoken, "About how many square feet is your home?");
  assert(!/thought|squareFootage/i.test(spoken));
});

Deno.test("a fresh pending address is read back even for an ordinary no-tool reply", () => {
  const events: string[] = [];
  const spoken = applyVoiceReplySafety({
    reply: "Great! How many stories is your home?",
    facts: {
      addressCandidate: {
        formattedAddress: ADDRESS,
        spokenAddress: ADDRESS,
        status: "pending",
        confirmedAddress: null,
      },
    },
    events,
  });
  assertStringIncludes(spoken, "Is that exactly right?");
  assert(events.includes("voice_address_confirmation_required"));
});

Deno.test("deterministic rail replies are sanitized but never overridden", () => {
  const events: string[] = [];
  const spoken = applyVoiceReplySafety({
    reply: "You're already on our team's list.",
    facts: {
      addressCandidate: {
        formattedAddress: ADDRESS,
        status: "pending",
        confirmedAddress: null,
      },
    },
    events,
    deterministic: true,
  });
  assertEquals(spoken, "You're already on our team's list.");
  assertEquals(events.length, 0);
});

Deno.test("two stacked questions collapse to one", () => {
  const spoken = applyVoiceReplySafety({
    reply: "How many square feet is your home? And how many stories?",
    facts: {},
    events: [],
  });
  assertEquals(spoken, "How many square feet is your home?");
});

// ---------------------------------------------------------------------------
// 6) House-number mismatch recovery across two turns (5610 vs 5612).
// ---------------------------------------------------------------------------
Deno.test("5610-vs-5612 mismatch recovers on the next turn", () => {
  const turn1 = planVoiceAddressGate({
    formattedAddress: "5610 Binbranch Ln, McKinney, TX 75071",
    spokenAddress: "5612 Binbranch Lane McKinney Texas",
  });
  assertEquals(turn1.kind, "ask_house_number");
  assertEquals(turn1.serviceAreaStatus, "pending_confirmation");

  const supplied = parseSpokenHouseNumber("five six one two");
  assertEquals(supplied, "5612");
  const rebuilt = replaceHouseNumber(
    "5610 Binbranch Ln, McKinney, TX 75071",
    supplied!,
  );
  assertEquals(rebuilt, "5612 Binbranch Ln, McKinney, TX 75071");

  const turn2 = planVoiceAddressGate({
    formattedAddress: rebuilt,
    spokenAddress: rebuilt,
  });
  assertEquals(turn2.kind, "ask_confirmation");
  assertEquals(turn2.serviceAreaStatus, "pending_confirmation");
  assertStringIncludes(turn2.reply, "five-six-one-two");
  assertStringIncludes(turn2.reply, "B-I-N-B-R-A-N-C-H");
});

Deno.test("digit house numbers are also accepted", () => {
  assertEquals(parseSpokenHouseNumber("it's 5612"), "5612");
  assertEquals(parseSpokenHouseNumber("uh, I don't know"), null);
});

// ---------------------------------------------------------------------------
// 7) Truthful human / hangup language.
// ---------------------------------------------------------------------------
Deno.test("human request relays the escalation tool's own message", () => {
  const plan = planVoiceExitIntent("human_request", {
    escalationSucceeded: true,
    escalationMessage: "I've alerted the team and someone will call you back.",
  });
  assertEquals(
    plan.reply,
    "I've alerted the team and someone will call you back.",
  );
  assertEquals(plan.escalationRecorded, true);
  assertEquals(plan.event, "voice_human_request_escalated");
});

Deno.test("a failed escalation is not marked recorded and is not claimed", () => {
  const plan = planVoiceExitIntent("human_request", {
    escalationSucceeded: false,
  });
  assertEquals(plan.escalationRecorded, false);
  assertEquals(plan.event, "voice_human_request_escalation_failed");
  assert(!/passed this to our team|I've recorded/i.test(plan.reply));
});

Deno.test("a repeated successful request reuses the existing escalation", () => {
  const plan = planVoiceExitIntent("human_request", {
    escalationAlreadyRecorded: true,
  });
  assertEquals(plan.event, "voice_human_request_reused");
  assertEquals(plan.escalationRecorded, true);
});

Deno.test("leaving language is conditional and never asserts a send", () => {
  const plan = planVoiceExitIntent("leaving");
  assertStringIncludes(plan.reply, "I'll try to text");
  assert(!/I'll send/i.test(plan.reply));
});

// ---------------------------------------------------------------------------
// 8) Readback pronunciation.
// ---------------------------------------------------------------------------
Deno.test("street suffix abbreviations are expanded for speech", () => {
  assertEquals(expandStreetSuffix("Ln"), "Lane");
  assertEquals(expandStreetSuffix("st"), "Street");
  assertEquals(expandStreetSuffix("Blvd"), "Boulevard");
  const reply = buildAddressReadback("5612 Binbranch Ln, McKinney, TX 75071");
  assertStringIncludes(reply, "Lane");
  assert(!/\bLn\b/.test(reply));
});
