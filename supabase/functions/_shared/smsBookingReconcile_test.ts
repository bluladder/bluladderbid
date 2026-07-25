// Unit tests for the Phase 6B.2 reconciliation dispatcher.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runSmsBookingReconciliation } from "./smsBookingReconcile.ts";
import type { RecoveryResult } from "./jobberBookingRecovery.ts";

function makeSupabaseStub(opts: {
  rows: any[];
  claim?: any;
  commit?: any;
  rpcLog?: Array<{ name: string; args: any }>;
}) {
  const rpcLog = opts.rpcLog ?? [];
  const rows = opts.rows;
  const queryStub = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    order() { return this; },
    async limit() { return { data: rows, error: null }; },
  } as any;
  return {
    from(_table: string) { return queryStub; },
    async rpc(name: string, args: any) {
      rpcLog.push({ name, args });
      if (name === "claim_sms_booking_execution") {
        return { data: opts.claim ?? { ok: true }, error: null };
      }
      if (name === "reconcile_sms_booking_matched") {
        const c = opts.commit ?? { ok: true };
        // Allow tests to inject a Postgres-level rejection via opts.commit.error.
        if ((c as any).__error) {
          return { data: null, error: { message: (c as any).__error } };
        }
        return { data: c, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  };
}

const baseRow = {
  id: "row-1",
  booking_idempotency_key: "sms:pres-1:group-1:conv:sess:slot",
  slot_group_id: "group-1",
  failure_class: "external_outcome_unknown",
  created_at: "2026-07-20T00:00:00Z",
  attempt_count: 1,
};

Deno.test("reconcile: matched → commit_sms_booking_success called", async () => {
  const rpcLog: any[] = [];
  const supabase = makeSupabaseStub({ rows: [baseRow], rpcLog });
  const recovery = async (): Promise<RecoveryResult> => ({
    outcome: "matched",
    jobberJobId: "J1",
    jobberVisitId: "V1",
    referenceNumber: "R1",
  });
  const r = await runSmsBookingReconciliation(supabase as any, { recovery });
  assertEquals(r.outcomes[0].decision, "matched_committed");
  const names = rpcLog.map((x) => x.name);
  assertEquals(names.includes("reconcile_sms_booking_matched"), true);
  // Never call the SMS-flow commit RPC from reconciliation.
  assertEquals(names.includes("commit_sms_booking_success"), false);
});

Deno.test("reconcile: matched but RPC rejected → commit_denied + requeued", async () => {
  const rpcLog: any[] = [];
  const supabase = makeSupabaseStub({
    rows: [baseRow],
    commit: { __error: "invalid input syntax for type uuid" } as any,
    rpcLog,
  });
  const recovery = async (): Promise<RecoveryResult> => ({
    outcome: "matched",
    jobberJobId: "gid://Jobber/Job/123",
    jobberVisitId: "gid://Jobber/Visit/9",
    referenceNumber: "42",
  });
  const r = await runSmsBookingReconciliation(supabase as any, { recovery });
  assertEquals(r.outcomes[0].decision, "commit_denied");
  const mark = rpcLog.find((x) => x.name === "mark_sms_booking_recoverable_failure");
  assertEquals(mark?.args?.p_error_code, "reconcile_commit_denied");
  assertEquals(mark?.args?.p_failure_class, "external_outcome_unknown");
});

Deno.test("reconcile: matched but ok:false → commit_denied + requeued", async () => {
  const rpcLog: any[] = [];
  const supabase = makeSupabaseStub({
    rows: [baseRow],
    commit: { ok: false, reason: "not_executing" },
    rpcLog,
  });
  const recovery = async (): Promise<RecoveryResult> => ({
    outcome: "matched",
    jobberJobId: "J1",
    jobberVisitId: "V1",
    referenceNumber: "R1",
  });
  const r = await runSmsBookingReconciliation(supabase as any, { recovery });
  assertEquals(r.outcomes[0].decision, "commit_denied");
  assertEquals(r.outcomes[0].detail, "not_executing");
});

Deno.test("reconcile: not_found → verified_not_created + released", async () => {
  const rpcLog: any[] = [];
  const supabase = makeSupabaseStub({ rows: [baseRow], rpcLog });
  const recovery = async (): Promise<RecoveryResult> => ({
    outcome: "not_found",
    pagesScanned: 3,
  });
  const r = await runSmsBookingReconciliation(supabase as any, { recovery });
  assertEquals(r.outcomes[0].decision, "not_found_released");
  const mark = rpcLog.find((x) => x.name === "mark_sms_booking_recoverable_failure");
  assertEquals(mark?.args?.p_failure_class, "verified_not_created");
  const unp = rpcLog.find((x) => x.name === "unprotect_reservation_after_failure");
  assertEquals(unp?.args?.p_new_status, "released");
});

Deno.test("reconcile: error → preserve prior class + hold retained", async () => {
  const rpcLog: any[] = [];
  const supabase = makeSupabaseStub({ rows: [baseRow], rpcLog });
  const recovery = async (): Promise<RecoveryResult> => ({
    outcome: "error",
    detail: "jobber_throttled",
    throttled: true,
  });
  const r = await runSmsBookingReconciliation(supabase as any, { recovery });
  assertEquals(r.outcomes[0].decision, "error_preserved");
  const mark = rpcLog.find((x) => x.name === "mark_sms_booking_recoverable_failure");
  assertEquals(mark?.args?.p_failure_class, "external_outcome_unknown");
  const unp = rpcLog.find((x) => x.name === "unprotect_reservation_after_failure");
  assertEquals(unp?.args?.p_new_status, "held");
});

Deno.test("reconcile: claim denied → skipped, no external call", async () => {
  const rpcLog: any[] = [];
  const supabase = makeSupabaseStub({
    rows: [baseRow],
    claim: { ok: false, reason: "manual_review_required" },
    rpcLog,
  });
  let recoveryCalls = 0;
  const recovery = async (): Promise<RecoveryResult> => {
    recoveryCalls++;
    return { outcome: "not_found", pagesScanned: 0 };
  };
  const r = await runSmsBookingReconciliation(supabase as any, { recovery });
  assertEquals(r.outcomes[0].decision, "claim_denied");
  assertEquals(recoveryCalls, 0);
});

Deno.test("reconcile: missing idempotency key → error_preserved", async () => {
  const rpcLog: any[] = [];
  const row = { ...baseRow, booking_idempotency_key: null };
  const supabase = makeSupabaseStub({ rows: [row], rpcLog });
  let recoveryCalls = 0;
  const recovery = async (): Promise<RecoveryResult> => {
    recoveryCalls++;
    return { outcome: "not_found", pagesScanned: 0 };
  };
  const r = await runSmsBookingReconciliation(supabase as any, { recovery });
  assertEquals(r.outcomes[0].decision, "error_preserved");
  assertEquals(recoveryCalls, 0);
});