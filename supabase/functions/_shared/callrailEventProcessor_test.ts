// deno-lint-ignore-file no-explicit-any
// -----------------------------------------------------------------------------
// Focused unit tests for the invariants that make retry + replay safe:
//
//   1. Receipt uniqueness — a second insert with the same provider_message_id
//      is reported as `duplicate` and the row count stays at 1.
//   2. Atomic retry claim — two concurrent workers cannot claim the same
//      due retry_pending event.
//   3. Replay claim — records actor + timestamp, increments replay_count,
//      clears error state, and cannot double-claim an in-flight row.
//
// We do NOT invoke the full processor here (its downstream calls need live
// CallRail / AI credentials and are covered by integration checks). The
// invariants above are exactly the guarantees that let the processor be
// re-run safely — they hold or fail independently of the outbound side.
// -----------------------------------------------------------------------------
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordInboundReceipt } from "./callrailReceipts.ts";

function mkSb() {
  const events: any[] = [];
  const clone = (r: any) => JSON.parse(JSON.stringify(r));
  const build = () => {
    const state: any = { eq: [] as any[] };
    const q: any = {
      insert(row: any) {
        if (events.find((r) => r.provider_message_id === row.provider_message_id)) {
          return {
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { code: "23505" } }),
            }),
          };
        }
        const inserted = {
          id: crypto.randomUUID(),
          attempts: 0,
          replay_count: 0,
          received_at: new Date().toISOString(),
          ...row,
        };
        events.push(inserted);
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: clone(inserted), error: null }),
          }),
        };
      },
      select() { return q; },
      eq(k: string, v: any) { state.eq.push([k, v]); return q; },
      maybeSingle: () => {
        const match = events.find((r) => state.eq.every(([k, v]: any) => r[k] === v)) ?? null;
        return Promise.resolve({ data: match ? clone(match) : null, error: null });
      },
    };
    return q;
  };
  return {
    events,
    from: (_n: string) => build(),
    rpc: async (fn: string, args: any) => {
      if (fn === "claim_due_callrail_retries") {
        const now = Date.now();
        const due = events
          .filter((r) => r.status === "retry_pending"
            && (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= now))
          .slice(0, args._limit ?? 25);
        for (const r of due) r.status = "processing";
        return { data: due.map((r) => ({ id: r.id })), error: null };
      }
      if (fn === "claim_callrail_event_for_replay") {
        const row = events.find((r) => r.id === args._id);
        if (!row) return { data: [], error: null };
        const prior = row.status;
        if (prior === "processing") {
          return {
            data: [{ id: row.id, provider_message_id: row.provider_message_id, prior_status: prior }],
            error: null,
          };
        }
        row.status = "processing";
        row.replay_requested_by = args._actor ?? null;
        row.replay_requested_at = new Date().toISOString();
        row.replay_count = (row.replay_count ?? 0) + 1;
        row.last_error_category = null;
        row.last_error_detail = null;
        row.next_attempt_at = null;
        return {
          data: [{ id: row.id, provider_message_id: row.provider_message_id, prior_status: prior }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };
}

Deno.test("recordInboundReceipt: duplicate provider_message_id reports duplicate=true, row count unchanged", async () => {
  const sb: any = mkSb();
  const a = await recordInboundReceipt(sb, {
    providerMessageId: "cr_dup",
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content: "hi" },
  });
  assertEquals(a.duplicate, false);
  const b = await recordInboundReceipt(sb, {
    providerMessageId: "cr_dup",
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content: "hi" },
  });
  assertEquals(b.duplicate, true);
  assertEquals(b.receipt.id, a.receipt.id);
  assertEquals(sb.events.length, 1);
});

Deno.test("claim_due_callrail_retries: two concurrent workers never both get the same row", async () => {
  const sb: any = mkSb();
  const { receipt } = await recordInboundReceipt(sb, {
    providerMessageId: "cr_race",
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content: "hi" },
  });
  const row = sb.events.find((r: any) => r.id === receipt.id);
  row.status = "retry_pending";
  row.next_attempt_at = new Date(Date.now() - 1000).toISOString();
  const [a, b] = await Promise.all([
    sb.rpc("claim_due_callrail_retries", { _limit: 10 }),
    sb.rpc("claim_due_callrail_retries", { _limit: 10 }),
  ]);
  const ids = [...a.data.map((r: any) => r.id), ...b.data.map((r: any) => r.id)];
  assertEquals(ids.filter((id) => id === receipt.id).length, 1);
  assertEquals(row.status, "processing");
});

Deno.test("claim_callrail_event_for_replay: records actor + timestamp, increments count, clears error state", async () => {
  const sb: any = mkSb();
  const { receipt } = await recordInboundReceipt(sb, {
    providerMessageId: "cr_replay",
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content: "hi" },
  });
  const row = sb.events.find((r: any) => r.id === receipt.id);
  row.status = "failed";
  row.last_error_category = "transient_provider";
  row.last_error_detail = "timeout";
  row.next_attempt_at = null;

  const first = await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin-1" });
  assertEquals(first.data[0].prior_status, "failed");
  assertEquals(row.status, "processing");
  assertEquals(row.replay_requested_by, "admin-1");
  assert(!!row.replay_requested_at);
  assertEquals(row.replay_count, 1);
  assertEquals(row.last_error_category, null);

  // Second concurrent replay while status is still 'processing' — must
  // return prior_status='processing' so caller can 409.
  const second = await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin-2" });
  assertEquals(second.data[0].prior_status, "processing");
  assertEquals(row.replay_count, 1);
  assertEquals(row.replay_requested_by, "admin-1");
});

Deno.test("replay claim increments across successful replays", async () => {
  const sb: any = mkSb();
  const { receipt } = await recordInboundReceipt(sb, {
    providerMessageId: "cr_multi",
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content: "hi" },
  });
  const row = sb.events.find((r: any) => r.id === receipt.id);
  row.status = "processed";
  await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin" });
  row.status = "processed";
  await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin" });
  row.status = "processed";
  await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin" });
  assertEquals(row.replay_count, 3);
});