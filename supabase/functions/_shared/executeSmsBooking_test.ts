// Phase 6A executor tests. Verifies:
//   * presentation state gates block booking
//   * fresh readiness drift blocks booking (no ledger success)
//   * successful path releases the hold, writes ledger, marks presentation
//     consumed, returns booking + reference
//   * duplicate YES for the same presentation returns duplicate_confirmation
//     WITHOUT calling the booking creator a second time
//   * booking creator failure leaves the ledger in status='failed' and never
//     marks the presentation consumed
// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { executeSmsBooking, type BookingCreator } from "./executeSmsBooking.ts";

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase stub tailored to executeSmsBooking's read/write
// footprint.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeStub(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const k of Object.keys(seed)) tables[k] = seed[k].map((r) => ({ ...r }));
  const rpcLog: { name: string; args: any }[] = [];
  const writeLog: { op: string; table: string; row?: any; patch?: any; filter?: any }[] = [];

  function query(table: string) {
    let filter: [string, any][] = [];
    let selectMode = "*";
    const api: any = {
      select(cols?: string) {
        selectMode = cols ?? "*";
        return api;
      },
      eq(col: string, val: any) {
        filter.push([col, val]);
        return api;
      },
      async maybeSingle() {
        const rows = (tables[table] ?? []).filter((r) =>
          filter.every(([c, v]) => r[c] === v)
        );
        return { data: rows[0] ?? null, error: null };
      },
      insert(row: Row) {
        const newRow: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
        // Enforce unique idempotency_key for sms_booking_confirmations.
        if (table === "sms_booking_confirmations" && newRow.idempotency_key) {
          const clash = (tables[table] ?? []).some((r) =>
            r.idempotency_key === newRow.idempotency_key
          );
          if (clash) {
            return {
              select: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate key" },
                }),
              }),
            };
          }
        }
        tables[table] = tables[table] ?? [];
        tables[table].push(newRow);
        writeLog.push({ op: "insert", table, row: newRow });
        return {
          select: () => ({
            maybeSingle: async () => ({ data: newRow, error: null }),
          }),
        };
      },
      update(patch: Row) {
        return {
          eq(col: string, val: any) {
            const rows = (tables[table] ?? []).filter((r) => r[col] === val);
            for (const r of rows) Object.assign(r, patch);
            writeLog.push({ op: "update", table, patch, filter: { [col]: val } });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return api;
  }

  const supabase: any = {
    from: (table: string) => query(table),
    rpc: async (name: string, args: any) => {
      rpcLog.push({ name, args });
      if (name === "release_booking_slot") {
        // Nothing to simulate here — executeSmsBooking never reads the
        // reservation table.
        return { data: { ok: true }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { supabase, tables, rpcLog, writeLog };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-01T15:00:00Z");
const HOLD_EXPIRES = "2026-08-01T15:08:00Z"; // 8 min ahead of NOW
const START = "2026-08-04T14:00:00Z";
const END = "2026-08-04T16:00:00Z";

function seedPresentation(overrides: Partial<Row> = {}): Row {
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
    held_crew_ids: ["tech-a", "tech-b"],
    selected_start_at: START,
    selected_end_at: END,
    options: [{ option_number: 1, slot_id: "s1", start_at: START, end_at: END, timezone: "America/Chicago" }],
    ...overrides,
  };
}

function seedSession(): Row {
  return {
    id: "sess-1",
    fields: {
      squareFootage: 2400,
      services: ["gutterCleaning"],
      lastQuoteResult: {
        status: "firm",
        total: 260,
        subtotal: 260,
        discountAmount: 0,
        estimatedDurationMinutes: 90,
        homeDetails: { sqft: 2400 },
        additionalServices: {},
        promotion: null,
        jobberLineItems: [{ name: "Gutter Cleaning", unitPrice: 260 }],
        inputsKey: "ikey-abc",
      },
    },
  };
}

function seedCustomer(): Row {
  return { id: "cust-1", first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", phone: "+14695550100" };
}

function seedProperty(): Row {
  return {
    id: "prop-1",
    street: "123 Parkland Dr",
    city: "Dallas",
    state: "TX",
    postal_code: "75201",
    formatted_address: "123 Parkland Dr, Dallas, TX 75201",
  };
}

function readyFetcher(): any {
  return async () => ({
    status: "ready",
    blockers: [],
    quote: { inputs_key: "ikey-abc", inputs_current: true, pricing_version: "v1" },
  });
}

function successCreator(): BookingCreator {
  return async (_input) => ({
    ok: true,
    bookingId: "book-1",
    referenceNumber: "BL-24601",
    jobberJobId: "job-1",
    jobberVisitId: "visit-1",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("executeSmsBooking — presentation missing returns presentation_missing", async () => {
  const { supabase } = makeStub({});
  const res = await executeSmsBooking(
    supabase,
    { presentationId: "nope" },
    { bookingCreator: successCreator(), readinessFetcher: readyFetcher(), now: () => NOW },
  );
  assertEquals(res.ok, false);
  assertEquals(res.error_code, "presentation_missing");
});

Deno.test("executeSmsBooking — presentation not active is blocked", async () => {
  const { supabase } = makeStub({
    sms_availability_presentations: [seedPresentation({ status: "expired" })],
  });
  const res = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1" },
    { bookingCreator: successCreator(), readinessFetcher: readyFetcher(), now: () => NOW },
  );
  assertEquals(res.error_code, "presentation_not_active");
});

Deno.test("executeSmsBooking — expired hold is blocked before booking is called", async () => {
  let creatorCalled = 0;
  const { supabase } = makeStub({
    sms_availability_presentations: [
      seedPresentation({ hold_expires_at: "2026-08-01T14:00:00Z" }),
    ],
  });
  const res = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1" },
    {
      bookingCreator: async () => { creatorCalled++; return { ok: true, bookingId: "x" }; },
      readinessFetcher: readyFetcher(),
      now: () => NOW,
    },
  );
  assertEquals(res.error_code, "hold_missing_or_expired");
  assertEquals(creatorCalled, 0, "booking creator MUST NOT run when hold has expired");
});

Deno.test("executeSmsBooking — readiness drift fails without calling booking creator", async () => {
  let creatorCalled = 0;
  const { supabase, tables } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()],
    customers: [seedCustomer()],
    properties: [seedProperty()],
  });
  const res = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1" },
    {
      bookingCreator: async () => { creatorCalled++; return { ok: true, bookingId: "x" }; },
      readinessFetcher: async () => ({
        status: "blocked",
        blockers: [{ code: "identity_ambiguous" }],
      }),
      now: () => NOW,
    },
  );
  assertEquals(res.error_code, "readiness_not_ready");
  assertEquals(creatorCalled, 0);
  // Ledger row exists and is marked failed_recoverable with the
  // Phase 6B.1 `pre_claim_drift` classification. Customer YES may retry
  // this class once readiness clears.
  const ledger = tables.sms_booking_confirmations[0];
  assertEquals(ledger.status, "failed_recoverable");
  assertEquals(ledger.error_code, "readiness_not_ready");
  assertEquals(ledger.failure_class, "pre_claim_drift");
});

Deno.test("executeSmsBooking — happy path books; hold consumption + presentation status handled by commit RPC (stubbed here)", async () => {
  const { supabase, tables, rpcLog } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()],
    customers: [seedCustomer()],
    properties: [seedProperty()],
  });
  let payload: any = null;
  const res = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1", inboundSmsId: "in-1" },
    {
      bookingCreator: async (input) => {
        payload = input;
        return { ok: true, bookingId: "book-1", referenceNumber: "BL-24601", jobberJobId: "job-1", jobberVisitId: "visit-1" };
      },
      readinessFetcher: readyFetcher(),
      now: () => NOW,
    },
  );
  assertEquals(res.ok, true);
  assertEquals(res.status, "confirmed");
  assertEquals(res.booking_id, "book-1");
  assertEquals(res.reference_number, "BL-24601");
  // Booking creator received authoritative crew, address, quote total
  assertEquals(payload.technicianId, "tech-a");
  assertEquals(payload.teamTechnicianIds, ["tech-a", "tech-b"]);
  assertEquals(payload.customer.email, "ada@example.com");
  assertEquals(payload.customer.address, "123 Parkland Dr, Dallas, TX 75201");
  assertEquals(payload.total, 260);
  assertEquals(payload.scheduledStart, START);
  assertEquals(payload.scheduledEnd, END);
  // Phase 6A-corrected: creator receives the SAME idempotency key that
  // reserved the hold, so jobber-create-booking's reserve_booking_slot is
  // an idempotent match rather than a race against our own reservation.
  assertEquals(payload.idempotencyKey, "sms:pres-1:grp-1:conv-1:sess-1:no-slot");
  assertEquals(payload.sessionId, "pres-1");
  // Phase 6A-corrected: the hold is NOT released before the creator is
  // called. release_booking_slot must not appear in the rpc log.
  const releaseCall = rpcLog.find((r) => r.name === "release_booking_slot");
  assertEquals(releaseCall, undefined, "release_booking_slot must NOT be called on the success path");
  // Atomic hold consumption happens inside commit_sms_booking_success.
  const commitCall = rpcLog.find((r) => r.name === "commit_sms_booking_success");
  assert(commitCall, "commit_sms_booking_success must be called on success");
  // Executor stamps confirmation_pending on the ledger; the confirmation
  // SMS handler is what flips it to `confirmed`.
  const ledger = tables.sms_booking_confirmations[0];
  assertEquals(ledger.status, "confirmation_pending");
});

