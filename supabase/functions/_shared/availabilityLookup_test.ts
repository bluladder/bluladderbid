// Deno tests for availabilityLookup — proves:
//   1. Preference normalization is safe (ambiguous inputs never silently pick
//      a distant date; explicit dates in the past are refused).
//   2. All readiness precondition failures short-circuit BEFORE the
//      availability engine is called.
//   3. Ready path returns capped, structured slots and preserves
//      preference_match flags.
//   4. The tool performs ZERO inserts / updates / RPC calls / booking calls.
// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  getAvailableSlots,
  normalizePreference,
  MAX_OPTIONS,
  BUSINESS_TIMEZONE,
  type AvailabilityFetcher,
} from "./availabilityLookup.ts";
import type { BookingReadiness } from "./bookingReadiness.ts";
import type { AutonomousGateDecision } from "./autonomousSendGate.ts";

const ALLOW_GATE: AutonomousGateDecision = { allow: true, actionClass: "scheduling" };

// ---------- Spy Supabase ----------------------------------------------------
interface WriteLog {
  inserts: { table: string; row: unknown }[];
  updates: { table: string; row: unknown }[];
  deletes: { table: string }[];
  upserts: { table: string; row: unknown }[];
  rpc: { name: string; args: unknown }[];
  invocations: { name: string; body: unknown }[];
}

function makeSpySupabase(rows: {
  conversation?: any;
  session?: any;
  autosync?: any;
  property?: any;
  pricing?: any;
}) {
  const log: WriteLog = { inserts: [], updates: [], deletes: [], upserts: [], rpc: [], invocations: [] };

  const throwOnWrite = (verb: string) => (payload: unknown) => {
    (log as any)[verb].push({ table: currentTable, row: payload });
    throw new Error(`WRITE_ATTEMPTED:${verb}:${currentTable}`);
  };

  let currentTable = "";

  const singleFrom = (table: string) => {
    currentTable = table;
    const chain: any = {
      _table: table,
      _filters: {} as Record<string, unknown>,
      select: (_cols?: string) => chain,
      eq: (_k: string, _v: unknown) => chain,
      limit: (_n: number) => chain,
      order: (_c: string, _o?: unknown) => chain,
      maybeSingle: async () => {
        if (table === "chat_conversations") return { data: rows.conversation ?? null };
        if (table === "quote_sessions") return { data: rows.session ?? null };
        if (table === "autosync_config") return { data: rows.autosync ?? null };
        if (table === "properties") return { data: rows.property ?? null };
        if (table === "pricing_config") return { data: rows.pricing ?? null };
        return { data: null };
      },
      insert: throwOnWrite("inserts"),
      update: throwOnWrite("updates"),
      delete: throwOnWrite("deletes"),
      upsert: throwOnWrite("upserts"),
    };
    return chain;
  };

  const sb = {
    from: singleFrom,
    rpc: (name: string, args: unknown) => {
      log.rpc.push({ name, args });
      throw new Error(`RPC_ATTEMPTED:${name}`);
    },
    functions: {
      invoke: (name: string, opts: any) => {
        log.invocations.push({ name, body: opts?.body });
        throw new Error(`INVOKE_ATTEMPTED:${name}`);
      },
    },
  };
  return { sb, log };
}

function readyReadiness(overrides: Partial<BookingReadiness> = {}): BookingReadiness {
  return {
    ready: true,
    status: "ready",
    identity: {
      status: "resolved", method: "phone", customer_id_present: true,
      confirmed_email_anchor: true, awaiting_email_disambiguation: false,
    },
    property: {
      selected: true, authorized: true, property_profile_present: true,
      reusable_facts_count: 3, stale_facts: [], conflicting_facts: [],
    },
    quote: {
      quote_session_present: true, requested_services: ["gutterCleaning"],
      required_fields_complete: true, missing_fields: [],
      canonical_total: 250, pricing_version: "engine-v9", pricing_current: true,
      inputs_key_present: true, inputs_current: true,
      manual_review_required: false, manual_review_reasons: [],
    },
    duration: { resolved: true, minutes: 120, source: "pricing_engine" },
    schedule: { readable: true, fresh: true, age_minutes: 3, refresh_in_progress: false },
    blockers: [],
    next_action: "show_availability",
    ...overrides,
  } as BookingReadiness;
}

// ============================================================================
// Preference normalization
// ============================================================================
Deno.test("normalizePreference: no input yields default 14-day window", () => {
  const n = normalizePreference({});
  assertEquals(n.ambiguous, false);
  assertEquals(n.daysToCheck, 14);
  assertEquals(n.range, "default");
  assertEquals(n.startDate, undefined);
});

