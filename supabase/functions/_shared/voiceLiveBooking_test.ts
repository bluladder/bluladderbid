// ============================================================================
// voiceLiveBooking_test.ts — live voice booking lane.
//
// Covers: success, missing confirmation, invalid address, unavailable slot,
// Jobber failure, and replay/idempotency (stable idempotency key + single
// provider write per confirmed attempt). No real network, provider, or DB.
// ============================================================================
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool, resolveVoiceBookingLane } from "./aiTools.ts";
import { getBookingReadiness } from "./bookingReadiness.ts";
import { sessionInputsKey } from "./quoteSession.ts";

const CALLER = "+14692150144";
const START = new Date(Date.now() + 86_400_000).toISOString();
const END = new Date(Date.now() + 90_000_000).toISOString();

const QUOTE_FIELDS = {
  services: ["gutterCleaning"],
  squareFootage: 2500,
  stories: 1,
  address: "5612 Binbranch Ln, McKinney, TX 75071",
};
const QUOTE_INPUTS_KEY = sessionInputsKey(QUOTE_FIELDS);
const QUOTE = {
  status: "firm",
  total: 200,
  estimatedDurationMinutes: 120,
  durationSource: "authoritative_quote",
  durationVersion: "duration-v1",
  engineVersion: "1.0.0",
  ruleVersion: 1,
  taxPolicyVersion: null,
  inputsKey: QUOTE_INPUTS_KEY,
};

const PRICING_ROWS = [
  "window_cleaning",
  "window_addons",
  "house_wash",
  "gutter_cleaning",
  "roof_cleaning",
  "driveway_cleaning",
  "pressure_washing",
  "solar_panel_cleaning",
  "screen_repair",
].map((config_key) => ({ config_key, config_value: {} }));

