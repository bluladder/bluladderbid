// ============================================================================
// Phase 6B.1 safety-correction — TypeScript reference of
// public.claim_sms_booking_execution + mark_sms_booking_terminal_failure,
// exercising every branch of the customer vs reconciliation claim matrix
// and the frozen manual-review semantics.
//
// Spec-mirror of the SQL in the 6B.1 safety-correction migration. Any
// behaviour change in the SQL RPC must be reflected here and vice-versa.
// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";

type Status =
  | "pending" | "executing" | "jobber_created" | "local_committed"
  | "confirmation_pending" | "confirmed"
  | "failed" | "failed_terminal" | "failed_recoverable";

type FailureClass =
  | null
  | "pre_claim_drift" | "input_missing" | "reservation_not_live"
  | "verified_terminal_rejection" | "external_outcome_unknown"
  | "external_committed_pending_local" | "manual_review_required"
  | "legacy_unclassified";

interface Row {
  status: Status;
  failure_class: FailureClass;
  execution_token?: string | null;
  attempt_count?: number;
  presentation_id?: string | null;
}

function claim(row: Row, token: string, source: "customer" | "reconciliation"): any {
  if (["confirmed","local_committed","confirmation_pending","jobber_created"].includes(row.status)) {
    return { ok: false, reason: "already_completed", status: row.status };
  }
  if (row.status === "failed_terminal") {
    return { ok: false, reason: "failed_terminal", failure_class: row.failure_class };
  }
  if (row.failure_class === "manual_review_required") {
    return { ok: false, reason: "manual_review_required", failure_class: row.failure_class };
  }
  if (row.status === "executing") {
    if (row.execution_token && row.execution_token !== token) {
      return { ok: false, reason: "in_progress", execution_token: row.execution_token };
    }
    return { ok: true, resumed: true };
  }
  if (source === "reconciliation" && row.status === "pending") {
    return { ok: false, reason: "customer_owned", status: "pending" };
  }
  if (source === "customer" && ["failed","failed_recoverable"].includes(row.status) && row.failure_class === null) {
    return { ok: false, reason: "reconciliation_only", failure_class: "legacy_unclassified" };
  }
  if (row.status === "failed_recoverable") {
    const reconOwned = new Set(["external_outcome_unknown","external_committed_pending_local","legacy_unclassified"]);
    if (source === "customer") {
      if (row.failure_class && reconOwned.has(row.failure_class)) {
        return { ok: false, reason: "reconciliation_only", failure_class: row.failure_class };
      }
    } else {
      if (!row.failure_class || !reconOwned.has(row.failure_class)) {
        return { ok: false, reason: "customer_owned", failure_class: row.failure_class };
      }
    }
  }
  if (!["pending","failed","failed_recoverable"].includes(row.status)) {
    return { ok: false, reason: "invalid_state", status: row.status };
  }
  row.status = "executing";
  row.execution_token = token;
  row.attempt_count = (row.attempt_count ?? 0) + 1;
  return { ok: true, claim_source: source };
}

function markTerminal(row: Row, token: string, failureClass: string): any {
  if (failureClass !== "verified_terminal_rejection") {
    return { ok: false, reason: "invalid_failure_class", failure_class: failureClass };
  }
  if (["local_committed","confirmation_pending","confirmed"].includes(row.status)) {
    return { ok: false, reason: "already_committed" };
  }
  if (row.status === "executing" && row.execution_token !== token) {
    return { ok: false, reason: "token_mismatch" };
  }
  const releasedHold = !!row.presentation_id;
  row.status = "failed_terminal";
  row.failure_class = "verified_terminal_rejection";
  return { ok: true, failure_class: failureClass, released_hold: releasedHold };
}

Deno.test("6B.1s.1 — reconciliation cannot claim pending", () => {
  const row: Row = { status: "pending", failure_class: null };
  const r = claim(row, "t", "reconciliation");
  assertEquals(r.ok, false);
  assertEquals(r.reason, "customer_owned");
  assertEquals(row.status, "pending");
});

Deno.test("6B.1s.1b — customer CAN claim pending", () => {
  const row: Row = { status: "pending", failure_class: null };
  assertEquals(claim(row, "t", "customer").ok, true);
  assertEquals(row.status, "executing");
});

Deno.test("6B.1s.2 — customer cannot claim external_outcome_unknown", () => {
  const r = claim({ status: "failed_recoverable", failure_class: "external_outcome_unknown" }, "t", "customer");
  assertEquals(r.ok, false); assertEquals(r.reason, "reconciliation_only");
});

