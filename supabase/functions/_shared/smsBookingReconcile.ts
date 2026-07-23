// ============================================================================
// smsBookingReconcile — Phase 6B.2 reconciliation dispatcher.
//
// Handles rows in `sms_booking_confirmations` that ended in
//   status = 'failed_recoverable'
// with a reconciliation-owned failure_class:
//   - external_outcome_unknown         (Jobber round-trip never completed)
//   - external_committed_pending_local (Jobber succeeded, local commit crashed)
//
// For each such row this module:
//   1. Claims the row with source='reconciliation' (only allowed for
//      reconciliation-owned classes — enforced by the SQL RPC).
//   2. Searches Jobber for a job whose private instructions contain the
//      canonical `Ref: <booking_idempotency_key>` line.
//   3. Applies exactly one of three deterministic outcomes:
//        matched   → commit_sms_booking_success (row → confirmation_pending,
//                    hold consumed).
//        not_found → mark_sms_booking_recoverable_failure with class
//                    'verified_not_created' — releases the hold.
//        error     → mark_sms_booking_recoverable_failure preserving the
//                    prior class (keeps hold; will be retried next tick).
//
// This module is exported as a pure function of (supabase, deps) so it can
// be unit-tested without hitting Jobber or PG.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import {
  findJobberJobByIdempotencyKey,
  type RecoveryOptions,
  type RecoveryResult,
} from "./jobberBookingRecovery.ts";
import { unprotectReservationAfterFailure } from "./reservationProtection.ts";

export type ReconcileDecision =
  | "matched_committed"
  | "not_found_released"
  | "error_preserved"
  | "claim_denied"
  | "commit_denied";

export interface ReconcileRowResult {
  confirmationId: string;
  decision: ReconcileDecision;
  detail?: string;
}

export interface ReconcileRunResult {
  ok: boolean;
  scanned: number;
  claimed: number;
  outcomes: ReconcileRowResult[];
}

export interface ReconcileDeps {
  now?: () => Date;
  tokenFactory?: () => string;
  /** Jobber recovery override — allows unit tests to stub the search. */
  recovery?: (opts: RecoveryOptions) => Promise<RecoveryResult>;
  /** Max rows processed per tick. */
  batchSize?: number;
  /** Recovery lookback window in days. */
  lookbackDays?: number;
}

const RECONCILIATION_CLASSES = [
  "external_outcome_unknown",
  "external_committed_pending_local",
  "legacy_unclassified",
];

export async function runSmsBookingReconciliation(
  supabase: any,
  deps: ReconcileDeps = {},
): Promise<ReconcileRunResult> {
  const now = deps.now ? deps.now() : new Date();
  const tokenFactory = deps.tokenFactory ?? (() => crypto.randomUUID());
  const recovery = deps.recovery ?? findJobberJobByIdempotencyKey;
  const batch = Math.max(1, deps.batchSize ?? 25);
  const lookbackDays = Math.max(1, deps.lookbackDays ?? 14);
  const createdAfter = new Date(now.getTime() - lookbackDays * 86400_000);

  const { data: rows, error } = await supabase
    .from("sms_booking_confirmations")
    .select("id, booking_idempotency_key, slot_group_id, failure_class, created_at, attempt_count")
    .eq("status", "failed_recoverable")
    .in("failure_class", RECONCILIATION_CLASSES)
    .order("created_at", { ascending: true })
    .limit(batch);

  if (error) {
    return { ok: false, scanned: 0, claimed: 0, outcomes: [] };
  }

  const outcomes: ReconcileRowResult[] = [];
  let claimed = 0;

  for (const row of (rows ?? []) as any[]) {
    const priorClass = String(row.failure_class ?? "external_outcome_unknown");
    const executionToken = tokenFactory();

    const { data: claim } = await supabase.rpc("claim_sms_booking_execution", {
      p_confirmation_id: row.id,
      p_execution_token: executionToken,
      p_claim_source: "reconciliation",
    });
    const claimRes = (claim ?? {}) as any;
    if (claimRes.ok !== true) {
      outcomes.push({
        confirmationId: row.id,
        decision: "claim_denied",
        detail: claimRes.reason ?? "unknown",
      });
      continue;
    }
    claimed++;

    if (!row.booking_idempotency_key) {
      // Cannot search Jobber without the ref; requeue as error.
      await supabase.rpc("mark_sms_booking_recoverable_failure", {
        p_confirmation_id: row.id,
        p_execution_token: executionToken,
        p_failure_class: priorClass,
        p_error_code: "reconcile_no_key",
        p_last_error: "missing_booking_idempotency_key",
        p_provider_request: null,
        p_provider_response: null,
        p_reconciliation_status: "pending",
      });
      outcomes.push({ confirmationId: row.id, decision: "error_preserved", detail: "no_key" });
      continue;
    }

    const result = await recovery({
      idempotencyKey: String(row.booking_idempotency_key),
      createdAfter,
    });

    if (result.outcome === "matched") {
      const { data: commit } = await supabase.rpc("commit_sms_booking_success", {
        p_confirmation_id: row.id,
        p_execution_token: executionToken,
        p_presentation_id: null,
        p_hold_group_id: row.slot_group_id,
        p_booking_id: result.jobberJobId,
        p_jobber_job_id: result.jobberJobId,
        p_jobber_visit_id: result.jobberVisitId,
        p_reference_number: result.referenceNumber,
        p_booking_result: { reconciled: true },
        p_provider_response: { reconciled: true, source: "jobber_search" },
      });
      const commitRes = (commit ?? {}) as any;
      if (commitRes.ok === false) {
        outcomes.push({
          confirmationId: row.id,
          decision: "commit_denied",
          detail: commitRes.reason ?? "commit_denied",
        });
        continue;
      }
      outcomes.push({ confirmationId: row.id, decision: "matched_committed" });
      continue;
    }

    if (result.outcome === "not_found") {
      // Verified: no Jobber write happened. Release capacity via
      // failure-class 'verified_not_created' — the SQL RPC releases the hold
      // for exactly this class. Also unprotect any lingering reservation.
      await supabase.rpc("mark_sms_booking_recoverable_failure", {
        p_confirmation_id: row.id,
        p_execution_token: executionToken,
        p_failure_class: "verified_not_created",
        p_error_code: "reconcile_not_found",
        p_last_error: `verified_not_created_after_${result.pagesScanned}_pages`,
        p_provider_request: null,
        p_provider_response: { reconciled: true, source: "jobber_search" },
        p_reconciliation_status: "resolved_not_created",
      });
      if (row.slot_group_id) {
        await unprotectReservationAfterFailure(supabase, row.slot_group_id, "released").catch(
          () => undefined,
        );
      }
      outcomes.push({ confirmationId: row.id, decision: "not_found_released" });
      continue;
    }

    // error — preserve everything for retry, keep hold protected as 'held'.
    await supabase.rpc("mark_sms_booking_recoverable_failure", {
      p_confirmation_id: row.id,
      p_execution_token: executionToken,
      p_failure_class: priorClass,
      p_error_code: "reconcile_error",
      p_last_error: result.detail,
      p_provider_request: null,
      p_provider_response: null,
      p_reconciliation_status: "pending",
    });
    if (row.slot_group_id) {
      await unprotectReservationAfterFailure(supabase, row.slot_group_id, "held").catch(
        () => undefined,
      );
    }
    outcomes.push({
      confirmationId: row.id,
      decision: "error_preserved",
      detail: result.detail,
    });
  }

  return { ok: true, scanned: (rows ?? []).length, claimed, outcomes };
}