function stubSupabase(opts: { address?: string } = {}) {
  const updates: Record<string, unknown>[] = [];
  const convo = {
    quote_result: QUOTE,
    prospect_name: "Ben Test",
    prospect_email: "owner@example.com",
    prospect_phone: CALLER,
    service_address: opts.address ?? "5612 Binbranch Ln, McKinney, TX 75071",
    property_id: "property-live",
    quote_session_id: "quote-session-live",
    customer_id: "customer-live",
    confirmed_email_customer_id: null,
    resolution_method: "phone_exact",
    resolution_confidence: "high",
    awaiting_email_disambiguation: false,
  };
  const offer = {
    tool_result: {
      offerVersion: "v1",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      quoteSignature: QUOTE_INPUTS_KEY,
      quoteIdentity: {
        quoteSessionId: "quote-session-live",
        quoteId: "quote-live",
        inputsKey: QUOTE_INPUTS_KEY,
        pricingVersion: 1,
        engineVersion: "1.0.0",
        durationVersion: "duration-v1",
        taxPolicyVersion: null,
      },
      offered: [{
        slotId: "slot_live_1",
        startTime: START,
        endTime: END,
        displayTime: "Friday at 9:00 AM",
        durationMinutes: 120,
        __technicianId: "tech-1",
        __isTeamJob: false,
      }],
    },
  };
  const rows: Record<string, unknown> = {
    chat_conversations: convo,
    quote_sessions: {
      id: "quote-session-live",
      quote_id: "quote-live",
      channel: "voice",
      conversation_ids: ["conv_live"],
      fields: { ...QUOTE_FIELDS, lastQuoteResult: QUOTE },
      field_status: {},
      required_remaining: [],
      quote_status: "firm",
      booking_ready: true,
    },
    customer_properties: {
      id: "customer-property-live",
      customer_id: "customer-live",
      property_id: "property-live",
      active: true,
    },
    autosync_config: {
      last_full_sync_completed_at: new Date().toISOString(),
      lock_holder_id: null,
      lock_acquired_at: null,
      last_run_status: "completed",
    },
    system_test_config: { suppress_all: false, suppress_reason: null },
    service_area_config: {
      allowed_cities: ["McKinney"],
      manual_review_counties: ["Collin"],
      state_code: "TX",
      out_of_area_message: "The team will confirm eligibility.",
      is_configured: true,
    },
  };
  const listRows: Record<string, unknown[]> = {
    chat_messages: [offer],
    pricing_config: PRICING_ROWS,
    property_facts_current: [],
  };

  function builder(table: string) {
    const b: any = {
      select: () => b,
      eq: () => b,
      or: () => b,
      order: () => b,
      insert: (v: unknown) => {
        updates.push({ table, insert: v });
        return b;
      },
      upsert: (v: unknown) => {
        updates.push({ table, upsert: v });
        return b;
      },
      update: (v: unknown) => {
        updates.push({ table, update: v });
        return b;
      },
      limit: async () => ({ data: listRows[table] ?? [], error: null }),
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      single: async () => ({ data: rows[table] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({
          data: listRows[table] ?? (rows[table] ? [rows[table]] : []),
          error: null,
        }).then(res),
    };
    return b;
  }
  return {
    updates,
    client: {
      from: (table: string) => builder(table),
      rpc: async (name: string) => ({
        data: name === "current_pricing_version" ? 1 : null,
        error: null,
      }),
    } as any,
  };
}

const GEOCODE_OK = {
  status: "OK",
  results: [{
    formatted_address: "5612 Binbranch Ln, McKinney, TX 75071, USA",
    partial_match: false,
    geometry: { location: { lat: 33.2, lng: -96.6 } },
    address_components: [
      { long_name: "5612", short_name: "5612", types: ["street_number"] },
      { long_name: "Binbranch Lane", short_name: "Binbranch Ln", types: ["route"] },
      { long_name: "McKinney", short_name: "McKinney", types: ["locality"] },
      { long_name: "Collin County", short_name: "Collin County", types: ["administrative_area_level_2"] },
      { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1"] },
      { long_name: "75071", short_name: "75071", types: ["postal_code"] },
      { long_name: "United States", short_name: "US", types: ["country"] },
    ],
  }],
};

interface Harness {
  bookingCalls: { body: any }[];
  restore: () => void;
}

function withLiveEnv(
  jobberResponse: () => Response,
  geocode: unknown = GEOCODE_OK,
): Harness {
  const prev = {
    live: Deno.env.get("VOICE_LIVE_BOOKING_ENABLED"),
    list: Deno.env.get("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST"),
    lovable: Deno.env.get("LOVABLE_API_KEY"),
    maps: Deno.env.get("GOOGLE_MAPS_API_KEY"),
  };
  const prevEnvName = Deno.env.get("LOVABLE_ENV");
  Deno.env.set("LOVABLE_ENV", "production");
  Deno.env.set("VOICE_LIVE_BOOKING_ENABLED", "true");
  Deno.env.set("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST", CALLER);
  Deno.env.set("LOVABLE_API_KEY", "test-lovable-key");
  Deno.env.set("GOOGLE_MAPS_API_KEY", "test-connection-key");
  const originalFetch = globalThis.fetch;
  const bookingCalls: { body: any }[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/maps/api/geocode/json")) {
      return new Response(JSON.stringify(geocode), { status: 200 });
    }
    if (url.includes("jobber-create-booking")) {
      bookingCalls.push({ body: JSON.parse(String(init?.body ?? "{}")) });
      return jobberResponse();
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return {
    bookingCalls,
    restore() {
      globalThis.fetch = originalFetch;
      const set = (k: string, v: string | undefined) =>
        v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
      set("VOICE_LIVE_BOOKING_ENABLED", prev.live);
      set("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST", prev.list);
      set("LOVABLE_API_KEY", prev.lovable);
      set("GOOGLE_MAPS_API_KEY", prev.maps);
      set("LOVABLE_ENV", prevEnvName);
    },
  };
}

function voiceCtx(client: any, conversationId = "conv_live") {
  return {
    supabase: client,
    conversationId,
    sessionToken: "",
    channel: "voice" as const,
  };
}

Deno.test("lane resolution requires flag AND allowlisted caller", () => {
  const h = withLiveEnv(() => new Response("{}", { status: 200 }));
  try {
    assertEquals(resolveVoiceBookingLane(CALLER), "live");
    assertEquals(resolveVoiceBookingLane("+12145550000"), "dry_run");
    assertEquals(resolveVoiceBookingLane(null), "dry_run");
    Deno.env.set("VOICE_LIVE_BOOKING_ENABLED", "false");
    assertEquals(resolveVoiceBookingLane(CALLER), "dry_run");
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: success routes through jobber-create-booking", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(JSON.stringify({ jobberVisitId: "visit_1" }), { status: 200 })
  );
  try {
    const readiness = await getBookingReadiness(client, "conv_live");
    assertEquals(readiness.ready, true, JSON.stringify(readiness));
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      confirmed: true,
      slotId: "slot_live_1",
    }) as { status: string; confirmedTime?: string };
    assertEquals(result.status, "confirmed", JSON.stringify(result));
    assertEquals(result.confirmedTime, "Friday at 9:00 AM");
    assertEquals(h.bookingCalls.length, 1);
    const body = h.bookingCalls[0].body;
    assertEquals(body.idempotencyKey, `voice|conv_live|${START}`);
    assertEquals(body.customer.address, "5612 Binbranch Ln, McKinney, TX 75071");
    assertEquals(body.scheduledStart, START);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: missing explicit confirmation never writes", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(JSON.stringify({ jobberVisitId: "visit_x" }), { status: 200 })
  );
  try {
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      slotId: "slot_live_1",
    }) as { status: string };
    assertEquals(result.status, "not_confirmed");
    assertEquals(h.bookingCalls.length, 0);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: unverifiable address blocks the write", async () => {
  const { client } = stubSupabase({ address: "5612 Binbranch Ln" });
  const h = withLiveEnv(
    () => new Response("{}", { status: 200 }),
    { status: "ZERO_RESULTS", results: [] },
  );
  try {
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      confirmed: true,
      slotId: "slot_live_1",
    }) as { status: string };
    assertEquals(result.status, "address_unverified");
    assertEquals(h.bookingCalls.length, 0);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: slot outside the latest offer requires refresh", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(JSON.stringify({ jobberVisitId: "visit_x" }), { status: 200 })
  );
  try {
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      confirmed: true,
      slotId: "slot_stale_999",
    }) as { status: string };
    assertEquals(result.status, "schedule_refresh_required");
    assertEquals(h.bookingCalls.length, 0);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: real 409 conflict reports the slot as taken", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(JSON.stringify({ code: "CONFLICT" }), { status: 409 })
  );
  try {
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      confirmed: true,
      slotId: "slot_live_1",
    }) as { status: string };
    assertEquals(result.status, "slot_taken");
    assertEquals(h.bookingCalls.length, 1);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: Jobber failure is reported truthfully as unconfirmed", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(JSON.stringify({ error: "jobber_down" }), { status: 500 })
  );
  try {
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      confirmed: true,
      slotId: "slot_live_1",
    }) as { status: string; message: string };
    assertEquals(result.status, "error");
    assert(result.message.includes("no appointment is confirmed"));
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: replay of the same confirmation reuses one idempotency key", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(JSON.stringify({ jobberVisitId: "visit_1" }), { status: 200 })
  );
  try {
    const args = { confirmed: true, slotId: "slot_live_1" };
    const a = await runTool("create_bluladder_booking", voiceCtx(client), args) as { status: string };
    const b = await runTool("create_bluladder_booking", voiceCtx(client), args) as { status: string };
    assertEquals(a.status, "confirmed");
    assertEquals(b.status, "confirmed");
    assertEquals(h.bookingCalls.length, 2);
    assertEquals(h.bookingCalls[0].body.idempotencyKey, h.bookingCalls[1].body.idempotencyKey);
  } finally {
    h.restore();
  }
});
