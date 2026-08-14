# Multi-location roadmap execution ledger

This file is the recoverable source of truth for repository-level roadmap
execution. Update it in every roadmap PR that changes dependency status,
contracts, validation gates, migrations, or protected-action readiness.

Last reconciled main: `da7ddaa5b42e333acf6175c14aa99487d02a421f`

## Dependency graph

```text
#11 green baseline
  └─ #7 tenant contract
      ├─ 7A inventory and contract                   complete (PR #14)
      ├─ 7B additive tenant foundation               complete (PR #15)
      └─ 7C hosted-readiness package                 complete (PR #16)
          ├─ #8 organization routing
          │   ├─ 8A schema and pure routing          complete (PR #17)
          │   ├─ 8B server/runtime adoption           active in narrow waves
          │   ├─ Klamath Phase 1D customer sites      complete (PR #113)
          │   ├─ Klamath Phase 1E hosted identity     complete (PR #114)
          │   └─ Klamath Phase 1F portal lineage      current repository stage
          ├─ #9 organization connector contracts
          │   └─ 9A pure contracts and Jobber seam   complete (PR #18)
          ├─ #10 service catalog and pricing
          │   └─ 10A pure catalog/pricing contracts  complete (PR #19)
          └─ remaining tenant-table rollout          staged by authority path
                └─ #4 customer intelligence
                    └─ 4A pure tenant-safe engine     complete (PR #20)

#11 isolation/release hardening runs across every node.
  └─ 11B cross-contract isolation suite              complete (PR #21)
Oregon provisioning remains inactive until every upstream gate is proven.
```

## Execution records

| Stage | Issue | Repository outcome | PR | Status |
|---|---:|---|---:|---|
| CI baseline | #11 | Frontend and Deno baseline restored | #13 | merged |
| Tenant 7A | #7 | Inventory, contract, authoritative-write analysis | #14 | merged |
| Tenant 7B | #7 | Organizations, memberships, resolver, first-wave nullable columns | #15 | merged |
| Tenant 7C | #7 | Read-only hosted preflight and controlled migration runbook | #16 | merged |
| Routing 8A | #8 | Settings, contacts, territories, services, pure fail-closed routing | #17 | merged |
| Routing 8B | #8 | Persisted tenant lineage and runtime adoption in narrow fail-closed waves | multiple | active |
| Klamath Phase 1D | #8 | Database-backed customer-site runtime; deployed with customer traffic blocked | #113 | merged |
| Klamath Phase 1E | #8 | Reconcile typed tenant profile to the hosted provisioning identity; activation remains blocked | #114 | merged |
| Klamath Phase 1F | #8 | Portal tenant lineage, exact site authority, and organization-scoped reads; migration remains unapplied | this PR | active |
| Connectors 9A | #9 | Pure contracts, fail-closed selection, Jobber parity seam | #18 | merged |
| Pricing 10A | #10 | Pure service catalog, versioned pricing, exact DFW parity | #19 | merged |
| Intelligence 4A | #4 | Pure tenant-safe features, recommendations, bounded learning | #20 | merged |
| Hardening 11B | #11 | Cross-contract routing-to-intelligence isolation suite | #21 | merged |

## Current stage: Klamath Phase 1F portal tenant lineage

The Stage 8A compatibility/grant repairs, Phase 1C inactive foundation, Phase
1D database-backed customer-site runtime, and Phase 1E hosted identity
reconciliation are complete. The current safe repository wave prepares
required organization lineage for portal accounts, sessions, challenges, and
audit records; exact site-origin authority; and organization-scoped customer,
quote, booking, and appointment reads.

The canonical Phase 1F migration remains unapplied and the portal runtime is
not deployed. The Klamath mapping remains provisioning; lifecycle, runtime
routing, publication, customer traffic, territory, services, pricing, contacts,
and providers remain inactive or absent. Exact-host authority therefore still
fails closed. No hosted, provider, or customer action is part of this stage.

The database-backed customer-site runtime remains deployed; customer traffic remains blocked.

After this repository wave, hosted portal-lineage application and runtime
deployment still require separate fail-closed gates. Messaging/outbox lineage,
approved operating inputs, JobTread, provider resources, publication,
controlled acceptance, and activation remain blocked.

## Protected-action gates

The following remain prohibited and are not implied by a green repository PR:

1. Apply an additional migration or rewrite the reconciled hosted ledger.
2. Backfill or constrain additional hosted `organization_id` values.
3. Publish the Klamath site or deploy an unrelated runtime.
4. Configure provider credentials or organization connector references.
5. Activate Oregon territory, services, contacts, pricing, connectors, or
   customer traffic.
6. Mutate unrelated production data.

The controlled migration procedure is in
`docs/operations/tenant-stage-7b-migration-runbook.md`; authorization phases
are separated in
`docs/operations/tenant-production-authorization-checklist.md`.

## Queued safe stages

The Phase 1F portal tenant-lineage candidate is the only active safe repository
stage. The following stages remain gated:

1. Complete Phase 1F exact-head checks and merge without a hosted mutation.
2. Separately preflight and apply only the exact Phase 1F migration, then deploy
   only its reviewed portal runtime functions.
3. Continue Stage 8B persisted-lineage/runtime adoption in narrow tenant-safe
   waves after each dependency is proven.
4. Issue #4 Stage 4B additive persistence design after hosted tenant evidence,
   with organization-keyed uniqueness, composite lineage, and draft-only seeds.
5. Remaining tenant-owned tables in narrow nullable waves, each with
   authoritative-write coverage and verification.
6. Issue #4 read-only importer and later persistence/runtime stages through the
   Stage 9A connector contract.
7. JobTread, Twilio, and Vapi provider prerequisites.
8. Issue #11 whole-system isolation, migration, and release hardening.

## Validation ledger

Every stage must run all applicable repository contract checks, ESLint,
TypeScript, Vitest, relevant Deno tests, focused tests, production build,
migration verification, `git diff --check`, GitHub CI, and secret scan.
Warnings and unavailable hosted checks must be reported separately from
passing checks.

## Open architecture decisions

- authoritative county/geocoder and normalization rules;
- governance for territory priority and activation;
- whether service keys become foreign keys to a canonical service catalog;
- exact provider capabilities and credential references for JobTread and
  calendar fallbacks;
- staged ordering for the remaining tenant-owned authoritative tables;
- hosted migration provenance gaps identified by Stage 7C.
