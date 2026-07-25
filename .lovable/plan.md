# Fix: Reconciliation silently fails to finalize bookings recovered from Jobber

## Confirmed root causes (in `supabase/functions/_shared/smsBookingReconcile.ts` matched branch)

1. **Wrong `p_presentation_id`** — passes `null`. The RPC `commit_sms_booking_success` compares against `v_row.presentation_id` (set at insert time) and returns `presentation_mismatch`.
2. **Wrong `p_booking_id`** — passes the Jobber GraphQL node id (opaque base64) into a UUID-typed parameter. Postgres rejects the call at parameter binding; the RPC body never runs.
3. **Silent failure** — the call site reads only `data`, never `error`. A rejected RPC returns `data: null`, so `commitRes.ok === false` is skipped and the row is reported as `matched_committed`. The ledger stays in `executing` forever (subsequent ticks only scan `failed_recoverable`), the reservation stays in `executing` protection, and no confirmation SMS is emitted.
4. **Matched branch never consumes/releases the reservation protection**, unlike `not_found`/`error` branches.
5. **Matched branch never emits the customer "You're booked" outbox SMS** — that message normally fires from `handleConfirmationReply` after a normal commit, which reconciliation bypasses.

## Fix

### 1. New migration: `reconcile_sms_booking_matched` RPC

Dedicated to reconciliation — the shape mismatch with `commit_sms_booking_success` is intentional (no local `bookings` row, no presentation from the caller).

Behavior:
- `SELECT ... FOR UPDATE` the ledger row.
- Idempotent replay: if `status IN ('local_committed','confirmation_pending','confirmed')` and `jobber_job_id = p_jobber_job_id`, return `{ ok: true, idempotent: true, ... }`.
- Require `status = 'executing'` and `execution_token = p_execution_token`, else return typed reason.
- Use the row's own `presentation_id` and `slot_group_id` — do not accept them from the caller.
- Update ledger: `status = 'local_committed'`, set `jobber_job_id`, `jobber_visit_id`, `reference_number`, `booking_result`, `provider_response = { reconciled: true, source: 'jobber_search' }`, `booked_at`, `local_committed_at`. Leave `booking_id` NULL (no local bookings row exists — reconciliation only has Jobber IDs).
- Consume the presentation hold (`sms_availability_presentations.status = 'consumed'`, `hold_status = 'consumed'`, `hold_released_at`, `hold_release_reason = 'consumed_by_reconciliation'`).
- Consume the underlying `slot_reservations` row for `slot_group_id`: transition `executing`/`held` → `consumed` (matches semantics used by the normal commit path).
- REVOKE from PUBLIC/anon/authenticated, GRANT EXECUTE to service_role.

### 2. `smsBookingReconcile.ts` matched branch

Replace the `commit_sms_booking_success` call with `reconcile_sms_booking_matched`. Read **both** `data` and `error`:

```ts
const { data: commit, error: commitErr } = await supabase.rpc(
  "reconcile_sms_booking_matched",
  { p_confirmation_id: row.id, p_execution_token: executionToken,
    p_jobber_job_id: result.jobberJobId,
    p_jobber_visit_id: result.jobberVisitId,
    p_reference_number: result.referenceNumber });
if (commitErr || (commit as any)?.ok === false) {
  outcomes.push({ confirmationId: row.id, decision: "commit_denied",
    detail: commitErr?.message ?? (commit as any)?.reason ?? "commit_denied" });
  // Requeue as reconcile-owned so we try again next tick.
  await supabase.rpc("mark_sms_booking_recoverable_failure", { ... priorClass ... });
  continue;
}
```

After a successful commit, enqueue the customer confirmation SMS via the existing outbox path used by `handleConfirmationReply` (same rendering + `bookingTimezone` resolution + `claim_sms_outbox_send`/`finalize_sms_outbox_send`), keyed by an idempotency string like `reconcile:<confirmationId>:confirm-sms`.

### 3. Tests

- Update `smsBookingReconcile_test.ts`:
  - Matched branch now calls `reconcile_sms_booking_matched` (assert RPC name + args).
  - Simulate rpc `error` — assert decision is `commit_denied`, not `matched_committed`.
  - Simulate rpc `{ ok: false, reason: 'not_executing' }` — same.
  - Assert the confirmation outbox enqueue is invoked exactly once on success and is idempotent on replay.
- Migration smoke via existing test infra if applicable.

## Out of scope

- Any change to `commit_sms_booking_success` (still used by the normal handleConfirmationReply path with correct args).
- Broader Jobber recovery search behavior (`jobberBookingRecovery.ts` is unchanged).
- Any change to the not_found / error branches (already correct).
