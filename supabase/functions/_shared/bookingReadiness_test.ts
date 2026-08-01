// Deno tests for get_quote_booking_readiness — verifies status precedence,
// next_action mapping, and that the tool never trusts model-supplied IDs.
// deno-lint-ignore-file no-explicit-any require-await
import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { getBookingReadiness } from "./bookingReadiness.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "./publicBookingServiceArea.ts";

type Row = Record<string, unknown> | null;

interface FakeState {
  conversation?: Row;
  quoteSession?: Row;
  customerProperty?: Row;
  propertyFacts?: any[];
  pricingOk?: boolean;
  ruleVersion?: number | null;
  autosync?: Row;
  pricingConfig?: Row | Row[];
  pricingVersion?: Row;
  writeSpy?: { inserts: number; updates: number };
  readSpy?: string[];
}

function makeSupabase(state: FakeState) {
  const tenantRow = (row: Row): Row =>
    row && !Object.prototype.hasOwnProperty.call(row, "organization_id")
      ? { ...row, organization_id: PUBLIC_BOOKING_ORGANIZATION_ID }
      : row;
  const chain = (rows: any) => {
    let scopedRows = rows;
    const api: any = {
      _rows: scopedRows,
      select: () => api,
      eq: (key: string, value: unknown) => {
        // Only emulate the new tenant predicate. Other tests intentionally use
        // minimal fixture rows that do not model every queried column.
        if (key === "organization_id") {
          if (Array.isArray(scopedRows)) {
            scopedRows = scopedRows.filter((row) =>
              row?.organization_id === value
            );
          } else if (scopedRows?.organization_id !== value) {
            scopedRows = null;
          }
        }
        return api;
      },
      order: () => api,
      limit: () => api,
      is: () => api,
      gte: () => api,
      insert: () => {
        if (state.writeSpy) state.writeSpy.inserts++;
        return {
          select: () => ({ single: async () => ({ data: null, error: null }) }),
        };
      },
      update: () => {
        if (state.writeSpy) state.writeSpy.updates++;
        return { eq: async () => ({ data: null, error: null }) };
      },
      maybeSingle: async () => ({
        data: Array.isArray(scopedRows) ? (scopedRows[0] ?? null) : scopedRows,
        error: null,
      }),
      single: async () => ({
        data: Array.isArray(scopedRows) ? (scopedRows[0] ?? null) : scopedRows,
        error: null,
      }),
      then: (res: any) =>
        Promise.resolve({
          data: Array.isArray(scopedRows)
            ? scopedRows
            : (scopedRows ? [scopedRows] : []),
          error: null,
        }).then(res),
    };
    return api;
  };
  return {
    from(table: string) {
      state.readSpy?.push(table);
      switch (table) {
        case "chat_conversations":
          return chain(tenantRow(state.conversation ?? null));
        case "quote_sessions":
          return chain(tenantRow(state.quoteSession ?? null));
        case "customer_properties":
          return chain(state.customerProperty ?? null);
        case "property_facts_current":
          return chain(state.propertyFacts ?? []);
        case "autosync_config":
          return chain(state.autosync ?? null);
        case "pricing_config":
          return chain(state.pricingConfig ?? null);
        case "pricing_versions":
          return chain(state.pricingVersion ?? null);
        default:
          return chain(null);
      }
    },
    rpc(name: string) {
      if (name === "current_pricing_version") {
        const fromLegacyFixture = state.pricingVersion &&
            typeof state.pricingVersion === "object" &&
            !Array.isArray(state.pricingVersion)
          ? state.pricingVersion.rule_version
          : null;
        return Promise.resolve({
          data: state.ruleVersion ?? fromLegacyFixture ?? null,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as any;
}

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

const freshAutosync = () => ({
  last_full_sync_completed_at: new Date().toISOString(),
  lock_holder_id: null,
  lock_acquired_at: null,
  last_run_status: "completed",
});

const resolvedConversation = (overrides: Record<string, unknown> = {}) => ({
  id: "c-resolved",
  channel: "sms",
  property_id: "prop-1",
  prospect_phone: "+15551112222",
  prospect_email: null,
  quote_session_id: "qs-1",
  service_area_status: "eligible",
  customer_id: "cust-1",
  confirmed_email_customer_id: null,
  resolution_method: "phone_exact",
  resolution_confidence: "high",
  awaiting_email_disambiguation: false,
  staff_takeover_at: null,
  ...overrides,
});

Deno.test("readiness: unresolved identity => identity_blocked / ask_for_email", async () => {
  const supabase = makeSupabase({
    conversation: {
      id: "c1",
      property_id: null,
      prospect_phone: null,
      prospect_email: null,
      quote_session_id: null,
      customer_id: null,
      confirmed_email_customer_id: null,
      resolution_method: null,
      resolution_confidence: null,
      awaiting_email_disambiguation: false,
    },
    autosync: {
      last_full_sync_completed_at: new Date().toISOString(),
      lock_holder_id: null,
      lock_acquired_at: null,
      last_run_status: "ok",
    },
  });
  const r = await getBookingReadiness(supabase, "c1");
  assertEquals(r.status, "identity_blocked");
  assertEquals(r.next_action, "ask_for_email");
  assertEquals(r.ready, false);
  assertEquals(r.identity.status, "unresolved");
});

// ---- Identity ---------------------------------------------------------------

Deno.test("readiness: ambiguous identity (awaiting_email_disambiguation) => ask_for_email", async () => {
  const supabase = makeSupabase({
    conversation: {
      id: "c-amb",
      property_id: "p1",
      prospect_phone: "+15550001111",
      prospect_email: null,
      quote_session_id: null,
      customer_id: "cust-a",
      confirmed_email_customer_id: null,
      resolution_method: "phone_multi",
      resolution_confidence: "low",
      awaiting_email_disambiguation: true,
      staff_takeover_at: null,
    },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-amb");
  assertEquals(r.status, "identity_blocked");
  assertEquals(r.identity.status, "ambiguous");
  assertEquals(r.identity.awaiting_email_disambiguation, true);
  assertEquals(r.next_action, "ask_for_email");
});

Deno.test("readiness: confirmed-email anchor treated as resolved", async () => {
  const supabase = makeSupabase({
    conversation: {
      id: "c-em",
      property_id: null,
      prospect_phone: null,
      prospect_email: null,
      quote_session_id: null,
      customer_id: null,
      confirmed_email_customer_id: "cust-e",
      resolution_method: null,
      resolution_confidence: null,
      awaiting_email_disambiguation: false,
      staff_takeover_at: null,
    },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-em");
  assertEquals(r.identity.status, "resolved");
  assertEquals(r.identity.confirmed_email_anchor, true);
  // Property is missing next → property_blocked, not identity.
  assertEquals(r.status, "property_blocked");
});

Deno.test("readiness: voice phone_exact alone is not booking identity", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation({
      channel: "voice",
      quote_session_id: null,
    }),
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "identity_blocked");
  assertEquals(r.identity.status, "unresolved");
  assertEquals(r.identity.customer_id_present, false);
  assertEquals(r.next_action, "ask_for_email");
});

Deno.test("readiness: conflicting linked and confirmed-email customers require staff", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation({
      channel: "voice",
      customer_id: "cust-stale",
      confirmed_email_customer_id: "cust-confirmed",
      quote_session_id: null,
    }),
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "identity_blocked");
  assertEquals(r.identity.status, "ambiguous");
  assertEquals(r.identity.customer_id_present, false);
  assertEquals(r.identity.failure_reason, "customer_identity_conflict");
  assertEquals(r.blockers[0]?.code, "identity_customer_conflict");
  assertEquals(r.next_action, "staff_intervention");
});

// ---- Property --------------------------------------------------------------

Deno.test("readiness: unauthorized property => property_blocked", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation({
      property_id: "prop-x",
      quote_session_id: null,
    }),
    // customer_properties returns nothing → customerOwnsProperty=false
    customerProperty: null,
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "property_blocked");
  assertEquals(r.property.selected, true);
  assertEquals(r.property.authorized, false);
  assertEquals(r.next_action, "select_property");
});

// ---- Quote session ---------------------------------------------------------

Deno.test("readiness: no quote session bound => quote_incomplete lists 'services'", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation({ quote_session_id: null }),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.quote.quote_session_present, false);
  assertEquals(r.status, "quote_incomplete");
  assertEquals(r.quote.missing_fields.includes("services"), true);
  assertEquals(r.next_action, "collect_quote_inputs");
});

Deno.test("readiness: quote session missing sqft => quote_incomplete surfaces missing_fields", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1",
      channel: "sms",
      conversation_ids: ["c-resolved"],
      fields: { services: ["gutter_cleaning"] }, // no address/sqft/stories
      field_status: {},
      required_remaining: ["address", "squareFootage", "stories"],
      quote_status: "none",
      booking_ready: false,
      phone_e164: "+15551112222",
      email_normalized: null,
    },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "quote_incomplete");
  assertEquals(r.quote.missing_fields.length > 0, true);
  assertEquals(r.next_action, "collect_quote_inputs");
});

