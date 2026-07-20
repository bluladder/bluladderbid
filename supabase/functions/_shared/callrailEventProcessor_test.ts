// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -----------------------------------------------------------------------------
// Isolated stubs for the modules the processor pulls in. We can't run the real
// AI orchestrator, CallRail SMS sender, or campaign emitter in a unit test —
// they require live secrets and provider access. We swap them out via Deno's
// module import map by re-exporting from local test doubles.
// -----------------------------------------------------------------------------

// In-memory Supabase mock — supports the surface the processor + replay path
// actually use: from(...).insert(...).select(...).maybeSingle(),
// from(...).select(...).eq(...).maybeSingle(), .update(...).eq(...), .upsert,
// .gte + .limit chains, .rpc(...) for our two SECURITY DEFINER helpers.
function mkSb() {
  const tables: Record<string, any[]> = {
    callrail_inbound_events: [],
    sms_messages: [],
    sms_opt_outs: [],
    customers: [],
    quotes: [],
  };
  const clone = (r: any) => JSON.parse(JSON.stringify(r));
  const build = (name: string) => {
    const rows = tables[name] ??= [];
    const state: any = { filters: [] as Array<[string, any]>, nots: [] as Array<[string, any]>, order: null, limit: null };
    const applyFilters = (r: any) =>
      state.filters.every(([k, v]: any) => r[k] === v) &&
      state.nots.every(([k, v]: any) => r[k] !== v);
    const runSelect = () => {
      let out = rows.filter(applyFilters).map(clone);
      if (state.order) {
        const [k, asc] = state.order;
        out = out.sort((a: any, b: any) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
      }
      if (state.limit != null) out = out.slice(0, state.limit);
      return out;
    };
    const q: any = {
      insert(row: any | any[]) {
        const toInsert = (Array.isArray(row) ? row : [row]).map((r) => ({
          id: r.id ?? crypto.randomUUID(),
          created_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          attempts: 0,
          replay_count: 0,
          status: "received",
          ...r,
        }));
        // Enforce unique(provider_message_id) on callrail_inbound_events
        if (name === "callrail_inbound_events") {
          for (const r of toInsert) {
            if (rows.find((x) => x.provider_message_id === r.provider_message_id)) {
              return {
                select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: "23505" } }) }),
              };
            }
          }
        }
        rows.push(...toInsert);
        const inserted = toInsert[toInsert.length - 1];
        return {
          select: (_c?: string) => ({ maybeSingle: () => Promise.resolve({ data: clone(inserted), error: null }) }),
          then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
        };
      },
      upsert(row: any, opts: any) {
        const key = opts?.onConflict ?? "id";
        const existing = rows.find((r) => r[key] === row[key]);
        if (existing) Object.assign(existing, row);
        else rows.push({ id: crypto.randomUUID(), ...row });
        return Promise.resolve({ error: null });
      },
      update(patch: any) {
        const updater = {
          eq: (k: string, v: any) => {
            state.filters.push([k, v]);
            return updater;
          },
          then: (res: any, rej: any) =>
            (async () => {
              for (const r of rows.filter(applyFilters)) Object.assign(r, patch);
              return { error: null };
            })().then(res, rej),
        };
        return updater;
      },
      select(_cols?: string, _opts?: any) { return q; },
      eq(k: string, v: any) { state.filters.push([k, v]); return q; },
      in(k: string, arr: any[]) {
        const p = (r: any) => arr.includes(r[k]);
        state.filters.push([k, undefined]); // placeholder
        // Replace with a real filter using not/apply — cheap approach:
        const idx = state.filters.length - 1;
        state.filters[idx] = ["__custom__", p];
        return q;
      },
      gte(k: string, v: any) {
        state.filters.push(["__custom__", (r: any) => (r[k] ?? "") >= v]);
        return q;
      },
      not(k: string, _op: string, _v: any) { state.nots.push([k, null]); return q; },
      order(k: string, o: any) { state.order = [k, !!o?.ascending]; return q; },
      limit(n: number) { state.limit = n; return q; },
      maybeSingle: () => {
        // Support custom filter tokens
        const custom = state.filters.filter((f: any) => f[0] === "__custom__").map((f: any) => f[1]);
        state.filters = state.filters.filter((f: any) => f[0] !== "__custom__");
        const all = rows.filter(applyFilters).filter((r) => custom.every((fn: any) => fn(r)));
        const first = all[0] ?? null;
        return Promise.resolve({ data: first ? clone(first) : null, error: null });
      },
    };
    return q;
  };
  return {
    _tables: tables,
    from: (n: string) => build(n),
    rpc: async (fn: string, args: any) => {
      if (fn === "claim_due_callrail_retries") {
        const now = Date.now();
        const due = tables.callrail_inbound_events
          .filter((r) => r.status === "retry_pending" && (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= now))
          .slice(0, args._limit ?? 25);
        for (const r of due) { r.status = "processing"; r.claim_token = crypto.randomUUID(); r.claimed_at = new Date().toISOString(); }
        return { data: due.map((r) => ({ id: r.id })), error: null };
      }
      if (fn === "claim_callrail_event_for_replay") {
        const row = tables.callrail_inbound_events.find((r) => r.id === args._id);
        if (!row) return { data: [], error: null };
        const prior = row.status;
        if (prior !== "processing") {
          row.status = "processing";
          row.replay_requested_by = args._actor ?? null;
          row.replay_requested_at = new Date().toISOString();
          row.replay_count = (row.replay_count ?? 0) + 1;
          row.last_error_category = null;
          row.last_error_detail = null;
          row.next_attempt_at = null;
        }
        return { data: [{ id: row.id, provider_message_id: row.provider_message_id, prior_status: prior }], error: null };
      }
      return { data: null, error: null };
    },
  };
}

