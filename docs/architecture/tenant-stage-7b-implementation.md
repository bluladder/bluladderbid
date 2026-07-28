# Tenant foundation Stage 7B

This stage is repository implementation only. The migration has not been applied
to hosted Supabase.

## Reconciliation and first wave

Generated types contain 96 tables; repository migrations create 93. The missing
origins are `big_job_settings`, `eligibility_rules`, and `schedule_blocks`.
Because their live creation history cannot be proven from the repository, Stage
7B does not alter them. A hosted read-only ledger/schema check remains mandatory
before expanding the wave.

The first wave is `customers`, `properties`, `quotes`, and `bookings`. These are
repository-created authoritative roots with direct quote-to-booking lineage.
Sessions, tokens, customer/property joins, provider state, queues, derived rows,
configuration, and audit tables are deferred so their organization can later be
copied from an authoritative first-wave parent instead of guessed.

## Migration behavior

`20260728060000_tenant_foundation_stage_7b.sql`:

1. Creates idempotent organization, membership, and resolution-key primitives.
2. Seeds BluLadder DFW at fixed UUID
   `b1addf00-0000-4000-8000-000000000001`.
3. Maps existing platform-role users to a DFW membership without changing their
   platform role.
4. Adds nullable `organization_id` to the four first-wave tables.
5. Backfills null legacy rows to DFW; it installs no column default.
6. Adds indexes and `NOT VALID` foreign keys, then validates them.
7. Adds membership/RLS helpers, restrictive authenticated policies, and
   service-role-safe parent-lineage triggers for quotes and bookings.

Nullable columns deliberately preserve current writes during staged rollout.
New authoritative paths must use the server resolver; null compatibility is
temporary and measurable, not a tenant fallback.

## Resolver

`organizationResolver.ts` accepts only verified server signals. Precedence is
resource capability, authenticated membership, provider mapping, site mapping,
territory mapping, then explicitly enabled legacy DFW compatibility. Any
conflicting organization signal fails closed even if another signal has higher
precedence. Legacy DFW is rejected unless the caller explicitly authorizes the
known compatibility path.

## Hosted verification and stop gates

Before application, reconcile the live migration ledger and the three missing
table origins. After application, run the read-only verification SQL and record
counts. Stop if any first-wave null remains, any parent/child organization
mismatch exists, resolution keys duplicate, or an existing platform user lacks
DFW membership.

Before enabling a second organization, add the remaining child tables and change
each authoritative runtime writer from nullable compatibility to required
resolution. Do not activate Oregon or another tenant in this stage.

Existing global uniqueness rules (including customer email, booking reference,
property normalized address, provider IDs, and quote idempotency) are intentionally
unchanged to preserve DFW behavior. They must become organization-keyed, with
duplicate preflight, before a second organization is activated.

## Rollback

Runtime use of the resolver can be reverted independently because this stage is
additive. Retain the organization columns and backfill during diagnosis.
Restrictive policies and lineage triggers can be removed by a reviewed forward
migration if they block a proven DFW path. Do not drop primitives or erase
organization lineage. No `NOT NULL` constraint exists to roll back.