// ---- Pricing ---------------------------------------------------------------

Deno.test("readiness: no canonical quote cached => pricing_blocked (staff_intervention)", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1",
      channel: "sms",
      conversation_ids: ["c-resolved"],
      fields: {
        services: ["gutter_cleaning"],
        address: "720 Parkland Dr",
        squareFootage: 2400,
        stories: 2,
        // no lastQuoteResult -> pricing engine has never run
      },
      field_status: {},
      required_remaining: [],
      quote_status: "none",
      booking_ready: false,
    },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "pricing_blocked");
  assertEquals(r.quote.canonical_total, null);
  assertEquals(r.next_action, "staff_intervention");
});

Deno.test("readiness: manual_review_required flag surfaces manual_review", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1",
      channel: "sms",
      conversation_ids: ["c-resolved"],
      fields: {
        services: ["roof_wash"],
        address: "1 Test Ln",
        squareFootage: 3000,
        stories: 2,
        lastQuoteResult: {
          status: "manual_review_required",
          total: 899,
          engineVersion: "1.0.0",
          ruleVersion: 1,
          estimatedDurationMinutes: 240,
          manualReviewReasons: ["steep_pitch_over_9_12"],
        },
      },
      field_status: {},
      required_remaining: [],
      quote_status: "manual_review",
      booking_ready: false,
    },
    pricingConfig: { id: "default", pricing: {} }, // best-effort
    pricingVersion: { rule_version: 1 },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  // Pricing may still be blocked in this fake if loadPricing can't parse the
  // fake row; the important assertion is that manual_review is at least
  // reported truthfully on the quote result.
  assertEquals(r.quote.manual_review_required, true);
  assertEquals(r.quote.manual_review_reasons[0], "steep_pitch_over_9_12");
});

