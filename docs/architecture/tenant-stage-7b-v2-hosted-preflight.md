# Tenant authority Stage 7B v2 hosted preflight

Status: repository implementation preflight at baseline
`388d9849a9bfa187faa8122e82b37ef4965b2364`. All hosted queries were
metadata-only or aggregate-only `SELECT` statements executed through the
Lovable-managed database connection. No customer or operational row was
selected, no write was executed, and no migration was applied.

## Target and migration ledger

- Lovable workspace: `B4aFaODpdbgZgxKbuI5y`
- Lovable project: `b6e0d823-59c4-4b5a-afbe-182485e5458b`
- Expected Supabase project reference: `gyndziiuizpgwhqwyrvn`
- Database: PostgreSQL 17.6, database/user `postgres`
- Hosted migration ledger: 149 rows; latest version `20260731040935`
- Hosted Stage 7B version: `20260730072508`
- Stage 7B release provenance: one committed row named
  `tenant-foundation-stage-7b-lovable-v1`

The four latest hosted migration statement hashes exactly match the repository
files:

| Version | Repository MD5 |
|---|---|
| `20260730072508` | `e2044ddcc7b42d37c77a8db4965b4b6d` |
| `20260730144924` | `12f2723000058bf637bccb711c85835a` |
| `20260730171245` | `4014cdc7fbd705412d372ce78ae5781d` |
| `20260731040935` | `429be07a8ae2b620554f7188e5b08204` |

The earlier provenance gap is resolved: hosted migration `20260128005316`
contains the origins for `big_job_settings`, `eligibility_rules`, and
`schedule_blocks`. These tables remain outside this tranche because none is an
authority root for a voice conversation or quote session.

## Existing Stage 7B state

The hosted database contains `organizations`, `organization_memberships`, and
`organization_resolution_keys`; the canonical DFW organization is active and
has one active administrator membership. The first-wave `customers`,
`properties`, `quotes`, and `bookings` tables have nullable `organization_id`
foreign keys, indexes, RLS, corrected non-recursive membership helpers, and
validated organization foreign keys.

The hardened `tenant_security` helpers are `SECURITY DEFINER`, owned by
`postgres`, use `search_path=pg_catalog`, and are executable only by
`authenticated`. The old caller-selectable `public.is_organization_member`
helper is absent. The four Data API views use `security_invoker`, although
default privileges left their grants broader than their intended read-only
surface.

One first-wave defect is live: aggregate reconciliation found one quote with a
null organization and one quote/customer organization mismatch. Customers,
properties, and bookings had zero nulls and zero reported mismatches. This
repository tranche prevents new parented quotes/bookings from remaining
unscoped, but does not modify the hosted row. The repository migration includes
an executable stop gate and will abort while either defect remains. Hosted
remediation remains a separately approved production-data action and a release
gate.

## Second-wave evidence

`quote_sessions` and `chat_conversations` are the narrow second wave because
they are the durable capability/session roots used before the voice controller
can load an existing quote, memo, reschedule, or cancel safely. Neither table
currently has `organization_id`.

Aggregate-only lineage analysis produced:

| Table | Rows | Exactly one parent organization | No parent authority | Conflicting parents |
|---|---:|---:|---:|---:|
| `quote_sessions` | 20 | 0 | 20 | 0 |
| `chat_conversations` | 32 | 2 | 30 | 0 |

The migration therefore backfills only rows with exactly one organization
derived from existing customer, confirmed-email customer, property, quote, or
quote-session parents. It leaves zero-match rows null and aborts on a conflict.
It does not assign DFW by default.

Both tables already have RLS, but hosted default privileges grant broad table
privileges to `anon` and `authenticated`. Existing product intent is backend
service-role access, authenticated read access for administrators, and
authenticated update access only for conversation administration. The forward
migration narrows these Data API grants and adds a restrictive tenant policy.
Unscoped legacy rows remain visible only to an explicit platform administrator;
ordinary organization members cannot see them. Restrictive `WITH CHECK`
predicates make that compatibility read-only until an administrator assigns a
verified active organization; no unscoped row is accepted as runtime authority.

No organization resolution keys are configured in hosted data. Provider-,
site-, and DID-derived authority must therefore return `missing_authority`
until an approved mapping is installed in a later controlled configuration
step. A provider signature/shared secret authenticates the sender but does not
identify a tenant.

## First-wave decision and deferred surfaces

This tranche includes:

1. Parent-derived lineage repair for new `quotes` and `bookings`, including
   property and customer consistency.
2. Nullable ownership for `quote_sessions` and `chat_conversations` with
   parent-only backfill, validated foreign keys, indexes, lineage triggers,
   restrictive authenticated RLS, and explicit Data API grants.
3. Read-only grant hardening for the four current Data API views.
4. A canonical server-side organization-authority resolver and organization
   predicates for quote-session persistence.

All other tenant-sensitive tables remain deferred. Their organization must be
copied from a verified parent or provider mapping in later waves; inferring it
from phone, email, a client UUID, or a global DFW default would weaken
isolation. Global uniqueness changes, second-organization activation, provider
configuration, customer-auth creation, property creation, queues, campaigns,
and provider synchronization are not part of this tranche.

## Migration sequence, verification, and recovery

The repository migration is forward-only and must not be applied by this PR.
An approved future release must:

1. Re-run the aggregate preflight and remediate the hosted quote mismatch under
   separate data-change approval.
2. Stop if any second-wave parent evidence conflicts.
3. Apply the additive migration before deploying runtime code that selects the
   new columns.
4. Verify foreign keys, indexes, RLS policy shapes, grants, invoker views,
   trigger execution privileges, and zero cross-parent lineage.
5. Configure and verify provider/site mappings before enabling any sensitive
   voice flow.

Rollback is a reviewed forward migration: disable runtime consumption first,
restore the prior policies/grants and trigger definitions, and retain ownership
columns and captured lineage for diagnosis. Do not drop organization columns or
erase resolved ownership. Unresolved legacy rows remain null throughout.

## Voice handoff boundary

The canonical precedence is resource capability/session, active membership,
provider mapping, site mapping, explicitly permitted territory, then only an
explicitly bounded legacy route. Conflicting, inactive, ambiguous, missing, or
lookup-failed evidence blocks. Caller ID, phone number, email, arbitrary client
organization IDs, and unmapped provider identifiers are never authority.

PR #63's existing-record, memo, reschedule, and cancellation gates remain in
place. Stage 7B v2 supplies typed authority and tenant-scoped session
persistence; it does not enable those customer-facing voice actions.
