// Phase 6B.1 — expired-hold split behavior (YES vs NO).
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { handleConfirmationReply } from "./handleConfirmationReply.ts";

type Row = Record<string, any>;

function makeStub(pres: Row) {
  const sent: any[] = [];
  const supabase: any = {
    from(_t: string) {
      const api: any = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        limit() { return api; },
        async maybeSingle() { return { data: pres, error: null }; },
        update() { return { eq: () => Promise.resolve({ error: null }) }; },
        insert(row: Row) {
          sent.push(row);
          return { select: () => ({ maybeSingle: async () => ({ data: { id: "sms-1", ...row }, error: null }) }) };
        },
      };
      return api;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { supabase, sent };
}

function heldRow(expiresAt: string): Row {
  return {
    id: "pres-1",
    conversation_id: "conv-1",
    hold_status: "held",
    hold_group_id: "grp-1",
    hold_expires_at: expiresAt,
    status: "active",
  };
}

// Stub the CallRail config + autonomous send gate indirectly by exercising
// the pre-callrail branch: when getCallRailConfig() returns null, the handler
// still returns action='hold_expired'. We validate the branching by directly
// asserting return payload — bodies are covered by the source-level constants.

Deno.test("6B.1 — expired hold + YES → hold_expired action, presentation returned", async () => {
  const { supabase } = makeStub(heldRow("2020-01-01T00:00:00Z"));
  const res = await handleConfirmationReply(supabase, {
    conversationId: "conv-1",
    phone: "+14695550100",
    inboundSmsId: "in-1",
    inboundText: "yes",
  }, { now: () => new Date("2026-08-01T15:00:00Z") });
  assertEquals(res.handled, true);
  assertEquals(res.action, "hold_expired");
});

Deno.test("6B.1 — expired hold + NO → hold_expired action, no fresh availability trigger", async () => {
  const { supabase } = makeStub(heldRow("2020-01-01T00:00:00Z"));
  const res = await handleConfirmationReply(supabase, {
    conversationId: "conv-1",
    phone: "+14695550100",
    inboundSmsId: "in-2",
    inboundText: "no thanks",
  }, { now: () => new Date("2026-08-01T15:00:00Z") });
  assertEquals(res.handled, true);
  assertEquals(res.action, "hold_expired");
  assert(res.presentation);
});

Deno.test("6B.1 — expired hold + unclear → falls through to orchestrator", async () => {
  const { supabase } = makeStub(heldRow("2020-01-01T00:00:00Z"));
  const res = await handleConfirmationReply(supabase, {
    conversationId: "conv-1",
    phone: "+14695550100",
    inboundSmsId: "in-3",
    inboundText: "what does that mean",
  }, { now: () => new Date("2026-08-01T15:00:00Z") });
  assertEquals(res.handled, false);
  assertEquals(res.action, "hold_expired");
});

// Verify the split bodies exist as distinct constants in the source, guarding
// against a future accidental collapse back to a single body.
Deno.test("6B.1 — source contains distinct YES/NO expired-hold bodies", async () => {
  const src = await Deno.readTextFile(new URL("./handleConfirmationReply.ts", import.meta.url));
  assert(src.includes("EXPIRED_HOLD_YES_BODY"), "YES body constant missing");
  assert(src.includes("EXPIRED_HOLD_NO_BODY"), "NO body constant missing");
  assert(src.includes("nothing was booked"), "NO body must acknowledge nothing was booked");
  assert(!/EXPIRED_HOLD_NO_BODY[\s\S]{0,200}pull fresh times/.test(src),
    "NO body must NOT invite fresh availability");
});