// ---- Schedule --------------------------------------------------------------

Deno.test("readiness: missing autosync config => system_blocked wins over identity", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    // no autosync row
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "system_blocked");
  assertEquals(r.schedule.readable, false);
  assertEquals(r.next_action, "staff_intervention");
});

// ---- Model-injection contract & read-only contract -------------------------

Deno.test("readiness: signature takes ONLY conversationId (no model-supplied IDs)", () => {
  // The optional third argument is server-derived organization authority and
  // has a default, so model-facing arity remains exactly two.
  assertEquals(getBookingReadiness.length, 2);
});

Deno.test("readiness: expected organization rejects cross-tenant conversation", async () => {
  const expectedOrganizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const supabase = makeSupabase({
    conversation: resolvedConversation({
      organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(
    supabase,
    "c-resolved",
    expectedOrganizationId,
  );
  assertEquals(r.ready, false);
  assertEquals(r.status, "system_blocked");
  assertEquals(r.next_action, "staff_intervention");
  assertEquals(r.blockers[0]?.code, "organization_context_unavailable");
});

Deno.test("readiness: PURE read — no inserts or updates against any table", async () => {
  const writeSpy = { inserts: 0, updates: 0 };
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1",
      channel: "sms",
      conversation_ids: ["c-resolved"],
      fields: {
        services: ["gutter_cleaning"],
        address: "1 Test",
        squareFootage: 2400,
        stories: 2,
      },
      field_status: {},
      required_remaining: [],
      quote_status: "none",
      booking_ready: false,
    },
    autosync: freshAutosync(),
    writeSpy,
  });
  await getBookingReadiness(supabase, "c-resolved");
  assertEquals(writeSpy.inserts, 0);
  assertEquals(writeSpy.updates, 0);
});

Deno.test("readiness: unreadable conversation => system_blocked path via schedule (autosync missing)", async () => {
  // No autosync row -> config_unavailable -> system_blocked wins over identity.
  const supabase = makeSupabase({
    conversation: {
      id: "c2",
      property_id: null,
      prospect_phone: null,
      prospect_email: null,
      customer_id: null,
      confirmed_email_customer_id: null,
      resolution_method: null,
      resolution_confidence: null,
      awaiting_email_disambiguation: false,
    },
  });
  const r = await getBookingReadiness(supabase, "c2");
  assertEquals(r.status, "system_blocked");
  assertEquals(r.next_action, "staff_intervention");
  assertEquals(r.schedule.readable, false);
});

Deno.test("readiness: resolved identity, no property => property_blocked / select_property", async () => {
  const supabase = makeSupabase({
    conversation: {
      id: "c3",
      property_id: null,
      prospect_phone: null,
      prospect_email: null,
      customer_id: "cust-1",
      confirmed_email_customer_id: null,
      resolution_method: "phone_exact",
      resolution_confidence: "high",
      awaiting_email_disambiguation: false,
    },
    autosync: {
      last_full_sync_completed_at: new Date().toISOString(),
      lock_holder_id: null,
      lock_acquired_at: null,
      last_run_status: "ok",
    },
  });
  const r = await getBookingReadiness(supabase, "c3");
  assertEquals(r.status, "property_blocked");
  assertEquals(r.next_action, "select_property");
  assertEquals(r.identity.status, "resolved");
});

// ---- Inputs freshness ------------------------------------------------------

import { sessionInputsKey } from "./quoteSession.ts";

const bookableFields = () => ({
  services: ["gutter_cleaning"],
  address: "720 Parkland Dr",
  email: "customer@example.com",
  squareFootage: 2400,
  stories: 2,
});

function canonicalQuoteSession(
  fields: Record<string, unknown>,
  quoteOverrides: Record<string, unknown> = {},
  organizationId: string | null = null,
) {
  const quote = {
    status: "firm",
    total: 349,
    engineVersion: "1.0.0",
    ruleVersion: 1,
    estimatedDurationMinutes: 120,
    durationSource: "authoritative_quote",
    inputsKey: sessionInputsKey(fields as any),
    ...quoteOverrides,
  };
  return {
    id: "qs-1",
    organization_id: organizationId,
    channel: "sms",
    conversation_ids: ["c-resolved"],
    fields: { ...fields, lastQuoteResult: quote },
    field_status: {},
    required_remaining: [],
    quote_status: quote.status === "manual_review_required"
      ? "manual_review"
      : "firm",
    booking_ready: false,
  };
}

function readyState(args: {
  fields?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  quoteOverrides?: Record<string, unknown>;
  organizationId?: string | null;
  readSpy?: string[];
} = {}): FakeState {
  const fields = args.fields ?? bookableFields();
  const organizationId = args.organizationId === undefined
    ? PUBLIC_BOOKING_ORGANIZATION_ID
    : args.organizationId;
  return {
    conversation: resolvedConversation({
      organization_id: organizationId,
      ...args.conversation,
    }),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: canonicalQuoteSession(
      fields,
      args.quoteOverrides,
      organizationId,
    ),
    pricingConfig: PRICING_ROWS,
    ruleVersion: 1,
    autosync: freshAutosync(),
    readSpy: args.readSpy,
  };
}

Deno.test("readiness: cached quote without inputsKey => pricing_blocked / quote_inputs_unverified", async () => {
  const fields = bookableFields();
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1",
      channel: "sms",
      conversation_ids: ["c-resolved"],
      fields: {
        ...fields,
        lastQuoteResult: {
          status: "firm",
          total: 349,
          engineVersion: "1.0.0",
          ruleVersion: 1,
          estimatedDurationMinutes: 120,
          // NOTE: no inputsKey
        },
      },
      field_status: {},
      required_remaining: [],
      quote_status: "firm",
      booking_ready: false,
    },
    pricingConfig: { id: "default", pricing: {} },
    pricingVersion: { rule_version: 1 },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "pricing_blocked");
  assertEquals(r.quote.inputs_key_present, false);
  assertEquals(r.quote.inputs_current, false);
  assertEquals(r.quote.canonical_total, null);
  assertEquals(r.duration.resolved, false);
  assertEquals(r.blockers[0].code, "quote_inputs_unverified");
  assertEquals(r.next_action, "recalculate_quote");
});

