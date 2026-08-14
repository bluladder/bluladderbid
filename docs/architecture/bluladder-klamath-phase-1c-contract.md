# BluLadder Klamath Phase 1C inactive hosted-foundation contract

Status: **applied inactive hosted foundation**. Hosted execution version:
`20260814050336`. The committed execution receipt is the canonical migration
with only its terminal line feed removed, and the generated Supabase types now
include exactly the two Phase 1C tables. This status does not authorize
deployment, provider setup, credentials, purchases, calls, messages, customer
traffic, or additional Lovable credit use.

## Outcome

Phase 1C applied one transactional, fail-closed migration for the hosted
Klamath foundation. It created only:

- one `provisioning`, non-default BluLadder Klamath organization;
- organization settings for the approved brand, Pacific timezone, US locale,
  USD, empty active weekdays, and owner-confirmation-required business hours;
- one exact `klamath.bluladder.com` site record with provisioning mapping,
  runtime routing off, publication off, and customer traffic off;
- one disabled SHA-256 hostname authority key;
- inactive Klamath and Lake County include rules;
- six inactive/manual-review service records;
- one independent version-1 draft pricing snapshot with runtime disabled; and
- RLS-protected site and pricing tables with organization-scoped policies.

The migration creates no membership, contact destination, JobTread mapping,
Twilio or Vapi identity, credential, customer, appointment, quote, outbox
record, message, provider request, background job, or active business rule.

## Stop gates and isolation

The migration locks only the seven existing tenant-foundation tables for its
short transaction and aborts before writing if a prerequisite table is absent,
either new target table already exists, the planned organization ID or slug is
occupied, or the canonical hostname hash is already mapped.

Database constraints prevent a provisioning site from enabling runtime
routing, publication, or customer traffic. Draft pricing cannot be runtime
enabled. The exact hostname is unique and rejects unsafe/non-normalized host
shapes. RLS exposes neither new table to anonymous users; authenticated access
uses direct active-membership and active-organization predicates. It does not
recreate or depend on the retired public `SECURITY DEFINER` membership helper.
There is no DFW fallback and the DFW organization is not updated.

During application, the migration revoked table defaults from both
`anon` and `authenticated`, then restores only CRUD privileges for
`authenticated` under RLS and full server access for `service_role`. This
prevents hosted default privileges from retaining `REFERENCES`, `TRIGGER`, or
`TRUNCATE` on the two Phase 1C tables.

The Phase 1C preflight also requires the four Stage 8A tables to expose exactly
authenticated CRUD privileges, so Phase 1C cannot run ahead of the separately
reviewed Stage 8A grant repair.

## Repository verification

- `supabase/preflight/bluladder_klamath_phase_1c.sql` is a read-only hosted
  prerequisite/collision check for a future separately authorized window.
- `supabase/verification/bluladder_klamath_phase_1c.sql` reads sanitized
  counts/statuses only and proves every activation surface remains closed.
- `scripts/rehearse-bluladder-klamath-phase-1c-postgres.sh` applies the exact
  payload only to disposable CI PostgreSQL, verifies RLS/constraints and DFW
  preservation, and proves collision rollback.
- `scripts/check-bluladder-klamath-phase-1c.mjs` machine-checks the repository
  boundary and pricing-snapshot parity.

## Hosted evidence and activation boundary

The exact preflight and postflight passed against the hosted database. The
ledger contains one correlated provider-generated execution row, and the DFW
organization and resolution fingerprints remained unchanged. Klamath remains
unable to receive traffic: runtime reads, contact/provider resources, JobTread
integration, messaging registration, deployment, testing, and final activation
remain later phases. Activation remains separately gated.

Rollback is forward-safe: stop later rollout and prepare a reviewed corrective
migration. Do not delete the organization, erase lineage, rewrite migration
history, or improvise destructive SQL.
