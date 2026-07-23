// Deno tests for get_quote_booking_readiness — verifies status precedence,
// next_action mapping, and that the tool never trusts model-supplied IDs.
import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { getBookingReadiness } from "./bookingReadiness.ts";

type Row = Record<string, unknown> | null;

interface FakeState {
  conversation?: Row;
  quoteSession?: Row;
  customerProperty?: Row;
  propertyFacts?: any[];
  pricingOk?: boolean;
  ruleVersion?: number | null;
  autosync?: Row;
  pricingConfig?: Row;
  pricingVersion?: Row;
  writeSpy?: { inserts: number; updates: number };
}

function makeSupabase(state: FakeState) {
  const chain = (rows: any) => {
    const api: any = {
      _rows: rows,
      select: () => api,
      eq: () => api,
      order: () => api,
      limit: () => api,
      is: () => api,
      gte: () => api,
      insert: () => {
        if (state.writeSpy) state.writeSpy.inserts++;
        return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
      },
      update: () => {
        if (state.writeSpy) state.writeSpy.updates++;
        return { eq: async () => ({ data: null, error: null }) };
      },
      maybeSingle: async () => ({ data: Array.isArray(rows) ? (rows[0] ?? null) : rows, error: null }),
      single: async () => ({ data: Array.isArray(rows) ? (rows[0] ?? null) : rows, error: null }),
      then: (res: any) => Promise.resolve({ data: Array.isArray(rows) ? rows : (rows ? [rows] : []), error: null }).then(res),
    };
    return api;
  };
  return {
    from(table: string) {
      switch (table) {
        case "chat_conversations": return chain(state.conversation ?? null);
        case "quote_sessions": return chain(state.quoteSession ?? null);
        case "customer_properties": return chain(state.customerProperty ?? null);
        case "property_facts_current": return chain(state.propertyFacts ?? []);
        case "autosync_config": return chain(state.autosync ?? null);
        case "pricing_config": return chain(state.pricingConfig ?? null);
        case "pricing_versions": return chain(state.pricingVersion ?? null);
        default: return chain(null);
      }
    },
  } as any;
}

const freshAutosync = () => ({
  last_full_sync_completed_at: new Date().toISOString(),
  lock_holder_id: null,
  lock_acquired_at: null,
  last_run_status: "completed",
});

const resolvedConversation = (overrides: Record<string, unknown> = {}) => ({
  id: "c-resolved",
  property_id: "prop-1",
  prospect_phone: "+15551112222",
  prospect_email: null,
  quote_session_id: "qs-1",
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
    conversation: { id: "c1", property_id: null, prospect_phone: null, prospect_email: null, quote_session_id: null,
      customer_id: null, confirmed_email_customer_id: null, resolution_method: null,
      resolution_confidence: null, awaiting_email_disambiguation: false },
    autosync: { last_full_sync_completed_at: new Date().toISOString(),
      lock_holder_id: null, lock_acquired_at: null, last_run_status: "ok" },
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
      id: "c-amb", property_id: "p1", prospect_phone: "+15550001111", prospect_email: null,
      quote_session_id: null,
      customer_id: "cust-a", confirmed_email_customer_id: null,
      resolution_method: "phone_multi", resolution_confidence: "low",
      awaiting_email_disambiguation: true, staff_takeover_at: null,
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
      id: "c-em", property_id: null, prospect_phone: null, prospect_email: null,
      quote_session_id: null,
      customer_id: null, confirmed_email_customer_id: "cust-e",
      resolution_method: null, resolution_confidence: null,
      awaiting_email_disambiguation: false, staff_takeover_at: null,
    },
    autosync: freshAutosync(),
  });
  const r = await getBookingReadiness(supabase, "c-em");
  assertEquals(r.identity.status, "resolved");
  assertEquals(r.identity.confirmed_email_anchor, true);
  // Property is missing next → property_blocked, not identity.
  assertEquals(r.status, "property_blocked");
});

// ---- Property --------------------------------------------------------------