Deno.test("readiness: cached quote with drifted inputsKey => pricing_blocked / quote_inputs_changed", async () => {
  const fields = bookableFields();
  const staleFields = { ...fields, squareFootage: 1800 };
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1",
      channel: "sms",
      conversation_ids: ["c-resolved"],
      fields: {
        ...fields,
        lastQuoteResult: {
          status: "firm",
          total: 299,
          engineVersion: "1.0.0",
          ruleVersion: 1,
          estimatedDurationMinutes: 90,
          inputsKey: sessionInputsKey(staleFields as any),
        },
      },
      field_status: {},
      required_remaining: [],
      quote_status: "firm",
      booking_ready: false,
    },
    pricingConfig: { id: "default", pricing: {} },
    pricingVersion: { rule_version: 1 },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.status, "pricing_blocked");
  assertEquals(r.quote.inputs_key_present, true);
  assertEquals(r.quote.inputs_current, false);
  assertEquals(r.quote.canonical_total, null);
  assertEquals(r.duration.resolved, false);
  assertEquals(r.blockers[0].code, "quote_inputs_changed");
  assertEquals(r.next_action, "recalculate_quote");
});

Deno.test("readiness: cached quote with matching inputsKey exposes canonical total + duration", async () => {
  const fields = bookableFields();
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1",
      channel: "sms",
      conversation_ids: ["c-resolved"],
      fields: {
        ...fields,
        lastQuoteResult: {
          status: "firm",
          total: 349,
          engineVersion: "1.0.0",
          ruleVersion: 1,
          estimatedDurationMinutes: 120,
          inputsKey: sessionInputsKey(fields as any),
        },
      },
      field_status: {},
      required_remaining: [],
      quote_status: "firm",
      booking_ready: false,
    },
    pricingConfig: { id: "default", pricing: {} },
    pricingVersion: { rule_version: 1 },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-resolved");
  assertEquals(r.quote.inputs_key_present, true);
  assertEquals(r.quote.inputs_current, true);
  // canonical total surfaces only when pricingCurrent aligns as well; the fake
  // pricing loader may still block the "ready" path, but inputs_current must
  // be independently true and the blocker (if any) must NOT be an inputs-drift
  // code.
  for (const b of r.blockers) {
    if (
      b.code === "quote_inputs_changed" || b.code === "quote_inputs_unverified"
    ) {
      throw new Error(`unexpected inputs-drift blocker: ${b.code}`);
    }
  }
});

