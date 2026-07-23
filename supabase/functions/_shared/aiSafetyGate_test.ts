// Fail-CLOSED behavior tests for the central AI safety gate. Uses a tiny
// in-memory fake Supabase client so we can precisely simulate read errors,
// missing rows, and every switch/pause/takeover combination.
// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateAiSafetyGate } from "./aiSafetyGate.ts";

type TableResp = { data: any; error: any };
type TableFn = () => TableResp | Promise<TableResp>;

/** Minimal Supabase-shaped fake. Each table returns whatever the caller sets. */
function makeSupa(tables: Record<string, TableFn>) {
  return {
    from(name: string) {
      const fn = tables[name];
      // Return a builder whose terminal `.maybeSingle()` yields the response.
      const builder = {
        _resp: undefined as TableResp | Promise<TableResp> | undefined,
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() {
          if (!fn) return { data: null, error: { message: `unmocked:${name}` } };
          return await fn();
        },
      };
      return builder;
    },
  };
}

const PHONE = "+14692150144";
const CONV = "conv-1";

function happyTables(overrides: Record<string, TableFn> = {}) {
  return {
    system_test_config: () => ({
      data: { ai_sms_enabled: true, ai_sms_autobook_enabled: true },
      error: null,
    }),
    chat_conversations: () => ({
      data: { ai_autoreply_paused: false, staff_takeover_at: null },
      error: null,
    }),
    sms_opt_outs: () => ({ data: null, error: null }),
    ...overrides,
  };
}

Deno.test("allows auto_reply when every gate is explicitly safe", async () => {
  const supa = makeSupa(happyTables());
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, true);
  assertEquals(d.reason, undefined);
});

Deno.test("FAIL-CLOSED: kill switch read error blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    system_test_config: () => ({ data: null, error: { message: "boom" } }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "ai_sms_kill_switch_unreadable");
});

Deno.test("FAIL-CLOSED: missing config row blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    system_test_config: () => ({ data: null, error: null }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "ai_sms_kill_switch_unreadable");
});

Deno.test("FAIL-CLOSED: kill switch undefined value blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    system_test_config: () => ({ data: { ai_sms_autobook_enabled: true }, error: null }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "ai_sms_kill_switch_unreadable");
});

Deno.test("kill switch explicitly disabled blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    system_test_config: () => ({
      data: { ai_sms_enabled: false, ai_sms_autobook_enabled: true }, error: null,
    }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "ai_sms_kill_switch_disabled");
});

Deno.test("FAIL-CLOSED: pause state read error blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    chat_conversations: () => ({ data: null, error: { message: "db down" } }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "conversation_unreadable");
});

Deno.test("FAIL-CLOSED: missing conversation row blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    chat_conversations: () => ({ data: null, error: null }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "conversation_missing");
});

Deno.test("FAIL-CLOSED: indeterminate pause value blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    chat_conversations: () => ({ data: { staff_takeover_at: null }, error: null }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "conversation_unreadable");
});

Deno.test("pause=true blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    chat_conversations: () => ({ data: { ai_autoreply_paused: true, staff_takeover_at: null }, error: null }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "conversation_paused");
});

Deno.test("staff takeover blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    chat_conversations: () => ({
      data: { ai_autoreply_paused: false, staff_takeover_at: "2026-07-23T10:00:00Z" }, error: null,
    }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "staff_takeover_active");
});

Deno.test("FAIL-CLOSED: suppression read error blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    sms_opt_outs: () => ({ data: null, error: { message: "timeout" } }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "phone_suppression_unreadable");
});

Deno.test("opted-out phone blocks auto_reply", async () => {
  const supa = makeSupa(happyTables({
    sms_opt_outs: () => ({ data: { opted_out: true }, error: null }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "phone_suppressed");
});

Deno.test("missing phone blocks auto_reply", async () => {
  const supa = makeSupa(happyTables());
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: "" });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "phone_missing");
});

Deno.test("missing conversation id blocks auto_reply", async () => {
  const supa = makeSupa(happyTables());
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: null, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "conversation_missing");
});

// ---- autobook-specific gate --------------------------------------------

Deno.test("autobook requires ai_sms_autobook_enabled=true", async () => {
  const supa = makeSupa(happyTables({
    system_test_config: () => ({
      data: { ai_sms_enabled: true, ai_sms_autobook_enabled: false }, error: null,
    }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "autobook", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "ai_autobook_switch_disabled");
});

Deno.test("FAIL-CLOSED: autobook switch undefined blocks autobook", async () => {
  const supa = makeSupa(happyTables({
    system_test_config: () => ({ data: { ai_sms_enabled: true }, error: null }),
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "autobook", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "ai_autobook_switch_unreadable");
});

Deno.test("autobook allowed when all switches explicitly true and thread clean", async () => {
  const supa = makeSupa(happyTables());
  const d = await evaluateAiSafetyGate(supa, { action: "autobook", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, true);
});

// ---- exception handling ------------------------------------------------

Deno.test("FAIL-CLOSED: thrown exception on config read blocks", async () => {
  const supa = makeSupa(happyTables({
    system_test_config: () => { throw new Error("network"); },
  }));
  const d = await evaluateAiSafetyGate(supa, { action: "auto_reply", conversationId: CONV, phone: PHONE });
  assertEquals(d.allow, false);
  assertEquals(d.reason, "ai_sms_kill_switch_unreadable");
});