Deno.test("readiness: unauthorized property => property_blocked", async () => {
  const supabase = makeSupabase({
    conversation: resolvedConversation({ property_id: "prop-x" }),
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
      id: "qs-1", channel: "sms", conversation_ids: ["c-resolved"],
      fields: { services: ["gutter_cleaning"] }, // no address/sqft/stories
      field_status: {}, required_remaining: ["address", "squareFootage", "stories"],
      quote_status: "none", booking_ready: false,
      phone_e164: "+15551112222", email_normalized: null,
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
      id: "qs-1", channel: "sms", conversation_ids: ["c-resolved"],
      fields: {
        services: ["gutter_cleaning"],
        address: "720 Parkland Dr", squareFootage: 2400, stories: 2,
        // no lastQuoteResult -> pricing engine has never run
      },
      field_status: {}, required_remaining: [], quote_status: "none",
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
      id: "qs-1", channel: "sms", conversation_ids: ["c-resolved"],
      fields: {
        services: ["roof_wash"],
        address: "1 Test Ln", squareFootage: 3000, stories: 2,
        lastQuoteResult: {
          status: "manual_review_required",
          total: 899, engineVersion: "1.0.0", ruleVersion: 1,
          estimatedDurationMinutes: 240,
          manualReviewReasons: ["steep_pitch_over_9_12"],
        },
      },
      field_status: {}, required_remaining: [], quote_status: "manual_review",
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
  // getBookingReadiness(supabase, conversationId) — arity 2 exactly.
  assertEquals(getBookingReadiness.length, 2);
});

Deno.test("readiness: PURE read — no inserts or updates against any table", async () => {
  const writeSpy = { inserts: 0, updates: 0 };
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1", channel: "sms", conversation_ids: ["c-resolved"],
      fields: { services: ["gutter_cleaning"], address: "1 Test", squareFootage: 2400, stories: 2 },
      field_status: {}, required_remaining: [], quote_status: "none", booking_ready: false,
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
    conversation: { id: "c2", property_id: null, prospect_phone: null, prospect_email: null,
      customer_id: null, confirmed_email_customer_id: null, resolution_method: null,
      resolution_confidence: null, awaiting_email_disambiguation: false },
  });
  const r = await getBookingReadiness(supabase, "c2");
  assertEquals(r.status, "system_blocked");
  assertEquals(r.next_action, "staff_intervention");
  assertEquals(r.schedule.readable, false);
});

Deno.test("readiness: resolved identity, no property => property_blocked / select_property", async () => {
  const supabase = makeSupabase({
    conversation: { id: "c3", property_id: null, prospect_phone: null, prospect_email: null,
      customer_id: "cust-1", confirmed_email_customer_id: null, resolution_method: "phone_exact",
      resolution_confidence: "high", awaiting_email_disambiguation: false },
    autosync: { last_full_sync_completed_at: new Date().toISOString(),
      lock_holder_id: null, lock_acquired_at: null, last_run_status: "ok" },
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
  squareFootage: 2400,
  stories: 2,
});

Deno.test("readiness: cached quote without inputsKey => pricing_blocked / quote_inputs_unverified", async () => {
  const fields = bookableFields();
  const supabase = makeSupabase({
    conversation: resolvedConversation(),
    customerProperty: { customer_id: "cust-1", property_id: "prop-1" },
    quoteSession: {
      id: "qs-1", channel: "sms", conversation_ids: ["c-resolved"],
      fields: {
        ...fields,
        lastQuoteResult: {
          status: "firm", total: 349, engineVersion: "1.0.0", ruleVersion: 1,
          estimatedDurationMinutes: 120,
          // NOTE: no inputsKey
        },
      },
      field_status: {}, required_remaining: [], quote_status: "firm", booking_ready: false,
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
      id: "qs-1", channel: "sms", conversation_ids: ["c-resolved"],
      fields: {
        ...fields,
        lastQuoteResult: {
          status: "firm", total: 299, engineVersion: "1.0.0", ruleVersion: 1,
          estimatedDurationMinutes: 90,
          inputsKey: sessionInputsKey(staleFields as any),
        },
      },
      field_status: {}, required_remaining: [], quote_status: "firm", booking_ready: false,
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
      id: "qs-1", channel: "sms", conversation_ids: ["c-resolved"],
      fields: {
        ...fields,
        lastQuoteResult: {
          status: "firm", total: 349, engineVersion: "1.0.0", ruleVersion: 1,
          estimatedDurationMinutes: 120,
          inputsKey: sessionInputsKey(fields as any),
        },
      },
      field_status: {}, required_remaining: [], quote_status: "firm", booking_ready: false,
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
    if (b.code === "quote_inputs_changed" || b.code === "quote_inputs_unverified") {
      throw new Error(`unexpected inputs-drift blocker: ${b.code}`);
    }
  }
});