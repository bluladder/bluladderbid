// Phase 6B.1 — scoped tests for the failure-class stamping matrix and the
// customer/reconciliation claim source parameter. Uses the same in-memory
// stub as executeSmsBooking_test.ts.
// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { executeSmsBooking, type BookingCreator } from "./executeSmsBooking.ts";

type Row = Record<string, any>;

function makeStub(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const k of Object.keys(seed)) tables[k] = seed[k].map((r) => ({ ...r }));
  const rpcLog: { name: string; args: any }[] = [];
  function query(table: string) {
    let filter: [string, any][] = [];
    const api: any = {
      select(_c?: string) { return api; },
      eq(c: string, v: any) { filter.push([c, v]); return api; },
      limit(_n: number) { return api; },
      async maybeSingle() {
        const rows = (tables[table] ?? []).filter((r) => filter.every(([c, v]) => r[c] === v));
        return { data: rows[0] ?? null, error: null };
      },
      insert(row: Row) {
        const newRow: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
        if (table === "sms_booking_confirmations" && newRow.idempotency_key) {
          const clash = (tables[table] ?? []).some((r) => r.idempotency_key === newRow.idempotency_key);
          if (clash) {
            return { select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "23505" } }) }) };
          }
        }
        tables[table] = tables[table] ?? [];
        tables[table].push(newRow);
        return { select: () => ({ maybeSingle: async () => ({ data: newRow, error: null }) }) };
      },
      update(patch: Row) {
        return {
          eq(c: string, v: any) {
            for (const r of (tables[table] ?? []).filter((r) => r[c] === v)) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return api;
  }
  const supabase: any = {
    from: (t: string) => query(t),
    rpc: async (name: string, args: any) => {
      rpcLog.push({ name, args });
      return { data: null, error: null };
    },
  };
  return { supabase, tables, rpcLog };
}

const NOW = new Date("2026-08-01T15:00:00Z");
const HOLD_EXPIRES = "2026-08-01T15:08:00Z";
const START = "2026-08-04T14:00:00Z";
const END = "2026-08-04T16:00:00Z";

function seedPresentation(over: Partial<Row> = {}): Row {
  return {
    id: "pres-1",
    conversation_id: "conv-1",
    quote_session_id: "sess-1",
    property_id: "prop-1",
    resolved_customer_id: "cust-1",
    inputs_key: "ikey-abc",
    pricing_version: "v1",
    status: "active",
    hold_status: "held",
    hold_group_id: "grp-1",
    hold_expires_at: HOLD_EXPIRES,
    held_start_at: START,
    held_end_at: END,
    held_crew_ids: ["tech-a"],
    selected_start_at: START,
    selected_end_at: END,
    options: [{ option_number: 1, slot_id: "s1", start_at: START, end_at: END, timezone: "America/Chicago" }],
    ...over,
  };
}
function seedSession(): Row {
  return {
    id: "sess-1",
    fields: {
      lastQuoteResult: {
        total: 260, subtotal: 260, discountAmount: 0,
        estimatedDurationMinutes: 90, homeDetails: { sqft: 2400 },
        additionalServices: {}, promotion: null,
        jobberLineItems: [{ name: "Gutter Cleaning", unitPrice: 260 }],
        inputsKey: "ikey-abc",
      },
    },
  };
}
function seedCustomer(): Row {
  return { id: "cust-1", first_name: "Ada", last_name: "Lovelace", email: "a@b.com", phone: "+14695550100" };
}
function seedProperty(): Row {
  return { id: "prop-1", street: "1 A", city: "B", state: "TX", postal_code: "75201", formatted_address: "1 A, B, TX 75201" };
}
const readyFetcher = () => async () => ({
  status: "ready",
  blockers: [],
  quote: { inputs_key: "ikey-abc", inputs_current: true, pricing_version: "v1" },
  customer: { id: "cust-1" },
});

// ---------------------------------------------------------------------------
// Failure-class matrix
// ---------------------------------------------------------------------------

Deno.test("6B.1 — readiness_not_ready → failure_class=pre_claim_drift on ledger", async () => {
  const { supabase, tables } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()], customers: [seedCustomer()], properties: [seedProperty()],
  });
  const res = await executeSmsBooking(supabase, { presentationId: "pres-1" }, {
    bookingCreator: async () => ({ ok: true, bookingId: "x" }),
    readinessFetcher: async () => ({ status: "blocked", blockers: [{ code: "identity_ambiguous" }] }),
    now: () => NOW,
  });
  assertEquals(res.status, "failed_recoverable");
  assertEquals(tables.sms_booking_confirmations[0].failure_class, "pre_claim_drift");
});