Deno.test("executeSmsBooking — duplicate YES does not call creator a second time", async () => {
  const { supabase, tables } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()],
    customers: [seedCustomer()],
    properties: [seedProperty()],
  });
  let creatorCalls = 0;
  const creator: BookingCreator = async () => {
    creatorCalls++;
    return { ok: true, bookingId: "book-1", referenceNumber: "BL-1" };
  };
  // First YES.
  const first = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1", inboundSmsId: "in-1" },
    { bookingCreator: creator, readinessFetcher: readyFetcher(), now: () => NOW },
  );
  assertEquals(first.status, "confirmed");
  // Second YES against the SAME presentation. Presentation is now consumed,
  // but the ledger idempotency key must still short-circuit even if we
  // re-seed as active.
  tables.sms_availability_presentations[0].status = "active";
  tables.sms_availability_presentations[0].hold_status = "held";
  const second = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1", inboundSmsId: "in-2" },
    { bookingCreator: creator, readinessFetcher: readyFetcher(), now: () => NOW },
  );
  assertEquals(second.status, "duplicate_confirmation");
  assertEquals(creatorCalls, 1, "booking creator must run exactly once");
});

Deno.test("executeSmsBooking — verified creator rejection routes through terminal-failure RPC with verified_terminal_rejection", async () => {
  const { supabase, rpcLog } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [seedSession()],
    customers: [seedCustomer()],
    properties: [seedProperty()],
  });
  const res = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1" },
    {
      bookingCreator: async () => ({ ok: false, code: "rejected", detail: "jobber_error" }),
      readinessFetcher: readyFetcher(),
      now: () => NOW,
    },
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, "failed_terminal");
  assertEquals(res.error_code, "booking_creator_rejected");
  const terminalCall = rpcLog.find((r) => r.name === "mark_sms_booking_terminal_failure");
  assert(terminalCall, "terminal failure RPC must be called");
  assertEquals(terminalCall!.args.p_failure_class, "verified_terminal_rejection");
  assertEquals(terminalCall!.args.p_error_code, "booking_creator_rejected");
});

Deno.test("executeSmsBooking — missing quote result fails without calling creator", async () => {
  const { supabase } = makeStub({
    sms_availability_presentations: [seedPresentation()],
    quote_sessions: [{ id: "sess-1", fields: {} }],
    customers: [seedCustomer()],
    properties: [seedProperty()],
  });
  let called = 0;
  const res = await executeSmsBooking(
    supabase,
    { presentationId: "pres-1" },
    {
      bookingCreator: async () => { called++; return { ok: true, bookingId: "x" }; },
      readinessFetcher: readyFetcher(),
      now: () => NOW,
    },
  );
  assertEquals(res.error_code, "quote_result_missing");
  assertEquals(called, 0);
});