Deno.test("6B.1s.3 — reconciliation CAN claim external_outcome_unknown", () => {
  const r = claim({ status: "failed_recoverable", failure_class: "external_outcome_unknown" }, "t", "reconciliation");
  assertEquals(r.ok, true);
});

Deno.test("6B.1s.4 — customer cannot claim external_committed_pending_local", () => {
  const r = claim({ status: "failed_recoverable", failure_class: "external_committed_pending_local" }, "t", "customer");
  assertEquals(r.ok, false); assertEquals(r.reason, "reconciliation_only");
});

Deno.test("6B.1s.5 — reconciliation CAN claim external_committed_pending_local", () => {
  const r = claim({ status: "failed_recoverable", failure_class: "external_committed_pending_local" }, "t", "reconciliation");
  assertEquals(r.ok, true);
});

Deno.test("6B.1s.6 — neither source can claim manual_review_required", () => {
  for (const source of ["customer","reconciliation"] as const) {
    const row: Row = { status: "failed_recoverable", failure_class: "manual_review_required" };
    const r = claim(row, "t", source);
    assertEquals(r.ok, false);
    assertEquals(r.reason, "manual_review_required");
    assertEquals(row.status, "failed_recoverable");
  }
});

Deno.test("6B.1s.7 — manual-review escalation preserves the hold", () => {
  // Terminal RPC refuses manual_review_required → hold is not released,
  // ledger row is not moved to failed_terminal.
  const row: Row = { status: "executing", failure_class: null, execution_token: "t", presentation_id: "pres-1" };
  const r = markTerminal(row, "t", "manual_review_required");
  assertEquals(r.ok, false);
  assertEquals(r.reason, "invalid_failure_class");
  assertEquals(row.status, "executing");
});

Deno.test("6B.1s.8 — two reconciliation workers cannot claim the same row", () => {
  const row: Row = { status: "failed_recoverable", failure_class: "external_outcome_unknown" };
  assertEquals(claim(row, "A", "reconciliation").ok, true);
  const w2 = claim(row, "B", "reconciliation");
  assertEquals(w2.ok, false);
  assertEquals(w2.reason, "in_progress");
});

Deno.test("6B.1s.9 — customer + reconciliation cannot both win the same row", () => {
  // pending → customer wins, recon refused (customer_owned or in_progress).
  const rowA: Row = { status: "pending", failure_class: null };
  assertEquals(claim(rowA, "cust", "customer").ok, true);
  const other = claim(rowA, "recon", "reconciliation");
  assert(!other.ok);
  // recoverable+external → recon wins, customer refused.
  const rowB: Row = { status: "failed_recoverable", failure_class: "external_outcome_unknown" };
  assertEquals(claim(rowB, "recon", "reconciliation").ok, true);
  assert(!claim(rowB, "cust", "customer").ok);
});

Deno.test("6B.1s.10 — customer retries pre_claim_drift / input_missing / reservation_not_live", () => {
  for (const fc of ["pre_claim_drift","input_missing","reservation_not_live"] as const) {
    const row: Row = { status: "failed_recoverable", failure_class: fc };
    assertEquals(claim(row, "t", "customer").ok, true, `class=${fc}`);
  }
});

Deno.test("6B.1s.11 — recon refused on customer-owned classes", () => {
  for (const fc of ["pre_claim_drift","input_missing","reservation_not_live"] as const) {
    const row: Row = { status: "failed_recoverable", failure_class: fc };
    const r = claim(row, "t", "reconciliation");
    assertEquals(r.ok, false, `class=${fc}`); assertEquals(r.reason, "customer_owned");
  }
});

Deno.test("6B.1s.12 — legacy_unclassified: customer refused, reconciliation allowed", () => {
  assertEquals(claim({ status: "failed_recoverable", failure_class: "legacy_unclassified" }, "t", "customer").reason, "reconciliation_only");
  assertEquals(claim({ status: "failed_recoverable", failure_class: "legacy_unclassified" }, "t", "reconciliation").ok, true);
});

Deno.test("6B.1s.13 — verified terminal rejection is still legal and releases hold", () => {
  const row: Row = { status: "executing", failure_class: null, execution_token: "t", presentation_id: "pres-1" };
  const r = markTerminal(row, "t", "verified_terminal_rejection");
  assertEquals(r.ok, true); assertEquals(r.released_hold, true);
  assertEquals(row.status, "failed_terminal");
});