Deno.test("6B.1 — inputs_key drift → failure_class=pre_claim_drift", async () => {
  const { supabase, tables } = makeStub({
    sms_availability_presentations: [seedPresentation({ inputs_key: "STALE" })],
    quote_sessions: [seedSession()], customers: [seedCustomer()], properties: [seedProperty()],
  });
  const res = await executeSmsBooking(supabase, { presentationId: "pres-1" }, {
    bookingCreator: async () => ({ ok: true, bookingId: "x" }),
    readinessFetcher: readyFetcher(), now: () => NOW,
  });
  assertEquals(res.error_code, "drift_detected");
  assertEquals(tables.sms_booking_confirmations[0].failure_class, "pre_claim_drift");
});

Deno.test("6B.1 — missing quote result → input_missing on recoverable RPC", async () => {
  const { supabase, rpcLog } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [{ id: "sess-1", fields: {} }],
    customers: [seedCustomer()], properties: [seedProperty()],
  });
  const res = await executeSmsBooking(supabase, { presentationId: "pres-1" }, {
    bookingCreator: async () => ({ ok: true, bookingId: "x" }),
    readinessFetcher: readyFetcher(), now: () => NOW,
  });
  assertEquals(res.error_code, "quote_result_missing");
  const call = rpcLog.find((r) => r.name === "mark_sms_booking_recoverable_failure");
  assert(call);
  assertEquals(call!.args.p_failure_class, "input_missing");
});

Deno.test("6B.1 — creator UNKNOWN outcome → external_outcome_unknown, hold preserved", async () => {
  const { supabase, rpcLog } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()], customers: [seedCustomer()], properties: [seedProperty()],
  });
  const res = await executeSmsBooking(supabase, { presentationId: "pres-1" }, {
    bookingCreator: async () => ({ ok: false, code: "unknown", detail: "timeout" }),
    readinessFetcher: readyFetcher(), now: () => NOW,
  });
  assertEquals(res.status, "failed_recoverable");
  assertEquals(res.preserve_customer_uncertainty, true);
  const call = rpcLog.find((r) => r.name === "mark_sms_booking_recoverable_failure");
  assertEquals(call!.args.p_failure_class, "external_outcome_unknown");
});

Deno.test("6B.1 — creator throws → external_outcome_unknown", async () => {
  const { supabase, rpcLog } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()], customers: [seedCustomer()], properties: [seedProperty()],
  });
  const res = await executeSmsBooking(supabase, { presentationId: "pres-1" }, {
    bookingCreator: async () => { throw new Error("ECONNRESET"); },
    readinessFetcher: readyFetcher(), now: () => NOW,
  });
  assertEquals(res.status, "failed_recoverable");
  const call = rpcLog.find((r) => r.name === "mark_sms_booking_recoverable_failure");
  assertEquals(call!.args.p_failure_class, "external_outcome_unknown");
});

Deno.test("6B.1 — verified rejection → verified_terminal_rejection on terminal RPC", async () => {
  const { supabase, rpcLog } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()], customers: [seedCustomer()], properties: [seedProperty()],
  });
  const res = await executeSmsBooking(supabase, { presentationId: "pres-1" }, {
    bookingCreator: async () => ({ ok: false, code: "rejected", detail: "no capacity" }),
    readinessFetcher: readyFetcher(), now: () => NOW,
  });
  assertEquals(res.status, "failed_terminal");
  const call = rpcLog.find((r) => r.name === "mark_sms_booking_terminal_failure");
  assertEquals(call!.args.p_failure_class, "verified_terminal_rejection");
});

// ---------------------------------------------------------------------------
// Claim source parameter
// ---------------------------------------------------------------------------

Deno.test("6B.1 — executor always passes p_claim_source='customer' on YES", async () => {
  const { supabase, rpcLog } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()], customers: [seedCustomer()], properties: [seedProperty()],
  });
  const creator: BookingCreator = async () => ({ ok: true, bookingId: "b1", referenceNumber: "R" });
  await executeSmsBooking(supabase, { presentationId: "pres-1" }, {
    bookingCreator: creator, readinessFetcher: readyFetcher(), now: () => NOW,
  });
  const claim = rpcLog.find((r) => r.name === "claim_sms_booking_execution");
  assert(claim);
  assertEquals(claim!.args.p_claim_source, "customer");
});