// ---- Canonical post-price requirements -----------------------------------

Deno.test("readiness: canonical delivery email is required after pricing", async () => {
  const { email: _email, ...fields } = bookableFields();
  const r = await getBookingReadiness(
    makeSupabase(readyState({ fields })),
    "c-resolved",
  );

  assertEquals(r.status, "delivery_blocked");
  assertEquals(r.ready, false);
  assertEquals(r.next_action, "ask_for_email");
  assertEquals(r.quote.delivery_requirements_complete, false);
  assertEquals(r.quote.delivery_missing_fields, ["contact_email"]);
  assertEquals(r.blockers[0]?.code, "delivery_contact_email_missing");
});

Deno.test("readiness: canonical booking address is required after pricing", async () => {
  const { address: _address, ...fields } = bookableFields();
  const r = await getBookingReadiness(
    makeSupabase(readyState({ fields })),
    "c-resolved",
  );

  assertEquals(r.status, "booking_blocked");
  assertEquals(r.ready, false);
  assertEquals(r.next_action, "collect_booking_details");
  assertEquals(r.quote.booking_requirements_complete, false);
  assertEquals(r.quote.booking_missing_fields, ["address"]);
  assertEquals(r.blockers[0]?.code, "booking_address_missing");
});

Deno.test("readiness: quote-session eligibility cannot replace authoritative conversation eligibility", async () => {
  const fields = {
    ...bookableFields(),
    serviceAreaStatus: "eligible",
  };
  const r = await getBookingReadiness(
    makeSupabase(readyState({
      fields,
      conversation: { service_area_status: "pending_confirmation" },
    })),
    "c-resolved",
  );

  assertEquals(r.status, "booking_blocked");
  assertEquals(r.next_action, "verify_service_area");
  assertEquals(r.quote.booking_missing_fields, ["serviceAreaStatus"]);
  assertEquals(r.service_area, {
    status: "pending_confirmation",
    source: "conversation",
    eligible: false,
  });
  assertEquals(r.blockers[0]?.code, "service_area_not_eligible");
});

