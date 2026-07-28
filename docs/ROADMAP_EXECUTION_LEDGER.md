# Multi-location roadmap execution ledger

This file is the recoverable source of truth for repository-level roadmap
execution. Update it in every roadmap PR that changes dependency status,
contracts, validation gates, migrations, or protected-action readiness.

Last reconciled main: `4032aa047eb128a572802a03fe8652cb71f27ae8`

## Dependency graph

```text
#11 green baseline
  └─ #7 tenant contract
      ├─ 7A inventory and contract                   complete (PR #14)
      ├─ 7B additive tenant foundation               complete (PR #15)
      └─ 7C hosted-readiness package                 complete (PR #16)
          ├─ #8 organization routing
          │   ├─ 8A schema and pure routing          complete (PR #17)
          │   └─ 8B server/runtime adoption           protected gate
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
| Routing 8B | #8 | Runtime adoption requires persisted tenant lineage and hosted schema evidence | TBD | protected gate |
| Connectors 9A | #9 | Pure contracts, fail-closed selection, Jobber parity seam | #18 | merged |
| Pricing 10A | #10 | Pure service catalog, versioned pricing, exact DFW parity | #19 | merged |
| Intelligence 4A | #4 | Pure tenant-safe features, recommendations, bounded learning | #20 | merged |
| Hardening 11B | #11 | Cross-contract routing-to-intelligence isolation suite | #21 | merged |

## Current stage: protected hosted migration gate

No repository-only stage is active. The safe graph through pure routing,
connectors, pricing, customer intelligence, and cross-contract isolation is
complete.

The next dependency requires controlled read-only hosted preflight evidence,
followed by separately authorized schema migration, verification, and generated
type regeneration. Those actions cannot be inferred from repository merge
authority.

Until that gate is cleared, runtime adoption, additional tenant-owned
persistence, provider-backed historical importing, owner activation, and Oregon
provisioning remain blocked.

## Protected-action gates

The following remain prohibited and are not implied by a green repository PR:

1. Apply Stage 7B or Stage 8A migrations to hosted Supabase.
2. Backfill or constrain hosted `organization_id` values.
3. Regenerate types from hosted schema.
4. Wire deployed entry points to the new tables or connector contracts.
5. Configure provider credentials or organization connector references.
6. Activate Oregon territory, services, contacts, pricing, connectors, or
   customer traffic.
7. Deploy or mutate production data.

The controlled migration procedure is in
`docs/operations/tenant-stage-7b-migration-runbook.md`; authorization phases
are separated in
`docs/operations/tenant-production-authorization-checklist.md`.

## Queued safe stages

None. The following stages remain gated:

1. Complete the Stage 8B persisted-lineage and runtime-adoption package after
   the hosted migration/type gate.
2. Issue #4 Stage 4B additive persistence design after hosted tenant evidence,
   with organization-keyed uniqueness, composite lineage, and draft-only seeds.
3. Remaining tenant-owned tables in narrow nullable waves, each with
   authoritative-write coverage and verification.
4. Issue #4 read-only importer and later persistence/runtime stages through the
   Stage 9A connector contract.
5. Inactive Oregon provisioning/evidence fixtures.
6. Issue #11 whole-system isolation, migration, and release hardening.

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