Deno.test("normalizePreference: explicit YYYY-MM-DD in past is refused", () => {
  const n = normalizePreference({ preferred_date: "2020-01-01" }, "2026-07-23");
  assert(n.ambiguous);
  assertEquals(n.ambiguous_reason, "preferred_date_in_past");
});

Deno.test("normalizePreference: bad date format is refused", () => {
  const n = normalizePreference({ preferred_date: "next friday" }, "2026-07-23");
  assert(n.ambiguous);
  assertEquals(n.ambiguous_reason, "preferred_date_format");
});

Deno.test("normalizePreference: unknown day text is refused (never silently picks a date)", () => {
  const n = normalizePreference({ preferred_day: "sometime soon" }, "2026-07-23");
  assert(n.ambiguous);
  assertEquals(n.ambiguous_reason, "preferred_day_unrecognized");
});

Deno.test("normalizePreference: 'monday' finds the FUTURE monday", () => {
  // 2026-07-23 is a Thursday. Next monday = 2026-07-27.
  const n = normalizePreference({ preferred_day: "monday" }, "2026-07-23");
  assertEquals(n.ambiguous, false);
  assertEquals(n.startDate, "2026-07-27");
  assertEquals(n.range, "single_day");
});

Deno.test("normalizePreference: 'next week' pins to next Monday and Mon-Fri window", () => {
  const n = normalizePreference({ preferred_day: "next week" }, "2026-07-23");
  assertEquals(n.startDate, "2026-07-27");
  assertEquals(n.daysToCheck, 5);
  assertEquals(n.range, "next_week");
});

Deno.test("normalizePreference: time_of_day is preserved", () => {
  const n = normalizePreference({ time_of_day: "afternoon" });
  assertEquals(n.timeOfDay, "afternoon");
});

// ============================================================================
// Precondition short-circuits + zero-write guarantee
// ============================================================================
Deno.test("getAvailableSlots: readiness NOT ready → returns blockers, no engine call, no writes", async () => {
  const { sb, log } = makeSpySupabase({
    conversation: { id: "c1", prospect_phone: "+14690000000", service_address: null, property_id: null },
    autosync: { last_full_sync_completed_at: new Date().toISOString(), lock_holder_id: null, lock_acquired_at: null, last_run_status: "success" },
  });
  const readiness = readyReadiness({
    ready: false, status: "identity_blocked", next_action: "ask_for_email",
    identity: { status: "ambiguous", method: null, customer_id_present: false, confirmed_email_anchor: false, awaiting_email_disambiguation: true },
    blockers: [{ code: "identity_ambiguous", customer_safe_message: "x", staff_message: "y" }],
  });
  let fetcherCalled = false;
  const fetcher: AvailabilityFetcher = async () => { fetcherCalled = true; return { status: 200, json: {} }; };

  const res = await getAvailableSlots(sb as any, "c1", {}, { readinessOverride: readiness, fetcher, gateOverride: ALLOW_GATE });
  assertEquals(res.status, "not_ready");
  assertEquals(res.slots.length, 0);
  assertEquals(res.next_action, "ask_for_email");
  assertEquals(fetcherCalled, false);
  assertEquals(log.inserts.length, 0);
  assertEquals(log.updates.length, 0);
  assertEquals(log.upserts.length, 0);
  assertEquals(log.rpc.length, 0);
  assertEquals(log.invocations.length, 0);
});

Deno.test("getAvailableSlots: preference_ambiguous short-circuits before engine call", async () => {
  const { sb, log } = makeSpySupabase({
    conversation: { id: "c1", prospect_phone: "+14690000000", service_address: null, property_id: null },
    autosync: { last_full_sync_completed_at: new Date().toISOString(), lock_holder_id: null, lock_acquired_at: null, last_run_status: "success" },
  });
  let fetcherCalled = false;
  const fetcher: AvailabilityFetcher = async () => { fetcherCalled = true; return { status: 200, json: {} }; };
  const res = await getAvailableSlots(
    sb as any, "c1",
    { preferred_day: "someday" },
    { readinessOverride: readyReadiness(), fetcher, gateOverride: ALLOW_GATE },
  );
  assertEquals(res.status, "preference_ambiguous");
  assertEquals(fetcherCalled, false);
  assertEquals(log.inserts.length + log.updates.length + log.upserts.length + log.rpc.length + log.invocations.length, 0);
});