Deno.test("readiness: authoritative conversation eligibility satisfies the canonical booking requirement", async () => {
  const fields = {
    ...bookableFields(),
    serviceAreaStatus: "ineligible",
  };
  const r = await getBookingReadiness(
    makeSupabase(readyState({
      fields,
      conversation: { service_area_status: "eligible" },
    })),
    "c-resolved",
  );

  assertEquals(r.status, "ready");
  assertEquals(r.ready, true);
  assertEquals(r.next_action, "show_availability");
  assertEquals(r.quote.delivery_requirements_complete, true);
  assertEquals(r.quote.booking_requirements_complete, true);
  assertEquals(r.service_area, {
    status: "eligible",
    source: "conversation",
    eligible: true,
  });
});

Deno.test("readiness: mixed manual-review quote exposes only canonical bookable service keys", async () => {
  const r = await getBookingReadiness(
    makeSupabase(readyState({
      quoteOverrides: {
        status: "manual_review_required",
        manualReviewReasons: ["separate_service_requires_review"],
        bookableServiceKeys: ["gutter_cleaning"],
      },
    })),
    "c-resolved",
  );

  assertEquals(r.status, "ready");
  assertEquals(r.ready, true);
  assertEquals(r.quote.manual_review_required, true);
  assertEquals(r.quote.bookable_portion_present, true);
  assertEquals(r.quote.bookable_service_keys, ["gutter_cleaning"]);
  assertEquals(r.quote.final_disposition, "manual_review");
});

Deno.test("readiness: manual-review quote without canonical bookable keys remains blocked", async () => {
  const r = await getBookingReadiness(
    makeSupabase(readyState({
      quoteOverrides: {
        status: "manual_review_required",
        manualReviewReasons: ["service_requires_review"],
        bookableServiceKeys: [],
      },
    })),
    "c-resolved",
  );

  assertEquals(r.status, "manual_review");
  assertEquals(r.ready, false);
  assertEquals(r.next_action, "send_for_manual_review");
  assertEquals(r.quote.bookable_portion_present, false);
});

Deno.test("readiness: explicit non-DFW authority cannot inherit bounded global pricing", async () => {
  const nonDfwOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const readSpy: string[] = [];
  const supabase = makeSupabase(readyState({
    organizationId: nonDfwOrganizationId,
    readSpy,
  }));
  const r = await getBookingReadiness(
    supabase,
    "c-resolved",
    nonDfwOrganizationId,
  );

  assertEquals(r.status, "system_blocked");
  assertEquals(r.ready, false);
  assertEquals(r.next_action, "staff_intervention");
  assertEquals(r.blockers[0]?.code, "organization_pricing_unavailable");
  assertEquals(readSpy.includes("pricing_config"), false);
});

Deno.test("readiness: row-derived non-DFW authority cannot inherit bounded global pricing", async () => {
  const nonDfwOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const readSpy: string[] = [];
  const r = await getBookingReadiness(
    makeSupabase(readyState({
      organizationId: nonDfwOrganizationId,
      readSpy,
    })),
    "c-resolved",
  );

  assertEquals(r.status, "system_blocked");
  assertEquals(r.blockers[0]?.code, "organization_pricing_unavailable");
  assertEquals(readSpy.includes("pricing_config"), false);
});

Deno.test("readiness: legacy unscoped conversations fail before identity or pricing", async () => {
  const readSpy: string[] = [];
  const r = await getBookingReadiness(
    makeSupabase(readyState({ organizationId: null, readSpy })),
    "c-resolved",
  );

  assertEquals(r.status, "system_blocked");
  assertEquals(r.blockers[0]?.code, "organization_context_unavailable");
  assertEquals(r.identity.status, "unreadable");
  assertEquals(readSpy.includes("pricing_config"), false);
});

Deno.test("readiness: explicit public DFW authority may use the bounded pricing contract", async () => {
  const r = await getBookingReadiness(
    makeSupabase(readyState({
      organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
    })),
    "c-resolved",
    PUBLIC_BOOKING_ORGANIZATION_ID,
  );

  assertEquals(r.status, "ready");
  assertEquals(r.ready, true);
  assertEquals(r.quote.pricing_current, true);
});
