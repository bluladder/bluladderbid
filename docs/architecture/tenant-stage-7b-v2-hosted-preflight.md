# Tenant authority Stage 7B v2 hosted preflight

Status: schema preparation merged at
`e8709faad8663bf9d9cd903b81985e7bedcb00bf`; post-merge production preflight
and the single authorized stop-gate lineage investigation were re-run on
2026-08-01 through the Lovable-managed database connection. All statements
were `SELECT`. No write was executed and no migration was applied. The targeted
investigation selected only UUIDs, organization lineage, lifecycle
timestamps/statuses, and boolean provider-link indicators; it did not select
names, addresses, phone numbers, email addresses, messages, notes, or raw
provider identifiers.

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
helper is absent. All four Data API views use `security_invoker`;
`technicians_public` stores the equivalent PostgreSQL option spelling
`security_invoker=on`, while the other three store `security_invoker=true`.
Default privileges left all four views' grants broader than their intended
read-only surface. The migration normalizes the option and narrows the view
grants without weakening underlying RLS.

The `technicians_public` name and view-level anonymous grant do not currently
amount to anonymous row visibility: its underlying `technicians` table has no
anonymous SELECT policy and the invoker view obeys that RLS boundary. This PR
does not invent a new public-technician policy. Product intent for that view is
a separate owner/security decision.

One first-wave quote row is live with two defect signals: null quote ownership
and a quote/customer ownership mismatch. The targeted review confirmed both
signals are quote `9b55aaa5-1a98-462a-9d71-edc2ea128e03`, whose customer is
`c867029e-2d5a-498f-9226-32533c5a1665` and whose property is null. The customer
is scoped to the active, explicitly designated legacy organization
`b1addf00-0000-4000-8000-000000000001`; the quote has no competing parent.
Customers, properties, and bookings had zero nulls and zero reported
mismatches. The migration's aggregate stop predicate currently matches that
one row. The repository migration includes an executable stop gate and will
abort until a separately approved production-data action resolves it. The
exact PII-free evidence and review-only transaction are in
`tenant-stage-7b-v2-remediation-plan.md`.

## Second-wave evidence

`quote_sessions` and `chat_conversations` are the narrow second wave because
they are the durable capability/session roots used before the voice controller
can load an existing quote, memo, reschedule, or cancel safely. Neither table
currently has `organization_id`.

Aggregate-only lineage analysis produced:

| Table | Rows | Exactly one parent organization | No parent authority | Conflicting parents |
|---|---:|---:|---:|---:|
| `quote_sessions` | 20 | 0 | 20 | 0 |
| `chat_conversations` | 33 | 2 | 31 | 0 |

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

PR #65 is now deliberately limited to schema preparation. It includes:

1. Parent-derived lineage repair for new `quotes` and `bookings`, including
   property and customer consistency.
2. Nullable ownership for `quote_sessions` and `chat_conversations` with
   parent-only backfill, validated foreign keys, indexes, lineage triggers,
   restrictive authenticated RLS, and explicit Data API grants.
3. Read-only grant hardening for the four current Data API views.
4. Executable contract and PostgreSQL 17.6 rehearsal checks for migration
   reruns, both first-wave defect classes, second-wave conflicts, transaction
   rollback, old-runtime/new-schema compatibility, RLS, grants, service-role
   behavior, and view security.

The canonical organization-authority resolver, Supabase adapter, voice adapter,
quote-session predicates, controller persistence, readiness, availability, and
booking consumers are preserved on the dependent
`codex/tenant-authority-runtime-stage-7b-v2` branch. They are not part of PR
#65 and must not merge or deploy until the migration has been applied and
verified.

All other tenant-sensitive tables remain deferred. Their organization must be
copied from a verified parent or provider mapping in later waves; inferring it
from phone, email, a client UUID, or a global DFW default would weaken
isolation. Global uniqueness changes, second-organization activation, provider
configuration, customer-auth creation, property creation, queues, campaigns,
and provider synchronization are not part of this tranche.

## Merge, migration, runtime, and recovery sequence

GitHub Actions contains no deployment job. Lovable documentation states that
the default GitHub branch synchronizes automatically into the Lovable project,
while the published site remains a manually updated snapshot. The project is
currently published and Lovable now records merged schema-only main SHA
`e8709faad8663bf9d9cd903b81985e7bedcb00bf` as its latest project commit. No
publish action was taken during the post-merge investigation.
No documented atomic guarantee was found that orders GitHub-to-Lovable Edge
Function publication after database migration application. PR #65 therefore
contains no changed runtime consumer and enforces byte parity with the baseline
for every previously changed Edge path.

Merging PR #65 can synchronize repository content into Lovable development or
preview, but it cannot execute Stage 7B v2 runtime consumption because that
code is absent. The migration file must remain unapplied until the stop gate is
clear. Once it is applied, the unchanged runtime can continue creating and
linking explicitly unscoped sessions during the controlled transition; the
database preserves null provenance instead of inventing tenant authority.

The repository migration is forward-only and must not be applied by this PR.
An approved future release must:

1. Merge the schema-preparation PR without publishing or applying it.
2. Re-run the aggregate preflight and review the parameterized remediation plan
   in `tenant-stage-7b-v2-remediation-plan.md`.
3. Under separate production-data approval, establish the affected quote's
   organization from trusted customer/property/provider lineage and remediate
   only that approved row. Never infer DFW from organization count.
4. Stop if either first-wave defect class or any second-wave parent conflict
   remains.
5. Apply the additive migration by an explicitly approved operator.
6. Verify foreign keys, indexes, RLS policy shapes, grants, invoker views,
   trigger execution privileges, unresolved-null preservation, and zero
   cross-parent lineage.
7. Configure and verify provider/site mappings under separate approval.
8. Only then merge and deploy the dependent runtime-consumption PR.

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
place. PR #65 prepares the database boundary only; it does not enable typed
runtime authority, tenant-scoped session persistence, or customer-facing voice
actions.
