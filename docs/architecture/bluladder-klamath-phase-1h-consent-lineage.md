# BluLadder Klamath Phase 1H consent lineage preflight

Status: **hosted migration verified; fail-closed runtime adoption prepared**.
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

## Hosted application

The migration passed its disposable PostgreSQL rehearsal, exact-head CI, and
Secret Scan, then was applied once through Lovable's migration-aware boundary.
Hosted execution version `20260814101915` advanced the ledger from 161 to 162.
The provider-generated receipt is byte-identical to the canonical migration
except for its omitted final newline. Postflight proved required lineage on all
seven consent rows and twenty audit events, zero cross-tenant or orphaned
state, service-role-only organization helper execution, exact RLS/policy and
trigger contracts, and unchanged DFW and inactive Klamath state.

## Fail-closed runtime adoption

The runtime candidate replaces tenant-capable legacy consent calls with one
shared organization-aware boundary:

- queued consent checks use the message's durable `organization_id` and deny
  missing, malformed, or failed authority;
- staff replies load the conversation's persisted organization before consent
  or provider work and keep the legacy direct provider path explicitly DFW-only;
- website chat resolves organization authority from the exact server-side site
  mapping, scopes conversation reads/writes to that organization, and keeps
  non-DFW chat disabled until Klamath pricing, knowledge, and provider adapters
  are independently approved;
- AI consent tools call `record_organization_consent` and cannot report a saved
  decision after missing authority or a rejected RPC.

Focused tests cover exact RPC authority, malformed/missing authority, RPC
failure, fail-closed reads, caller adoption, and the DFW-only compatibility
gates. Deployment remains separate and must include only the reviewed changed
functions after exact-head CI and Secret Scan pass.

No connector, credential, sender, call, email, SMS, customer traffic, or
activation is authorized by this runtime preparation.
