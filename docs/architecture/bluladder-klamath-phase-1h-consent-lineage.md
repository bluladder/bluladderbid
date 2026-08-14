# BluLadder Klamath Phase 1H consent lineage preflight

Status: **hosted preflight passed; fail-closed migration candidate prepared**.
Klamath remains provisioning and may not send customer traffic.

## Problem boundary

`communication_consent` currently keys SMS and email decisions globally by
recipient identity and consent type. Its audit events inherit only a consent ID.
That shape cannot safely authorize a second organization: a Klamath decision
must not read, overwrite, or satisfy DFW consent, and DFW must not become a
fallback when Klamath organization authority is missing.

Platform-wide legal safety suppression remains separate and continues to take
precedence. Phase 1H concerns organization-owned affirmative consent and its
audit lineage; it does not weaken global STOP, opt-out, or test-identity gates.

## Preflight contract

The exact read-only SQL file is
`supabase/preflight/bluladder_klamath_phase_1h_consent_lineage.sql`. It runs in
a read-only transaction with bounded statement and lock timeouts and rolls back.
The reviewed artifact is 10,235 bytes with SHA-256
`36af87ed6805086b671c9ede90e09554f4f2dff408b6c0fae4cfd0a157fb8100`.
It returns only aggregate, non-PII evidence:

- six prerequisite tables and the current absence of target lineage columns;
- legacy and future organization-aware function presence;
- exact DFW default and provisioning Klamath organization state;
- consent/event counts, parent coverage, orphan and cross-parent conflicts;
- non-DFW parent count and projected organization-scoped identity collisions;
- zero Klamath customer, conversation, booking, and projected-consent state;
- existing RLS and policy counts for both consent tables.

The preflight never reads secret values, emits recipient identities, or changes
the migration ledger.

## Hosted evidence

The exact preflight ran unchanged against the Lovable-hosted database from
merged main `c5ff16e056b09a727cb84d1838e5245e7da43af8`. The transaction rolled back
without writes. It proved:

- six prerequisite tables, two RLS-enabled consent tables, and the expected
  existing policy counts;
- seven consent rows and twenty consent-event rows;
- all seven consent rows are unparented legacy rows, with zero parent
  conflicts, zero orphan parents, and zero non-DFW parents;
- zero orphan consent events and zero projected organization-scoped identity
  collisions;
- one exact active DFW legacy default, one exact provisioning Klamath tenant,
  and zero Klamath customers, conversations, bookings, or projected consents;
- the organization-aware functions and lineage columns are not yet present.

Because every historical row is unparented, the DFW compatibility assignment
is explicit in the migration and guarded by the exact inactive Klamath state.
It is not a runtime `coalesce` or cross-tenant fallback.

## Migration candidate

`supabase/migrations/20260814102000_bluladder_klamath_phase_1h_organization_consent_lineage.sql`
adds required organization lineage to consent and audit rows, replaces global
identity uniqueness with organization-scoped uniqueness, enforces parent and
event lineage with non-callable triggers, and replaces the global helper
implementation with:

- `record_organization_consent`, callable only by `service_role`;
- `consent_allows_for_organization`, callable only by `service_role`;
- legacy-signature DFW wrappers that preserve existing production behavior but
  cannot read or write Klamath consent.

The organization-aware helpers reject missing/inactive organization authority.
RLS preserves reviewed DFW admin access and scopes non-DFW access to active
organization memberships. The migration creates no consent decision, customer,
provider, connector, credential, message, call, or activation surface.

## Fail-closed next step

The migration must pass the disposable PostgreSQL rehearsal, exact-head CI, and
Secret Scan before hosted application is separately approved. After hosted
verification, every Klamath-capable runtime caller must pass persisted,
server-derived organization authority. Missing, ambiguous, or conflicting
authority must fail before a consent write or provider action.

No hosted migration, connector, credential, sender, deployment, call, email,
SMS, customer traffic, or activation is authorized by this preparation.
