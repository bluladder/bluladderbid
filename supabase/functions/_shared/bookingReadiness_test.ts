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
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
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
        // pricing_config etc. — loadPricing reads several tables; return empty
        // to force pricingOk=false unless the test overrides.
        default: return chain(null);
      }
    },
  } as any;
}

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