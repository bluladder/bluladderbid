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
import { resolveVoiceBookingLane, runTool } from "./aiTools.ts";
import { getBookingReadiness } from "./bookingReadiness.ts";
import { sessionBookingInputsKey, sessionInputsKey } from "./quoteSession.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "./publicBookingServiceArea.ts";

const CALLER = "+14692150144";
const ORGANIZATION_ID = PUBLIC_BOOKING_ORGANIZATION_ID;
const TEST_NOW = Date.now();
const START = new Date(TEST_NOW + 86_400_000).toISOString();
const END = new Date(TEST_NOW + 90_000_000).toISOString();

const QUOTE_FIELDS = {
  services: ["gutterCleaning"],
  squareFootage: 2500,
  stories: 1,
  address: "5612 Binbranch Ln, McKinney, TX 75071",
  serviceAreaStatus: "eligible" as const,
  name: "Ben Test",
  email: "owner@example.com",
  phone: CALLER,
};
const QUOTE_INPUTS_KEY = sessionInputsKey(QUOTE_FIELDS);
const QUOTE = {
  status: "firm",
  total: 200,
  subtotal: 200,
  serviceSubtotal: 200,
  discountsAndAdjustments: 0,
  taxableSubtotal: 200,
  estimatedTax: 17,
  estimatedTotal: 217,
  taxRate: 0.085,
  taxLabel: "Estimated sales tax",
  jobberLineItems: [{ name: "Gutter Cleaning", unitPrice: 200 }],
  lineItems: [{
    key: "gutter_cleaning",
    label: "Gutter Cleaning",
    amount: 200,
  }],
  priceAdjustments: [],
  discount: null,
  promotion: null,
  bookableServiceKeys: ["gutter_cleaning"],
  estimatedDurationMinutes: 60,
  durationSource: "deterministic_duration_engine",
  durationVersion: "duration-v1",
  engineVersion: "1.0.0",
  ruleVersion: 1,
  taxPolicyVersion: "tax-v1",
  inputsKey: QUOTE_INPUTS_KEY,
};
const BOOKING_INPUTS_KEY = sessionBookingInputsKey({
  ...QUOTE_FIELDS,
  lastQuoteResult: QUOTE,
});

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

