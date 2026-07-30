# Controlled synthetic booking

This pack separates repository dry-run proof from the one hosted workflow that
creates and removes provider and production test records. Nothing in this file
authorizes a hosted write, provider call, secret change, or deployment.

## Mode A — repository dry run

Purpose: prove the request contract, fail-closed launch control, protected
identity checks, replay behavior, and cleanup state machine without connecting
to Supabase or Jobber.

```bash
deno test --allow-all \
  supabase/functions/_shared/publicBookingLaunchGate_test.ts \
  supabase/functions/_shared/publicBookingRelease_contract_test.ts \
  supabase/functions/run-booking-test
npm run test
npm run build
```

Expected result: all tests pass, provider mocks record zero unapproved effects,
and the public gate tests show that a disabled request can perform only input
validation plus the read-only lookup required for an exact completed replay.
It performs no new organization/service decision, authoritative write, or
provider call. This mode may satisfy repository evidence only. It can never
satisfy `SYNTHETIC_BOOKING_PASSED`.

## Mode B — separately authorized hosted run

Use only the existing operations-admin `RunControlledBookingTest` UI. Do not
invoke the Edge Function with `curl` and do not edit the approved test identity.
One authorization permits one run against the server-enforced identity.

### Preconditions

- `REPOSITORY_READY`, `CONFIGURATION_VERIFIED`, `DATABASE_RELEASED`, and
  `DEPLOYMENT_VERIFIED` are PASS in the imported evidence bundle.
- The deployed SHA equals the approved repository SHA.
- `PUBLIC_BOOKING_ENABLED=false` is independently verified and remains false
  throughout the test.
- The approved test identity, DFW service address, email, and phone are
  independently confirmed; Oregon is inactive.
- All campaigns are draft; outbound test suppression is confirmed.
- Jobber connection and schedule mirror are healthy without using a token
  refresh diagnostic.
- One operator, one independent reviewer, a 30-minute window, cleanup access,
  and an incident channel are ready.
- A separate authorization covers one protected runner write, its exact run
  and identity scope, and cleanup. It does not authorize anonymous booking.

### Execution

1. Record before-counts for the protected identity in customers, properties,
   quotes, bookings, reservations, conversations, messages, campaign
   enrollments, Jobber client/job/visit records, and unresolved diagnostics.
2. Open Admin → AI Conversations → Controlled Booking Test and select
   **Prepare**. Preparation may create only test-run/local fixture state.
3. Verify the UI reaches `awaiting_authorization`; compare its address, quote,
   slot, organization, and idempotency key hash to the approved run sheet.
4. Confirm `PUBLIC_BOOKING_ENABLED=false` and the public probes remain blocked.
5. Mint the single-use live Jobber authorization in the operations UI.
6. Select **Execute** once. The runner uses its service-role, server-only run
   header, exact run/idempotency scope, protected identity, and already-consumed
   authorization to enter the one-time booking path without opening anonymous
   traffic. The booking endpoint must synchronously confirm that SMS, email,
   owner notification, and campaign emission were suppressed for the exact
   run. Watch correlation logs and provider state. Do not
   retry a timeout or uncertain result.
7. Run the built-in **Duplicate** phase with the same semantic key. It must
   return the original visit and one local booking.
8. Confirm public booking remained disabled before cleanup or analysis.
9. Run **Cancel & cleanup** with a freshly authenticated operations-admin
   session. Complete any explicitly reported manual Jobber cleanup.
10. Re-run all before-count queries. Active customer/property/quote/booking,
    active Jobber job/visit, provider-accepted message, and active campaign
    deltas must be exactly zero after cleanup. Exactly one canceled local
    booking tombstone and one `booking_test_runs` audit row remain as immutable
    evidence; record both IDs and prove neither is active or deliverable. Only
    that named lineage, the authorization audit result, and restricted external
    evidence records may remain; authorizations must be consumed or expired and
    suppressions must be unchanged.

Expected duration: 25–35 minutes, excluding incident handling.

### Stop immediately

- project, environment, deployed SHA, organization, or identity mismatch;
- public booking becomes enabled while the intended landing containment is not
  proven;
- any non-test identity is read, written, or contacted;
- service-area result is not eligible DFW;
- authorization is missing, reusable, or consumed before final validation;
- more than one customer/property/job/visit/booking effect;
- provider timeout or result uncertainty;
- any SMS/email is accepted by a provider;
- false booking confirmation, cross-tenant lineage, Oregon routing, or a new
  unresolved P0/P1 diagnostic.

On a stop: verify public booking is still disabled, do not resend or retry, preserve
correlation/provider IDs, mark the run aborted, clean up only known test
artifacts, and open an incident for independent review.

### Evidence

Capture UTC timestamps, authorization ID/scope, operator/reviewer, project ref,
deployed SHA/function deployment IDs, admin launch-control screenshots,
sanitized before/after counts, run ID, correlation ID, organization decision,
idempotency-key hash, Jobber IDs, exact phase outputs, duplicate proof,
communication counts, cleanup proof, diagnostics result, and artifact hashes.
Never capture credentials, raw tokens, or unrelated customer data.

The evidence reviewer may set `SYNTHETIC_BOOKING_PASSED` to PASS only after all
required claims in `scripts/evaluate-protected-launch.mjs` are present and the
hashed evidence bundle validates.
