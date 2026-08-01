# Voice Provider Verification Checklist

Status: manual checklist for a later explicitly authorized verification window. Nothing in this checklist was executed for this branch.

## Fully automated — completed without credentials or provider calls

- [x] Canonical quote/Edge manifest and pricing mirror parity.
- [x] Quote fingerprint changes for every representative price correction.
- [x] Stale quote, duration, offer, and slot rejection.
- [x] SMS and email state/language mapping for pending, queued, accepted, delivered, retry, uncertain, and terminal failure.
- [x] Address component parsing, bounded attempts, confirmation, and service-area gate.
- [x] Availability status mapping for fresh, stale, timeout, rate limit, unavailable, malformed response, and no slots.
- [x] Booking/reschedule/cancel provider/local outcome matrix and idempotency keys.
- [x] Existing-record identity, ownership, organization, expiry, and supersession gates.
- [x] Forty-scenario end-to-end contract matrix.
- [x] Controller/legacy normalization and canonical-contract parity.

Branch verification on 2026-08-01: 1,111 Edge/Deno tests passed; 850 frontend tests passed with 15 intentionally skipped; TypeScript, ESLint, production build, 22 repository contract commands, three byte-parity comparisons, and `git diff --check` passed. All newly added Edge modules lint clean and are Deno-formatted. The repository-wide Deno format/lint checks still report pre-existing baseline debt and are non-blocking in the current CI workflow. Local Gitleaks/TruffleHog binaries were unavailable; the GitHub Secret Scan workflow remains the authoritative secret check after publication.

## Safe local or sandbox checks — no real credentials and no external mutation

- [x] Replay recorded sanitized provider response fixtures through status classifiers.
- [x] Run a fake Supabase client through existing-record and memo scoping tests.
- [x] Verify duplicate webhook/attempt fixtures remain idempotent.
- [x] Verify customer text never includes provider errors, internal ids, or PII from another record.
- [x] Confirm controller rollout flags remain unchanged and disabled callers remain on the current safe lane.

## Read-only checks requiring real credentials

Ben’s explicit approval is required before any of these. They should be run in a defined maintenance/test window.

- [ ] Confirm the configured DFW organization resolves from server-trusted signals.
- [ ] Read Edge diagnostics/build marker and confirm expected revision.
- [ ] Read Jobber/schedule mirror freshness and compare one non-customer test window with Jobber UI.
- [ ] Confirm service-area and geocoding connectors are configured without exposing keys.
- [ ] Confirm Resend and CallRail webhook authentication/configuration status without sending a message.

Expected evidence: timestamp, environment, build SHA, safe result code, and redacted screenshot/log reference. Do not copy secrets or provider payloads into the PR.

## Tests that may create cost

Ben’s explicit approval is required immediately before each test.

- [ ] One SMS to an approved owned test number; verify queued/provider-accepted/delivered states separately.
- [ ] One email to an approved owned test inbox; verify provider acceptance and delivery webhook.
- [ ] One paid test call only if the owner separately authorizes it.

Stop after the approved count. Verify suppression/allowlist and idempotency first. Record actual provider cost if known.

## Tests that mutate provider or production-like state

Ben’s explicit approval, a dedicated fixture identity, and a cleanup owner are mandatory.

- [ ] Create one Jobber fixture booking from a current canonical quote and slot.
- [ ] Replay the same booking confirmation and prove no duplicate booking.
- [ ] Reschedule the fixture once; prove the old time remains if a controlled rejection is injected.
- [ ] Cancel the exact fixture once; replay and prove idempotence.
- [ ] Simulate accepted-provider/local-persistence-failure only in a sandbox or controlled test double; do not manufacture this state in production.

Before mutation: verify exact fixture customer, organization, quote identity, duration, service area, slot, live authorization, and cleanup procedure. After mutation: reconcile Jobber and local state, then remove or clearly mark the fixture using the approved cleanup process.

## Abort conditions

Stop immediately if identity is ambiguous, organization lineage is missing, quote identity differs, duration is null/zero, service-area status is not eligible, schedule mirror is stale, provider credentials/config are uncertain, the selected slot changed, or the operation could touch a non-fixture customer.