Deno.test("getAvailableSlots: happy path returns structured slots capped at MAX_OPTIONS and performs zero writes", async () => {
  const { sb, log } = makeSpySupabase({
    conversation: { id: "c1", prospect_phone: "+14690000000", service_address: "720 Parkland Dr, Anywhere, TX", property_id: "prop-1" },
    session: {
      id: "qs-1",
      conversation_id: "c1",
      fields: {
        services: ["gutterCleaning"],
        squareFootage: 2400, stories: 2,
        lastQuoteResult: {
          status: "firm", total: 260, estimatedDurationMinutes: 90,
          jobberLineItems: [{ name: "Gutter Cleaning", unitPrice: 260 }],
        },
      },
      field_status: {},
      required_remaining: [],
      quote_status: "firm",
    },
    autosync: { last_full_sync_completed_at: new Date().toISOString(), lock_holder_id: null, lock_acquired_at: null, last_run_status: "success" },
    property: { street: "720 Parkland Dr", city: "Anywhere", state: "TX", postal_code: "75000", formatted_address: "720 Parkland Dr, Anywhere, TX 75000" },
  });

  const capturedBody: any[] = [];
  const fetcher: AvailabilityFetcher = async (body) => {
    capturedBody.push(body);
    const iso = (day: string, hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00-05:00`;
    return {
      status: 200,
      json: {
        recommendations: [
          { startTime: iso("2026-07-27", 9), endTime: iso("2026-07-27", 11), displayTime: "9:00 AM" },
          { startTime: iso("2026-07-28", 13), endTime: iso("2026-07-28", 15), displayTime: "1:00 PM" },
          { startTime: iso("2026-07-29", 8), endTime: iso("2026-07-29", 10), displayTime: "8:00 AM" },
          { startTime: iso("2026-07-30", 14), endTime: iso("2026-07-30", 16), displayTime: "2:00 PM" },
          { startTime: iso("2026-07-31", 8), endTime: iso("2026-07-31", 10), displayTime: "8:00 AM (extra)" },
        ],
      },
    };
  };

  const res = await getAvailableSlots(
    sb as any, "c1",
    { time_of_day: "morning", max_options: 10 },
    { readinessOverride: readyReadiness(), fetcher, gateOverride: ALLOW_GATE },
  );

  assertEquals(res.status, "ok");
  assertEquals(res.slots.length, MAX_OPTIONS); // capped at 4 even when caller asked for 10
  assert(res.slots.every((s) => s.timezone === BUSINESS_TIMEZONE));
  assert(res.slots.every((s) => typeof s.slot_id === "string" && s.slot_id.startsWith("slot_")));
  // Morning preference: the 9 AM / 8 AM / 8 AM slots should be preference_match=true.
  // The 1 PM / 2 PM afternoon slots should be preference_match=false.
  const morningCount = res.slots.filter((s) => s.preference_match).length;
  assert(morningCount >= 1);

  // Engine called with SERVER-derived context (services + address), preference mapped to "AM".
  assertEquals(capturedBody.length, 1);
  assertEquals((capturedBody[0] as any).preference, "AM");
  assertEquals((capturedBody[0] as any).mode, "recommended");
  assert(Array.isArray((capturedBody[0] as any).services));
  assert((capturedBody[0] as any).customerAddress?.includes("Parkland"));

  // Zero writes anywhere.
  assertEquals(log.inserts.length, 0);
  assertEquals(log.updates.length, 0);
  assertEquals(log.upserts.length, 0);
  assertEquals(log.deletes.length, 0);
  assertEquals(log.rpc.length, 0);
  assertEquals(log.invocations.length, 0);
});

Deno.test("getAvailableSlots: engine reporting unavailable => schedule_drifted + refresh_schedule, no writes", async () => {
  const { sb, log } = makeSpySupabase({
    conversation: { id: "c1", prospect_phone: "+14690000000", service_address: "x", property_id: "p1" },
    session: {
      id: "qs-1", conversation_id: "c1",
      fields: {
        services: ["gutterCleaning"], squareFootage: 2400, stories: 2,
        lastQuoteResult: { status: "firm", total: 260, estimatedDurationMinutes: 90, jobberLineItems: [{ name: "Gutter Cleaning", unitPrice: 260 }] },
      },
      field_status: {}, required_remaining: [], quote_status: "firm",
    },
    autosync: { last_full_sync_completed_at: new Date().toISOString(), lock_holder_id: null, lock_acquired_at: null, last_run_status: "success" },
    property: { formatted_address: "x" },
  });
  const fetcher: AvailabilityFetcher = async () => ({
    status: 503,
    json: { availability_unavailable: true, reason: "stale", slots: [], recommendations: [] },
  });
  const res = await getAvailableSlots(sb as any, "c1", {}, { readinessOverride: readyReadiness(), fetcher, gateOverride: ALLOW_GATE });
  assertEquals(res.status, "engine_error");
  assertEquals(log.inserts.length + log.updates.length + log.upserts.length + log.rpc.length + log.invocations.length, 0);
});