function stubSupabase(
  opts: {
    address?: string;
    organizationId?: string;
    confirmationPersistenceFails?: boolean;
  } = {},
) {
  const updates: Record<string, unknown>[] = [];
  const organizationId = opts.organizationId ?? ORGANIZATION_ID;
  const convo = {
    id: "conv_live",
    channel: "voice",
    organization_id: organizationId,
    session_token: "voice-session-live",
    quote_result: QUOTE,
    prospect_name: "Ben Test",
    prospect_email: "owner@example.com",
    prospect_phone: CALLER,
    service_address: opts.address ?? "5612 Binbranch Ln, McKinney, TX 75071",
    service_area_status: "eligible",
    property_id: "property-live",
    quote_session_id: "quote-session-live",
    customer_id: "customer-live",
    confirmed_email_customer_id: "customer-live",
    resolution_method: "email_confirmed",
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
        taxPolicyVersion: "tax-v1",
      },
      bookingInputsKey: BOOKING_INPUTS_KEY,
      organizationId,
      offered: [{
        slotId: "slot_live_1",
        startTime: START,
        endTime: END,
        displayTime: "Friday at 9:00 AM",
        durationMinutes: 60,
        timezone: "America/Chicago",
        __technicianId: "tech-1",
        __isTeamJob: false,
      }],
    },
  };
  const rows: Record<string, unknown> = {
    chat_conversations: convo,
    quote_sessions: {
      id: "quote-session-live",
      organization_id: organizationId,
      quote_id: "quote-live",
      customer_id: "customer-live",
      property_id: "property-live",
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
    properties: {
      id: "property-live",
      organization_id: organizationId,
      active: true,
      street: "5612 Binbranch Ln",
      city: "McKinney",
      state: "TX",
      postal_code: "75071",
    },
    customers: {
      id: "customer-live",
      organization_id: organizationId,
      first_name: "Ben",
      last_name: "Test",
      email: "owner@example.com",
      phone: CALLER,
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
    let updatePayload: Record<string, unknown> | null = null;
    const b: any = {
      select: () => b,
      eq: () => b,
      is: () => b,
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
        updatePayload = v && typeof v === "object"
          ? v as Record<string, unknown>
          : null;
        const failConfirmation = opts.confirmationPersistenceFails &&
          table === "chat_conversations" &&
          updatePayload?.booking_status === "confirmed";
        if (!failConfirmation && rows[table] && updatePayload) {
          Object.assign(rows[table] as object, v);
        }
        return b;
      },
      limit: async () => ({ data: listRows[table] ?? [], error: null }),
      maybeSingle: async () => {
        if (
          opts.confirmationPersistenceFails &&
          table === "chat_conversations" &&
          updatePayload?.booking_status === "confirmed"
        ) {
          return { data: null, error: { message: "write failed" } };
        }
        return { data: rows[table] ?? null, error: null };
      },
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
      {
        long_name: "Binbranch Lane",
        short_name: "Binbranch Ln",
        types: ["route"],
      },
      { long_name: "McKinney", short_name: "McKinney", types: ["locality"] },
      {
        long_name: "Collin County",
        short_name: "Collin County",
        types: ["administrative_area_level_2"],
      },
      {
        long_name: "Texas",
        short_name: "TX",
        types: ["administrative_area_level_1"],
      },
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
  jobberResponse: (body: any) => Response | Promise<Response>,
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
      const body = JSON.parse(String(init?.body ?? "{}"));
      bookingCalls.push({ body });
      return jobberResponse(body);
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

function successfulBookingResponse(body: any): Response {
  const contract = body.voiceContract;
  return new Response(
    JSON.stringify({
      success: true,
      providerStatus: "accepted",
      localStatus: "persisted",
      jobberJobId: "job_1",
      jobberVisitId: "visit_1",
      bookingId: "booking_1",
      organizationId: contract.organizationId,
      customerId: contract.customerId,
      propertyId: contract.propertyId,
      quoteFingerprint: contract.quoteFingerprint,
      bookingInputsKey: contract.bookingInputsKey,
      offerVersion: contract.offerVersion,
      slotId: contract.slotId,
      scheduledStart: contract.scheduledStart,
      scheduledEnd: contract.scheduledEnd,
      durationMinutes: contract.durationMinutes,
      idempotencyKey: contract.idempotencyKey,
      commandHash: contract.commandHash,
      subtotal: body.subtotal,
      estimatedTax: body.estimatedTax,
      total: body.total,
    }),
    { status: 200 },
  );
}

function voiceCtx(
  client: any,
  conversationId = "conv_live",
  organizationId = ORGANIZATION_ID,
) {
  return {
    supabase: client,
    conversationId,
    sessionToken: "voice-session-live",
    channel: "voice" as const,
    organizationId,
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

Deno.test("live voice booking: an organization without the explicit DFW connector never reaches Jobber", async () => {
  const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { client } = stubSupabase({ organizationId });
  const h = withLiveEnv(() =>
    new Response(
      JSON.stringify({ jobberVisitId: "visit_x", bookingId: "booking_x" }),
      { status: 200 },
    )
  );
  try {
    const result = await runTool(
      "create_bluladder_booking",
      voiceCtx(client, "conv_live", organizationId),
      { confirmed: true, slotId: "slot_live_1" },
    ) as { status: string };
    assertEquals(result.status, "organization_capability_unavailable");
    assertEquals(h.bookingCalls.length, 0);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: success routes through jobber-create-booking", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(successfulBookingResponse);
  try {
    const readiness = await getBookingReadiness(
      client,
      "conv_live",
      ORGANIZATION_ID,
    );
    assertEquals(readiness.ready, true, JSON.stringify(readiness));
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      confirmed: true,
      slotId: "slot_live_1",
      address: "999 Caller Supplied Rd, Other, TX 75000",
    }) as { status: string; confirmedTime?: string; bookingId?: string };
    assertEquals(result.status, "confirmed", JSON.stringify(result));
    assertEquals(result.confirmedTime, "Friday at 9:00 AM");
    assertEquals(result.bookingId, "booking_1");
    assertEquals(h.bookingCalls.length, 1);
    const body = h.bookingCalls[0].body;
    assert(body.idempotencyKey.startsWith("voice_appointment:book:"));
    assertEquals(
      body.customer.address,
      "5612 Binbranch Ln, McKinney, TX 75071",
    );
    assertEquals(body.customer.firstName, "Ben");
    assertEquals(body.customer.lastName, "Test");
    assertEquals(body.customer.email, "owner@example.com");
    assertEquals(body.customer.phone, CALLER);
    assertEquals(body.scheduledStart, START);
    assertEquals(body.scheduledEnd, END);
    assertEquals(body.durationMinutes, 60);
    assertEquals(body.selectedServiceIds, ["gutterCleaning"]);
    assertEquals(body.services, [{ name: "Gutter Cleaning", price: 200 }]);
    assertEquals(body.subtotal, 200);
    assertEquals(body.estimatedTax, 17);
    assertEquals(body.total, 217);
    assertEquals(body.voiceContract.organizationId, ORGANIZATION_ID);
    assertEquals(body.voiceContract.customerId, "customer-live");
    assertEquals(body.voiceContract.propertyId, "property-live");
    assertEquals(body.voiceContract.slotId, "slot_live_1");
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: provider and booking success without conversation persistence is not confirmed", async () => {
  const { client } = stubSupabase({ confirmationPersistenceFails: true });
  const h = withLiveEnv(successfulBookingResponse);
  try {
    const result = await runTool(
      "create_bluladder_booking",
      voiceCtx(client),
      { confirmed: true, slotId: "slot_live_1" },
    ) as { status: string; message: string };
    assertEquals(result.status, "uncertain");
    assert(result.message.includes("must reconcile"));
    assertEquals(h.bookingCalls.length, 1);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: missing explicit confirmation never writes", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(
      JSON.stringify({ jobberVisitId: "visit_x", bookingId: "booking_x" }),
      { status: 200 },
    )
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

Deno.test("live voice booking: conversation/property address drift blocks the write", async () => {
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
    assertEquals(result.status, "address_changed");
    assertEquals(h.bookingCalls.length, 0);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: slot outside the latest offer requires refresh", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(
      JSON.stringify({ jobberVisitId: "visit_x", bookingId: "booking_x" }),
      { status: 200 },
    )
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

Deno.test("live voice booking: provider failure is non-retryable uncertainty", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(JSON.stringify({ error: "jobber_down" }), { status: 500 })
  );
  try {
    const result = await runTool("create_bluladder_booking", voiceCtx(client), {
      confirmed: true,
      slotId: "slot_live_1",
    }) as { status: string; message: string };
    assertEquals(result.status, "uncertain");
    assert(result.message.includes("not confirmed"));
    assert(result.message.includes("do not try again"));
    assertEquals(h.bookingCalls.length, 1);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: malformed success is never spoken as confirmed", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(
      JSON.stringify({
        success: true,
        providerStatus: "accepted",
        localStatus: "persisted",
        bookingId: "booking_1",
        jobberVisitId: "visit_1",
      }),
      { status: 200 },
    )
  );
  try {
    const result = await runTool(
      "create_bluladder_booking",
      voiceCtx(client),
      { confirmed: true, slotId: "slot_live_1" },
    ) as { status: string; message: string };
    assertEquals(result.status, "uncertain");
    assert(result.message.includes("not confirmed"));
    assertEquals(h.bookingCalls.length, 1);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: lost Edge response is non-retryable uncertainty", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() => {
    throw new TypeError("connection reset after write");
  });
  try {
    const result = await runTool(
      "create_bluladder_booking",
      voiceCtx(client),
      { confirmed: true, slotId: "slot_live_1" },
    ) as { status: string; message: string };
    assertEquals(result.status, "uncertain");
    assert(result.message.includes("not confirmed"));
    assert(result.message.includes("do not try again"));
    assertEquals(h.bookingCalls.length, 1);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: HTTP 202 pending manual confirmation is non-retryable uncertainty", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(() =>
    new Response(
      JSON.stringify({
        pendingManualConfirmation: true,
        retryable: false,
        code: "LOCAL_BOOKING_PERSISTENCE_FAILED",
        jobberVisitId: "visit_accepted",
        bookingId: "booking_pending",
      }),
      { status: 202 },
    )
  );
  try {
    const result = await runTool(
      "create_bluladder_booking",
      voiceCtx(client),
      { confirmed: true, slotId: "slot_live_1" },
    ) as { status: string; message: string };
    assertEquals(result.status, "uncertain");
    assert(result.message.includes("not confirmed"));
    assert(result.message.includes("do not try again"));
    assertEquals(h.bookingCalls.length, 1);
  } finally {
    h.restore();
  }
});

Deno.test("live voice booking: replay of the same confirmation reuses one idempotency key", async () => {
  const { client } = stubSupabase();
  const h = withLiveEnv(successfulBookingResponse);
  try {
    const args = { confirmed: true, slotId: "slot_live_1" };
    const a = await runTool(
      "create_bluladder_booking",
      voiceCtx(client),
      args,
    ) as { status: string };
    const b = await runTool(
      "create_bluladder_booking",
      voiceCtx(client),
      args,
    ) as { status: string };
    assertEquals(a.status, "confirmed");
    assertEquals(b.status, "confirmed");
    assertEquals(h.bookingCalls.length, 2);
    assertEquals(
      h.bookingCalls[0].body.idempotencyKey,
      h.bookingCalls[1].body.idempotencyKey,
    );
  } finally {
    h.restore();
  }
});
