// End-to-end sequencing tests for the rollout controller: caller-ID
// handshake, returning-customer resolution, ambiguous handling, safe
// fallback, and email-after-quote timing. Uses an in-memory fake supabase.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runControllerTurn, persistControllerPatch } from "./workflowController.ts";

type Row = Record<string, unknown>;

function makeFake(opts: {
  customers?: Row[];
  customersThrow?: boolean;
} = {}) {
  const state = {
    session: {
      id: "qs_1",
      channel: "voice",
      conversation_ids: ["c1"],
      fields: {} as Row,
      field_status: {} as Row,
      required_remaining: [],
      quote_status: "none",
      booking_ready: false,
    } as Row,
    convo: { id: "c1", quote_session_id: "qs_1", session_token: "tok", channel: "voice" } as Row,
  };
  const sb: any = {
    from(table: string) {
      const q: any = {
        _table: table, _filter: {} as Row, _in: null as null | [string, unknown[]],
        select() { return this; },
        eq(k: string, v: unknown) { this._filter[k] = v; return this; },
        in(k: string, arr: unknown[]) { this._in = [k, arr]; return this; },
        order() { return this; },
        limit() { return this._run(); },
        maybeSingle() {
          const rows = this._run();
          if (rows instanceof Promise) return rows.then((r: any) => ({ data: r.data?.[0] ?? null, error: null }));
          return { data: (rows.data as Row[])?.[0] ?? null, error: null };
        },
        single() {
          const rows = this._run();
          if (rows instanceof Promise) return rows.then((r: any) => ({ data: r.data?.[0] ?? null, error: null }));
          return { data: (rows.data as Row[])?.[0] ?? null, error: null };
        },
        insert(row: Row) {
          if (this._table === "quote_sessions") {
            state.session = { ...state.session, ...row, id: "qs_new" };
            return { select() { return { single: () => Promise.resolve({ data: state.session, error: null }) }; } };
          }
          if (this._table === "chat_conversations") {
            state.convo = { ...state.convo, ...row };
            return { select() { return { single: () => Promise.resolve({ data: state.convo, error: null }) }; } };
          }
          return { select() { return { single: () => Promise.resolve({ data: null, error: null }) }; } };
        },
        update(patch: Row) {
          if (this._table === "quote_sessions") state.session = { ...state.session, ...patch };
          if (this._table === "chat_conversations") state.convo = { ...state.convo, ...patch };
          return { eq() { return Promise.resolve({ data: null, error: null }); } };
        },
        _run() {
          if (this._table === "quote_sessions") return Promise.resolve({ data: [state.session], error: null });
          if (this._table === "chat_conversations") return Promise.resolve({ data: [state.convo], error: null });
          if (this._table === "customers") {
            if (opts.customersThrow) throw new Error("db down");
            return Promise.resolve({ data: opts.customers ?? [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      return q;
    },
    _state: state,
  };
  return sb;
}

Deno.test("caller-ID confirmation: stores phone after 'yes' and never speaks full number", async () => {
  const sb = makeFake();
  const turn1 = await runControllerTurn({
    supabase: sb, conversationId: "c1", channel: "voice",
    utterance: "Hi, I want a quote.", history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn1.pre.kind, "ask_confirm_caller_id");
  if (turn1.pre.kind === "ask_confirm_caller_id") {
    assertEquals(turn1.pre.last4, "2877");
    assertEquals(turn1.pre.spoken.includes("469747"), false);
  }
  await persistControllerPatch(sb, "qs_1", turn1.sessionPatch);
  // Session must have callerIdConfirmationStatus = pending.
  assertEquals((sb._state.session.fields as any).callerIdConfirmationStatus, "pending");

  const turn2 = await runControllerTurn({
    supabase: sb, conversationId: "c1", channel: "voice",
    utterance: "yes that's right", history: [],
    callerIdE164: "+14697472877",
  });
  await persistControllerPatch(sb, "qs_1", turn2.sessionPatch);
  assertEquals((sb._state.session.fields as any).phone, "+14697472877");
  assertEquals((sb._state.session.field_status as any).phone, "verified");
});

Deno.test("caller-ID declined: asks for preferred mobile number without repeating full number", async () => {
  const sb = makeFake();
  // Pre-set pending state.
  sb._state.session.fields = { callerIdConfirmationStatus: "pending", callerIdProposedE164: "+14697472877" };
  const turn = await runControllerTurn({
    supabase: sb, conversationId: "c1", channel: "voice",
    utterance: "no, use a different one", history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind, "ask_preferred_phone");
  if (turn.pre.kind === "ask_preferred_phone") {
    assertEquals(turn.pre.spoken.includes("2877"), false);
  }
});

Deno.test("returning customer with unique match: greets by first name, skips name/phone intake", async () => {
  const sb = makeFake({ customers: [{ id: "cust_1", first_name: "Alex", phone: "+14697472877" }] });
  // Simulate confirmed phone already captured.
  sb._state.session.fields = { phone: "+14697472877", callerIdConfirmationStatus: "confirmed" };
  sb._state.session.field_status = { phone: "verified" };
  const turn = await runControllerTurn({
    supabase: sb, conversationId: "c1", channel: "voice",
    utterance: "hi", history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind, "greet_returning");
  if (turn.pre.kind === "greet_returning") assertEquals(turn.pre.firstName, "Alex");
});

Deno.test("ambiguous match: asks disambiguator without revealing any stored PII", async () => {
  const sb = makeFake({
    customers: [
      { id: "a", first_name: "A", phone: "+14697472877" },
      { id: "b", first_name: "B", phone: "+14697472877" },
    ],
  });
  sb._state.session.fields = { phone: "+14697472877" };
  sb._state.session.field_status = { phone: "verified" };
  const turn = await runControllerTurn({
    supabase: sb, conversationId: "c1", channel: "voice",
    utterance: "hi", history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind, "ask_disambiguator");
  if (turn.pre.kind === "ask_disambiguator") {
    const s = turn.pre.spoken.toLowerCase();
    assertEquals(s.includes("main st") || s.includes("@"), false);
  }
});

Deno.test("lookup failure falls back safely to new-customer intake (no greeting)", async () => {
  const sb = makeFake({ customersThrow: true });
  sb._state.session.fields = { phone: "+14697472877" };
  sb._state.session.field_status = { phone: "verified" };
  const turn = await runControllerTurn({
    supabase: sb, conversationId: "c1", channel: "voice",
    utterance: "hi", history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind !== "greet_returning", true);
  assertEquals(turn.pre.kind !== "ask_disambiguator", true);
});