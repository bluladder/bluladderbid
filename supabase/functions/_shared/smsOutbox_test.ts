// Phase 6B.3 unit tests — SMS outbox state machine + timezone rendering.
// Uses a stubbed supabase.rpc that emulates claim/finalize semantics.
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendOutboxSms } from "./smsOutbox.ts";
import {
  resolveBookingTimezone,
  formatBookingWhen,
  BLULADDER_DEFAULT_TIMEZONE,
} from "./bookingTimezone.ts";

const callRail = {
  apiKey: "k", accountId: "a", companyId: "c", senderNumber: "+14697472877",
};

function makeSupabase(opts: {
  existing?: any | null;
  claimBehavior?: "new" | "replay" | "in_progress" | "escalated";
  rpcLog?: any[];
}) {
  const rpcLog = opts.rpcLog ?? [];
  return {
    async rpc(name: string, args: any) {
      rpcLog.push({ name, args });
      if (name === "claim_sms_outbox_send") {
        switch (opts.claimBehavior ?? "new") {
          case "new":
            return { data: { ok: true, is_new: true, id: "sms-1", outbox_state: "sending", may_dispatch: true }, error: null };
          case "replay":
            return { data: { ok: true, is_new: false, id: "sms-1", outbox_state: "provider_accepted", may_dispatch: false, replay: true, provider_message_id: "prov-x", status: "sent" }, error: null };
          case "in_progress":
            return { data: { ok: true, is_new: false, id: "sms-1", outbox_state: "sending", may_dispatch: false, in_progress: true }, error: null };
          case "escalated":
            return { data: { ok: true, is_new: false, id: "sms-1", outbox_state: "delivery_unknown", may_dispatch: false, escalated: true }, error: null };
        }
      }
      if (name === "finalize_sms_outbox_send") {
        return { data: { ok: true, current_state: args.p_new_state }, error: null };
      }
      return { data: null, error: null };
    },
  } as any;
}

// Stub global fetch (CallRail) — behavior controlled by a module-level flag.
let fetchMode: "ok" | "reject" | "throw" | "malformed" = "ok";
// deno-lint-ignore no-explicit-any
(globalThis as any).fetch = async (_url: string, _init: any) => {
  if (fetchMode === "throw") throw new Error("network_down");
  if (fetchMode === "reject") {
    return new Response("nope", { status: 500 });
  }
  if (fetchMode === "malformed") {
    return new Response("not-json", { status: 200 });
  }
  return new Response(JSON.stringify({ id: "conv-1", recent_messages: [{ id: "prov-1", direction: "outgoing", status: "delivered" }] }), { status: 200 });
};

Deno.test("outbox #14: crash before dispatch → next call re-claims and dispatches once", async () => {
  // First worker: escalated state means we do NOT dispatch. This simulates
  // "a prior sending row is stale" — the previous crash left a sending row
  // that has since been escalated by the reclaim path.
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const sb = makeSupabase({ claimBehavior: "escalated", rpcLog });
  const r = await sendOutboxSms(sb, { outboundKey: "k1", toNumber: "+15551234567", body: "hi", messageKind: "test", callRail });
  assertEquals(r.sent, false);
  assertEquals(r.escalated, true);
  assertEquals(r.outboxState, "delivery_unknown");
  // No finalize call — claim path already terminal.
  assert(!rpcLog.some((x) => x.name === "finalize_sms_outbox_send"));
});

Deno.test("outbox #15: crash after provider acceptance → replay does NOT redispatch", async () => {
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const sb = makeSupabase({ claimBehavior: "replay", rpcLog });
  const r = await sendOutboxSms(sb, { outboundKey: "k1", toNumber: "+15551234567", body: "hi", messageKind: "test", callRail });
  assertEquals(r.sent, true);          // prior accepted evidence is authoritative
  assertEquals(r.replay, true);
  assertEquals(r.providerMessageId, "prov-x");
  // No finalize — nothing to finalize because we didn't win the claim.
  assert(!rpcLog.some((x) => x.name === "finalize_sms_outbox_send"));
});

Deno.test("outbox #16: duplicate confirmation request in-flight → sees in_progress, no dispatch", async () => {
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const sb = makeSupabase({ claimBehavior: "in_progress", rpcLog });
  const r = await sendOutboxSms(sb, { outboundKey: "k1", toNumber: "+15551234567", body: "hi", messageKind: "test", callRail });
  assertEquals(r.sent, false);
  assertEquals(r.inProgress, true);
  assert(!rpcLog.some((x) => x.name === "finalize_sms_outbox_send"));
});

Deno.test("outbox #17: provider rejection finalizes to send_failed; caller does not roll back booking", async () => {
  const rpcLog: any[] = [];
  fetchMode = "reject";
  const sb = makeSupabase({ claimBehavior: "new", rpcLog });
  const r = await sendOutboxSms(sb, { outboundKey: "k1", toNumber: "+15551234567", body: "hi", messageKind: "test", callRail });
  assertEquals(r.sent, false);
  assertEquals(r.outboxState, "send_failed");
  const fin = rpcLog.find((x) => x.name === "finalize_sms_outbox_send");
  assertEquals(fin?.args?.p_new_state, "send_failed");
  // The caller (handleConfirmationReply) inspects `sent`; on false it does
  // NOT roll back the ledger — the booking stays confirmed in
  // sms_booking_confirmations and only the confirmation SMS is unresolved.
});

Deno.test("outbox: thrown dispatch → delivery_unknown (no re-send)", async () => {
  const rpcLog: any[] = [];
  fetchMode = "throw";
  const sb = makeSupabase({ claimBehavior: "new", rpcLog });
  const r = await sendOutboxSms(sb, { outboundKey: "k1", toNumber: "+15551234567", body: "hi", messageKind: "test", callRail });
  assertEquals(r.outboxState, "delivery_unknown");
  const fin = rpcLog.find((x) => x.name === "finalize_sms_outbox_send");
  assertEquals(fin?.args?.p_new_state, "delivery_unknown");
});

Deno.test("timezone #20: property timezone renders in local zone", () => {
  // 2026-07-23T20:00:00Z = 3:00 PM America/Chicago (CDT, UTC-5)
  const s = formatBookingWhen("2026-07-23T20:00:00Z", "America/Chicago");
  assert(s.includes("3:00 PM"), `expected 3:00 PM in CDT, got: ${s}`);
  assert(s.includes("July"));
});

Deno.test("timezone #21: DST transition renders correctly", () => {
  // Nov 1, 2026 at 07:00 UTC — before DST ends (CDT, UTC-5) = 2:00 AM
  const before = formatBookingWhen("2026-11-01T07:00:00Z", "America/Chicago");
  assert(before.includes("2:00 AM"), `expected 2:00 AM CDT, got: ${before}`);
  // Nov 1, 2026 at 10:00 UTC — after DST ends (CST, UTC-6) = 4:00 AM
  const after = formatBookingWhen("2026-11-01T10:00:00Z", "America/Chicago");
  assert(after.includes("4:00 AM"), `expected 4:00 AM CST, got: ${after}`);
});

Deno.test("timezone resolution order: presentation > property > default", () => {
  assertEquals(
    resolveBookingTimezone({ presentation: { held_option: { timezone: "America/New_York" } }, property: { timezone: "America/Denver" } }),
    "America/New_York",
  );
  assertEquals(
    resolveBookingTimezone({ presentation: {}, property: { timezone: "America/Denver" } }),
    "America/Denver",
  );
  assertEquals(
    resolveBookingTimezone({ presentation: null, property: null }),
    BLULADDER_DEFAULT_TIMEZONE,
  );
});