# Multi-location roadmap execution ledger

This file is the recoverable source of truth for repository-level roadmap
execution. Update it in every roadmap PR that changes dependency status,
contracts, validation gates, migrations, or protected-action readiness.

Last reconciled main: `6af1edfdeaaf6d7bfdd37c0c9d0f4ae80b0c8f3b`

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
          │   └─ 9A pure contracts and Jobber seam   active
          ├─ #10 service catalog and pricing         queued after 8B contract
          └─ remaining tenant-table rollout          staged by authority path
                └─ #4 customer intelligence          after #9/#10 foundations

#11 isolation/release hardening runs across every node.
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
| Connectors 9A | #9 | Pure contracts, fail-closed selection, Jobber parity seam | TBD | active |

## Current stage: Issue #9 Stage 9A

Objective: define organization-scoped connector contracts and wrap the existing
DFW Jobber behavior behind a typed seam without provider calls, configuration
changes, hosted schema assumptions, or runtime cutover.

Required repository outcomes:

- typed contracts for customer, quote, availability, booking, cancellation,
  invoice, communications, health, and capability reporting;
- server-resolved organization connector selection with explicit missing,
  conflicting, inactive, unsupported, and degraded states;
- idempotency, retry, dead-letter/manual-review, and audit contracts;
- a Jobber adapter seam that preserves the existing DFW request/result
  behavior without changing deployed entry points;
- evidence-based JobTread and calendar-fallback capability matrices without
  inventing unsupported operations;
- payment-destination interface only, with no Stripe implementation;
- isolation, selection, failure, capability, and DFW parity tests.

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

1. Finish Issue #9A connector interfaces, selection, failure states, and
   Jobber parity inventory without provider changes.
2. Issue #10A versioned service-catalog/pricing domain and DFW parity fixtures
   without activating new authoritative prices.
3. Complete the Stage 8B persisted-lineage and runtime-adoption package after
   the hosted migration/type gate.
4. Remaining tenant-owned tables in narrow nullable waves, each with
   authoritative-write coverage and verification.
5. Issue #4 customer-intelligence tenant scoping and advisory engine
   completion after connector and pricing contracts stabilize.
6. Inactive Oregon provisioning/evidence fixtures.
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