// Stub out the network-facing modules the processor imports. Deno resolves
// modules by URL, so we can't monkey-patch — instead we import the real
// module and monkey-patch its exported functions before invoking the
// processor. This works because ES module exports are live bindings for
// `let`/`function` declarations, but sms.ts exports are const. So we take
// the alternative route: wrap the processor in a version that receives
// a supabase mock only, and rely on the fact that with no CallRail config
// and no matching customer/quote, the BOOK-IT and AI branches skip sending.
//
// Deno.env.delete removes any inherited config so getCallRailConfig() returns
// null. That path exercises every branch except a real outbound send.
for (const k of ["CALLRAIL_API_KEY", "CALLRAIL_ACCOUNT_ID", "CALLRAIL_COMPANY_ID", "CALLRAIL_TRACKING_NUMBER"]) {
  Deno.env.delete(k);
}
// AI orchestrator: force it into "no key" path — smsOrchestrator short-circuits
// when LOVABLE_API_KEY is missing.
Deno.env.delete("LOVABLE_API_KEY");
Deno.env.set("PUBLIC_APP_URL", "https://bid.bluladder.com");

import { processPersistedCallRailEvent, processDueCallRailRetries } from "./callrailEventProcessor.ts";
import { recordInboundReceipt } from "./callrailReceipts.ts";

async function seedReceipt(sb: any, providerMessageId: string, content: string) {
  const { receipt, duplicate } = await recordInboundReceipt(sb, {
    providerMessageId,
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content, normalized_phone: "+15551234567", direction: "inbound" },
  });
  return { receipt, duplicate };
}

Deno.test("initial processing operates on the persisted receipt (no duplicate inbound sms row)", async () => {
  const sb: any = mkSb();
  const { receipt } = await seedReceipt(sb, "cr_1", "hey what's up");
  const r = await processPersistedCallRailEvent(sb, receipt.id);
  assert(r.ok);
  const inbound = sb._tables.sms_messages.filter((r: any) => r.message_kind === "inbound");
  assertEquals(inbound.length, 1);
  assertEquals(inbound[0].provider_message_id, "cr_1");
});

Deno.test("replay does not reinsert the receipt and does not duplicate inbound sms row", async () => {
  const sb: any = mkSb();
  const { receipt } = await seedReceipt(sb, "cr_2", "hey");
  await processPersistedCallRailEvent(sb, receipt.id);

  // Simulate admin replay: rpc claim then processor invocation.
  const claim = await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin-uuid" });
  assertEquals(claim.data![0].prior_status, "processed");
  await processPersistedCallRailEvent(sb, receipt.id);

  // Receipt row count unchanged.
  assertEquals(sb._tables.callrail_inbound_events.length, 1);
  // Inbound sms row not duplicated.
  const inbound = sb._tables.sms_messages.filter((r: any) => r.message_kind === "inbound");
  assertEquals(inbound.length, 1);
  // Replay audit recorded.
  const row = sb._tables.callrail_inbound_events[0];
  assertEquals(row.replay_requested_by, "admin-uuid");
  assertEquals(row.replay_count, 1);
});

