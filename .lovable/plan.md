# Controlled AI-chat booking test runner

Goal: one admin-guided end-to-end runner that prepares, executes, verifies, cancels and cleans up a single controlled Jobber booking for the approved protected test identity — with exactly one human action (an operations-admin authorization) immediately before the live Jobber write. It reuses every existing system and adds no second booking or orchestration path.

## Architecture (minimize new surface)

Add **one** admin-only backend coordinator and **one** progress table. Everything else is reused:

- AI conversation + state machine (`ai-chat` → `runOrchestrator` → `aiTools`).
- Live-test authorization RPCs (`authorize_live_jobber_test`, `consume_live_jobber_authorization`, `clear_live_jobber_authorization`) — unchanged.
- Booking path (`create_bluladder_booking` tool → `jobber-create-booking`) — unchanged.
- Cancellation path (`customer-appointment-actions` cancel) — unchanged.
- Test suppression (`test_identities`, `_shared/suppression.ts`), slot reservations, idempotency, availability freshness, server-authoritative pricing — all unchanged and relied on, never bypassed.

### New backend: `supabase/functions/run-booking-test/index.ts`
Admin-only (via `_shared/auth.ts` `requireAdminOrService`, min `operations_admin`). A phased coordinator that calls existing systems only — it never talks to Jobber directly and never issues an authorization itself.

Phases (each writes step progress to the run record and stops safely on failure):

- `prepare` — runs spec steps 1–17:
  1. geocode eligible (`validate_service_area` via a fresh test conversation)
  2. schedule freshness OK (`scheduleFreshness`)
  3. no unsafe sync in progress
  4. permanent test suppression active (protected `test_identities` row)
  5. global suppression off (`system_test_config.suppress_all`)
  6. no unresolved prior test booking (auth status `not_authorized`)
  7. create clean test conversation (protected identity contact + address)
  8. request configured residential window-cleaning quote (`calculate_bluladder_quote`)
  9. supply approved property details
  10. confirm canonical firm quote
  11. retrieve compacted weekday availability (`get_bluladder_availability`)
  12. pick a slot ≥ 7 days out
  13. store selected slot on the conversation
  14. advance to `awaiting_booking_confirmation`
  15. ambiguous-confirmation check: send `"That sounds good."` → assert NO booking tool ran / no Jobber write
  16. confirm no booking/Jobber write occurred
  17. compute the exact scoped authorization values (conversation id, slot id, derived idempotency key `chat|<convId>|<slotId>`, expiry preview) — does NOT authorize.
  Returns the prepared checkpoint payload for the UI.

