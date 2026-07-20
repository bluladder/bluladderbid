# Protected Live-Test Runbook (§11)

This runbook governs every live production test of BluLadder Bid that
touches real integrations (Jobber, Resend, CallRail, SMS, Google
Calendar). It exists so a controlled test can never mutate a real
customer's record, spam a real number, or leave campaign enrollments
behind.

All campaigns remain in **draft** during and after these tests unless a
separate activation step is explicitly authorized under §12.

## When to use this runbook

Use it for any of the following against production:

- Creating a real Jobber Client / Property / Job / Visit end-to-end.
- Sending a real SMS through CallRail.
- Sending a real email through Resend.
- Exercising the customer-access OTP flow with a live phone number.
- Verifying an activated campaign's first live send.

Do **not** use it for schema changes, admin-only reads, or dry runs that
never leave the sandbox — those don't need authorization.

## Protected test identity

The only phone number and customer record allowed for live tests are
recorded in `mem://testing/approved-test-identity` (owner-approved).
Every live-test edge function (`run-booking-test`,
`customer-access-live-test`, live Jobber write path in `aiTools.ts`)
enforces this identity server-side; a request that doesn't match is
rejected before any provider call.

Never edit the approved identity to route a test elsewhere. If a
different identity is genuinely required, the owner must update
`mem://testing/approved-test-identity` first.

## Authorization primitives already in place

- **`customer_access_test_authorizations`** — single-use override rows
  scoped to the protected identity. Consumed atomically by
  `customer-access-live-test`.
- **Live Jobber authorization** — one-time admin-scoped, single-use
  token that permits exactly one real Jobber write. Enforced in
  `supabase/functions/_shared/aiTools.ts` and consumed by
  `run-booking-test`.
- **Test cleanup helper** — `supabase/functions/_shared/testCleanup.ts`
  removes bookings, quotes, conversations, and campaign enrollments
  attached to the protected identity after a run.
- **Admin panels** — `CustomerAccessLiveTestsPanel.tsx`,
  `LiveJobberTestPanel.tsx`, `RunControlledBookingTest.tsx` are the only
  UIs that mint authorizations or launch a run.

## Pre-flight checklist

Owner or lead operator confirms all of the following **before** issuing
an authorization:

1. `mem://testing/approved-test-identity` matches the identity that will
   receive the test (phone, email, address).
2. Ops health (`OpsHealthPanel`) shows no delivery-failure spike and no
   stalled campaign queue. Resolve or defer if red.
3. Ops alerts panel has no open exceptions that would mask a real
   failure signal from the test.
4. Email suppressions panel confirms the test email is **not**
   suppressed. If it is, remove the suppression entry first.
5. STOP list — confirm the test phone hasn't opted out. Manage-sms-optout
   admin surface can clear it if needed.
6. Campaign status — every campaign that would fire off the test event
   is in `draft` (§12). If a campaign is intentionally active for this
   test, note it in the run record.
7. Rate-limit buckets — no active throttle on the endpoints the test
   will hit (spot-check `rate_limit_buckets` for the identity's key).
8. Jobber connection healthy — verify a recent successful sync log; a
   stale token turns the test into a debugging exercise.
9. A second operator is available on-call for the duration of the run.

## Authorization

One authorization = one run = one integration surface.

1. Owner opens the relevant admin panel:
   - Customer access flows → `CustomerAccessLiveTestsPanel`.
   - Live Jobber write → `LiveJobberTestPanel` /
     `RunControlledBookingTest`.
2. Mint the single-use authorization scoped to the protected identity.
3. Record the authorization ID, the operator's name, and the intended
   scope in the run record (see below).
4. Authorizations expire; do not carry an unused authorization across
   sessions — mint fresh when the run actually starts.

## Execution

1. Operator starts the run from the same admin panel that issued the
   authorization. No CLI, no direct edge-function curl.
2. Watch the Conversations workspace and Ops panels live during the run.
3. Capture the actual customer-facing artifacts:
   - SMS received (screenshot).
   - Email received (screenshot + headers if delivery reliability is
     under test).
   - Jobber Client / Job / Visit URLs.
   - Campaign enrollment rows created (should be zero unless a campaign
     was intentionally activated).
4. Stop immediately and escalate if any of the following occur:
   - A message reaches an identity **other than** the protected one.
   - A second Jobber write is attempted on the same authorization.
   - The campaign engine enrolls the test identity in a campaign that
     wasn't part of the scope.
   - Ops alerts fire a new exception mid-run.

## Post-run cleanup

1. Run `testCleanup` against the protected identity to remove:
   - Test bookings and quotes.
   - Test conversations and inbound messages.
   - Campaign enrollments seeded by the test.
2. Verify in Jobber that the created records were removed or clearly
   marked as test artifacts (naming convention: `TEST — <date> — <ID>`).
3. Confirm the single-use authorization row is consumed / expired.
4. Confirm no residual rate-limit lockout on the protected identity.
5. Confirm email suppression state is unchanged (unless bounce testing
   was the point — then record the resulting suppression row).
6. File the run record (see template).

## Run record template

Append one entry per run to an internal ops log (Notion, Linear, or the
admin runbook doc — wherever the team keeps operational records). CI
does not track this; humans do.

```
Run ID:            <uuid or date-based id>
Date/time (CT):    <YYYY-MM-DD HH:MM>
Operator:          <name>
Second operator:   <name>
Scope:             <customer-access | jobber-write | resend-email | callrail-sms | campaign-activation>
Authorization ID:  <row id from *_authorizations table>
Protected identity match: yes / no  (must be yes)
Pre-flight checklist: all items green? yes / no
Result:            pass / fail / aborted
Artifacts:         <links to screenshots, Jobber URLs, log excerpts>
Cleanup verified:  yes / no
Notes:             <anomalies, follow-ups>
```

## Rollback

If a run mutates something outside the protected identity:

1. Halt further runs immediately; revoke any outstanding authorizations
   from the admin panel.
2. Reverse the mutation in Jobber (delete or annotate the created
   records) and in Supabase (`testCleanup` + targeted deletes).
3. If a real customer was contacted, notify them per the owner's
   guidance; suppress further campaign enrollments for that identity
   until the incident is closed.
4. Open an incident note against the affected edge function and add a
   regression test under `supabase/functions/_shared/*_test.ts` that
   would have caught the identity mismatch. CI (§10) then blocks the
   regression on future PRs.

## Related documents

- `docs/ci-cd.md` — verification gates that back this runbook.
- `docs/edge-function-exposure-matrix.md` — auth posture for each
  live-test edge function.
- `mem://testing/approved-test-identity` — the single source of truth
  for the protected identity.
- `mem://features/live-jobber-test-authorization` — implementation of
  the one-time Jobber write authorization.