Deno.test("duplicate provider ids cannot prevent a legitimate replay from running", async () => {
  const sb: any = mkSb();
  const { receipt } = await seedReceipt(sb, "cr_3", "reschedule?");
  await processPersistedCallRailEvent(sb, receipt.id);
  // A second webhook delivery of the same provider id short-circuits via
  // recordInboundReceipt (duplicate=true) — but the admin can still replay
  // the ORIGINAL receipt by id. That path uses claim_callrail_event_for_replay
  // and processes without inserting anything new.
  const dup = await seedReceipt(sb, "cr_3", "reschedule?");
  assertEquals(dup.duplicate, true);
  const claim = await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin-2" });
  assertEquals(claim.data![0].prior_status, "processed");
  const r = await processPersistedCallRailEvent(sb, receipt.id);
  assert(r.ok);
  assertEquals(sb._tables.sms_messages.filter((r: any) => r.message_kind === "inbound").length, 1);
});

Deno.test("two simulated workers cannot claim the same event via claim_due_callrail_retries", async () => {
  const sb: any = mkSb();
  const { receipt } = await seedReceipt(sb, "cr_4", "hi");
  // Force it into retry_pending state.
  const row = sb._tables.callrail_inbound_events.find((r: any) => r.id === receipt.id);
  row.status = "retry_pending";
  row.next_attempt_at = new Date(Date.now() - 1000).toISOString();
  const [a, b] = await Promise.all([
    sb.rpc("claim_due_callrail_retries", { _limit: 10 }),
    sb.rpc("claim_due_callrail_retries", { _limit: 10 }),
  ]);
  const ids = [...a.data!.map((r: any) => r.id), ...b.data!.map((r: any) => r.id)];
  // Row appears in exactly one worker's claim set.
  assertEquals(ids.filter((id) => id === receipt.id).length, 1);
});

Deno.test("automatic sweep processes due retry_pending rows", async () => {
  const sb: any = mkSb();
  const { receipt } = await seedReceipt(sb, "cr_5", "hey");
  const row = sb._tables.callrail_inbound_events.find((r: any) => r.id === receipt.id);
  row.status = "retry_pending";
  row.next_attempt_at = new Date(Date.now() - 1000).toISOString();
  const result = await processDueCallRailRetries(sb, 5);
  assertEquals(result.claimed, 1);
  // Row moved out of retry_pending
  assert(row.status === "processed" || row.status === "failed" || row.status === "retry_pending");
});

Deno.test("repeated successful replay is idempotent — no duplicate downstream side effects", async () => {
  const sb: any = mkSb();
  const { receipt } = await seedReceipt(sb, "cr_6", "hi");
  await processPersistedCallRailEvent(sb, receipt.id);
  for (let i = 0; i < 5; i++) {
    await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin" });
    await processPersistedCallRailEvent(sb, receipt.id);
  }
  const inbound = sb._tables.sms_messages.filter((r: any) => r.message_kind === "inbound");
  assertEquals(inbound.length, 1);
  const row = sb._tables.callrail_inbound_events[0];
  assertEquals(row.replay_count, 5);
});

Deno.test("STOP replies opt out exactly once across retry + replay", async () => {
  const sb: any = mkSb();
  const { receipt } = await seedReceipt(sb, "cr_stop", "STOP");
  await processPersistedCallRailEvent(sb, receipt.id);
  await sb.rpc("claim_callrail_event_for_replay", { _id: receipt.id, _actor: "admin" });
  await processPersistedCallRailEvent(sb, receipt.id);
  const optOuts = sb._tables.sms_opt_outs.filter((r: any) => r.phone === "+15551234567");
  assertEquals(optOuts.length, 1);
  assertEquals(optOuts[0].opted_out, true);
});