- `execute` — only after the UI has called `authorize_live_jobber_test` (verified by reading the protected identity's authorization row = `authorized` and scoped to this convo+slot+key). Then:
  - submit `"Yes, book this appointment."` through the same chat path → one reservation, one Jobber client match/create, one job, one visit, valid visit id, America/Chicago time, correct technician, correct line items/total, state `booked`, authorization `consumed`, and asserts no SMS/email/campaign/CallRail/internal alert delivered (suppression).

- `duplicate` — replay the exact confirmation with the same idempotency key; assert original result returned, no second booking/job/visit/reservation. No different-slot/destructive concurrency test.

- `cancel_cleanup` — call existing cancellation (`customer-appointment-actions` cancel, admin override); verify visit removed, local booking cancelled, busy block cancelled, reservation released, slot returns to availability, suppressed queued messages cancelled, temporary enrollments stopped, one-time authorization cleared (`clear_live_jobber_authorization`), protected identity still active+protected. Cleanup temporary conversation/messages/events/enrollments and safe suppressed delivery records via the canonical `_shared/testCleanup.ts` partition (never deletes protected identity, never deletes pre-existing customers). If a visit-less Jobber job cannot be deleted via API, it is NOT auto-deleted — the job number is reported for manual deletion.

- `resume` — allowed only when idempotency makes it safe (re-enter `execute`/`duplicate`/`cancel_cleanup` from the stored safe checkpoint). Never creates a second authorization, never auto-retries a live write from an unknown state.

Fail-safe: any precondition/verification failure stops immediately, does not advance, preserves diagnostic records, records the exact safe failure stage + safe technical reason + correlation id, and never auto-retries live writes.

### New table: `public.booking_test_runs`
Stores run progress so the UI can render step status and support safe resume.
Columns: `id uuid pk`, `correlation_id text`, `created_by uuid`, `phase text`, `status text`, `conversation_id uuid`, `slot_id text`, `idempotency_key text`, `booking_id uuid`, `jobber_job_id text`, `jobber_visit_id text`, `steps jsonb` (array of `{key,label,status,startedAt,finishedAt,reason}`), `checkpoint text`, `last_error text`, `created_at`, `updated_at`.
RLS: operations-admin read/write via `has_admin_level`; `GRANT` to `authenticated` + `service_role`; no `anon`. Migration follows the required CREATE→GRANT→ENABLE RLS→POLICY order.

## Frontend: `RunControlledBookingTest.tsx`
Compact runner card added to **Admin → Integrations → AI Conversations** (rendered inside `ConversationDashboard`, gated by `canOverrideBookings` / operations-admin). Reuses existing UI primitives and the `liveJobberTest.ts` derivation helpers.

- "Run controlled booking test" button → calls `run-booking-test` `prepare`. Shows step-by-step status (Pending / Running / Passed / Failed / Skipped / Requires admin action) with correlation id, timestamps, safe reason, and links to the conversation/booking/Jobber job+visit when available.
- Human checkpoint: single button `Authorize and run one live Jobber test`, showing test identity, conversation id, selected slot, appointment date/time, technician, quote total, engine/rule versions, idempotency key, authorization expiry, message suppression status, and the warning that one Jobber job + visit will be created. Conversation id / slot id / idempotency key are read-only. On confirm (operations-admin AlertDialog) it calls the existing `authorize_live_jobber_test` RPC, then calls `run-booking-test` `execute` → `duplicate` → `cancel_cleanup` automatically.
- "Resume from safe checkpoint" appears only when the run record marks a resumable checkpoint.

The existing per-conversation `LiveJobberTestPanel` stays as-is; the new runner is the automated orchestration layer on top of the same RPCs and functions.

## Tests
Deno tests for the coordinator's pure logic (extracted into `run-booking-test/testRunLogic.ts` so it is unit-testable without live calls) + a Vitest for the React runner where practical:
1. Non-admin cannot run (auth gate).
2. No live booking before authorization (execute refuses without `authorized` scope).
3. Precondition failure stops the run.
4. Ambiguous confirmation produces no booking.
5. Authorization scope is exact (convo+slot+derived key).
6. Explicit confirmation creates exactly one booking (mocked booking result → single reservation/job/visit assertions).
7. Duplicate replay creates no duplicate (same key → original result).
8. Cancellation removes the visit.
9. Slot returns to availability.
10. Suppression remains active.
11. Authorization cleared after cleanup.
12. Protected identity survives cleanup (via `testCleanup` partition).
13. Existing booking/cancellation/liveJobberTest tests remain green.

## Safety guarantees
- Only reused paths perform side effects; the coordinator orchestrates, it does not re-implement booking/cancellation.
- No live Jobber write happens during implementation or during `prepare`; the only live write is after the explicit human authorization.
- No secrets in frontend; all privileged work is server-side and admin-gated.

## Notes / decisions
- The runner uses the already-approved protected identity (BluLadder Booking Test / blmillen@gmail.com / +14692150144 / 720 Parkland Dr, Aubrey, TX 76227). It never creates or deletes that identity.
- I will not trigger the live booking myself; after building I will confirm build + tests are green and leave the one-click controlled test for you to run.
