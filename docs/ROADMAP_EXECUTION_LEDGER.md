# Multi-location roadmap execution ledger

This file is the recoverable source of truth for repository-level roadmap
execution. Update it in every roadmap PR that changes dependency status,
contracts, validation gates, migrations, or protected-action readiness.

Last reconciled main: `13ee37af96ae0a449f48f11feeec37b436c78318`

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
          │   └─ Klamath Phase 1F portal lineage      complete (PR #115/#116 + deployment)
          │       └─ Klamath Phase 1G messaging       additive migration candidate
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
| Klamath Phase 1F | #8 | Portal tenant lineage and exact site authority; hosted schema and reviewed portal runtime deployed fail closed | #115/#116 + provider receipt | complete |
| Klamath Phase 1G | #7/#9 | Organization-bound messaging connector and durable outbox lineage | this PR | active |
| Connectors 9A | #9 | Pure contracts, fail-closed selection, Jobber parity seam | #18 | merged |
| Pricing 10A | #10 | Pure service catalog, versioned pricing, exact DFW parity | #19 | merged |
| Intelligence 4A | #4 | Pure tenant-safe features, recommendations, bounded learning | #20 | merged |
| Hardening 11B | #11 | Cross-contract routing-to-intelligence isolation suite | #21 | merged |

## Current stage: Klamath Phase 1G messaging/outbox lineage

The Stage 8A compatibility/grant repairs, Phase 1C inactive foundation, Phase
1D database-backed customer-site runtime, Phase 1E hosted identity
reconciliation, and Phase 1F portal-lineage schema application are complete.
The provider execution receipt and generated Supabase types are reconciled.
The Phase 1G pure connector contract is merged. A read-only hosted messaging
preflight passed and an additive organization-lineage migration candidate is
now protected by a disposable PostgreSQL rehearsal; hosted application and
runtime writer adoption remain separate gates.

The Phase 1F portal runtime is deployed from reconciled main and all seven
reviewed functions passed secret-free boot verification. The Klamath mapping remains
provisioning; lifecycle, runtime
routing, publication, customer traffic, territory, services, pricing, contacts,
and providers remain inactive or absent. Exact-host authority therefore still
fails closed. No provider or customer action is part of this stage.

The database-backed customer-site runtime remains deployed; customer traffic remains blocked.

Phase 1F is complete. Messaging/outbox lineage,
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

The current safe repository stage is the narrow, fail-closed messaging/outbox
lineage migration candidate. The following stages remain gated:

1. Add organization lineage to the durable messaging/outbox boundary without
   introducing a DFW fallback for Klamath.
2. Continue Stage 8B persisted-lineage/runtime adoption in narrow tenant-safe
   waves after each dependency is proven.
3. Issue #4 Stage 4B additive persistence design after hosted tenant evidence,
   with organization-keyed uniqueness, composite lineage, and draft-only seeds.
4. Remaining tenant-owned tables in narrow nullable waves, each with
   authoritative-write coverage and verification.
5. Issue #4 read-only importer and later persistence/runtime stages through the
   Stage 9A connector contract.
6. JobTread, Twilio, and Vapi provider prerequisites.
7. Issue #11 whole-system isolation, migration, and release hardening.

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
