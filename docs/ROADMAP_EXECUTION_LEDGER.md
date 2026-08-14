# Multi-location roadmap execution ledger

This file is the recoverable source of truth for repository-level roadmap
execution. Update it in every roadmap PR that changes dependency status,
contracts, validation gates, migrations, or protected-action readiness.

Last reconciled main: `8551b86253a227767359887995fbe1e21d1937be`

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
          │   └─ Klamath Phase 1D customer sites      current repository stage
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
| Klamath Phase 1D | #8 | Database-backed customer-site runtime; customer traffic remains blocked | this PR | active |
| Connectors 9A | #9 | Pure contracts, fail-closed selection, Jobber parity seam | #18 | merged |
| Pricing 10A | #10 | Pure service catalog, versioned pricing, exact DFW parity | #19 | merged |
| Intelligence 4A | #4 | Pure tenant-safe features, recommendations, bounded learning | #20 | merged |
| Hardening 11B | #11 | Cross-contract routing-to-intelligence isolation suite | #21 | merged |

## Current stage: Klamath Phase 1D inactive customer-site runtime

The Stage 8A compatibility/grant repairs and Phase 1C inactive Klamath
foundation are applied, receipt-reconciled, and verified. The current safe
repository wave connects the already server-resolved organization to its exact
customer-site row for the voice link and post-call link paths.

DFW retains its exact compatibility URL. Klamath loads its hosted row but still
fails closed because lifecycle, mapping, runtime routing, publication, and
customer traffic remain disabled. No provider or customer action is part of
this stage.

After this wave, tenant-scoped portal/appointment reads, messaging/outbox
lineage, JobTread, provider resources, deployment, controlled acceptance, and
activation remain blocked.

## Protected-action gates

The following remain prohibited and are not implied by a green repository PR:

1. Apply an additional migration or rewrite the reconciled hosted ledger.
2. Backfill or constrain additional hosted `organization_id` values.
3. Deploy the Phase 1D runtime or publish the Klamath site.
4. Configure provider credentials or organization connector references.
5. Activate Oregon territory, services, contacts, pricing, connectors, or
   customer traffic.
6. Mutate unrelated production data.

The controlled migration procedure is in
`docs/operations/tenant-stage-7b-migration-runbook.md`; authorization phases
are separated in
`docs/operations/tenant-production-authorization-checklist.md`.

## Queued safe stages

The Phase 1D database-backed customer-site runtime is the only active safe
repository stage. The following stages remain gated:

1. Complete the Phase 1D checks and merge without deploying it.
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
