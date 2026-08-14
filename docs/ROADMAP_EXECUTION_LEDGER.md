# Multi-location roadmap execution ledger

This file is the recoverable source of truth for repository-level roadmap
execution. Update it in every roadmap PR that changes dependency status,
contracts, validation gates, migrations, or protected-action readiness.

Last reconciled main: `0d41d0d70a4aae263ab11220ac1c71fc49951443`

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
          │       └─ Klamath Phase 1G messaging       priority runtime deployed; adoption active
          │           └─ Klamath Phase 1H consent lineage  hosted migration and runtime deployment verified
          ├─ #9 organization connector contracts
          │   ├─ 9A pure contracts and Jobber seam   complete (PR #18)
          │   ├─ Klamath JobTread capability seam    complete (PR #136)
          │   ├─ Klamath Phase 1I CRM lineage        hosted schema and grants verified
          │   ├─ Klamath JobTread mappings           first dormant wave complete (PR #144)
          │   ├─ Klamath JobTread runner             dormant execution/reconciliation complete (PR #146)
          │   └─ Klamath JobTread Phase 1I stores    dormant concrete adapters active (#147)
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
| Klamath Phase 1G | #7/#9 | Organization-bound messaging connector, durable outbox, and fail-closed Twilio adapter | #118-#123 + provider receipts; this PR | active |
| Klamath Phase 1H | #7/#9 | Organization-scoped consent lineage and fail-closed runtime adoption | #131-#133 + provider/deployment receipts | complete |
| Klamath JobTread capability | #135 | Verified provider primitives plus dormant guarded adapter and redacted transport | #136 | complete |
| Klamath JobTread mappings | #143 | Dormant exact customer, schedule-read, and job/task planning with blocked ambiguous lifecycles | #144 | complete |
| Klamath JobTread runner | #145 | Dormant protected-plan execution, hashed attempt lineage, response validation, and uncertain-outcome reconciliation | #146 | complete |
| Klamath JobTread Phase 1I stores | #147 | Dormant exact connector lookup, attempt-one ownership, started-only terminal transitions, and read-only reconciliation | active PR | active |
| Klamath Phase 1I | #137/#139/#141 | Empty organization CRM connector, operation-attempt, and webhook-receipt lineage | #138/#140 + provider receipts | hosted schema complete |
| Connectors 9A | #9 | Pure contracts, fail-closed selection, Jobber parity seam | #18 | merged |
| Pricing 10A | #10 | Pure service catalog, versioned pricing, exact DFW parity | #19 | merged |
| Intelligence 4A | #4 | Pure tenant-safe features, recommendations, bounded learning | #20 | merged |
| Hardening 11B | #11 | Cross-contract routing-to-intelligence isolation suite | #21 | merged |

## Current stage: Klamath Phase 1I dormant CRM connector lineage

The intended JobTread admin account, organization-scoped grant controls,
custom-webhook controls, and official provider primitives were verified
read-only. PR #136 records that evidence and adds a dormant JobTread adapter
plus redacted Pave transport. It creates no grant, webhook, credential, provider
call, hosted row, runtime adoption, or activation.

Phase 1I is the next persistence boundary. Its applied additive migration
creates three empty organization-owned tables for CRM
connector configuration, hashed operation idempotency, and authenticated
webhook receipt idempotency. Composite organization/connector foreign keys,
least-privilege RLS, protected-reference gates, and sanitized outcome
constraints fail closed before any runtime or provider action. Hosted
postflight found Lovable-hydrated authenticated privileges broader than the
reviewed table grants. A narrow forward-only repair is now applied and verified:
connector configuration has CRUD, both audit tables have SELECT only, and all
tables remain empty. The first JobTread business mappings and dormant injected
execution/reconciliation runner are merged. Exact Phase 1I connector and
attempt stores are now under review; they fail closed under ambiguous inserts
and remain unreachable from production. Protected-plan persistence,
credential/webhook setup, runtime deployment, and customer traffic remain
blocked.

## Completed foundation: Klamath Phase 1G messaging/outbox lineage and Phase 1H

The Stage 8A compatibility/grant repairs, Phase 1C inactive foundation, Phase
1D database-backed customer-site runtime, Phase 1E hosted identity
reconciliation, and Phase 1F portal-lineage schema application are complete.
The provider execution receipt and generated Supabase types are reconciled.
The Phase 1G pure connector contract is merged. A read-only hosted messaging
preflight passed and the additive organization-lineage migration was applied
once with a provider-generated receipt. Its data/RLS/lineage postflight passed,
and Lovable's three hydrated excess authenticated table privileges were removed
by one forward-only provider execution. The canonical receipt, ledger
advancement, CRUD-only authenticated access, anonymous denial, full
service-role access, zero connectors, and unchanged 134-row DFW lineage are
verified. The organization-scoped transactional outbox claim was then applied
once as provider execution version `20260814081254`; its normalized receipt,
service-role-only execution grants, 160-row ledger, zero data changes, and
unchanged Klamath provisioning boundary are independently verified. Remaining
writer adoption and runtime deployment remain separate gates. A repository-only
Twilio adapter now requires an allowlisted connector reference, dedicated API
key, and Messaging Service identity; provider setup, deployment, messaging, and
activation remain blocked. The first DFW connector application attempt rolled
back on mixed SMS/email historical rows. The corrected SMS-channel-only
compatibility migration was then applied once as provider execution version
`20260814090619`; its normalized receipt, 161-row ledger, exact connector,
122 bound SMS rows, 12 intentionally unbound email rows, and unchanged Klamath
provisioning boundary are independently verified. The first launch-critical
writer adoption is merged: customer-portal verification SMS resolves the
organization from exact server-side site authority, claims the scoped outbox,
and dispatches only through that organization's reviewed connector. The queued
SMS worker boundary is now prepared: it resolves exactly one active
organization connector, persists that binding under the current durable claim,
reruns the dispatch guard, and uses the same reviewed provider adapter. Missing,
stale, ambiguous, or cross-tenant authority terminates before provider
submission. Both reviewed functions were deployed together from merged main
`014517b43d543dec77d29d46877cde9aaf6f53a6`. Secret-free probes reached their
405 method and 401 authentication boundaries, and queue logs showed clean
boots. No provider traffic or customer action occurred. Direct/manual,
staff-reply, inbound-provider, and other legacy writer surfaces remain separate
adoption gates.

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

The Phase 1H consent-lineage hosted preflight passed unchanged and rolled back
without writes. Its exact organization-lineage migration then passed the
disposable PostgreSQL rehearsal, exact-head CI, and Secret Scan and was applied
once as hosted execution version `20260814101915`. The ledger advanced from 161
to 162; all seven DFW-era consent rows and twenty audit events now carry exact
DFW lineage with zero conflicts or orphans, while Klamath remains empty and
provisioning. The provider receipt is reconciled on main. The next narrow
candidate makes queued checks, staff replies, website chat, and AI consent
tools use persisted, server-derived organization authority; non-DFW chat and
the legacy direct staff provider remain disabled until Klamath-owned adapters
are approved. The three reviewed runtime functions were deployed from merged
main `4a621bd18ffe8b7823eb4546089f64b8ce695aef`; secret-free probes reached the
expected 503/401/401 fail-closed boundaries. No message or activation occurred.

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

Phase 1I schema/grants, the first JobTread mapping wave, and the dormant
execution runner are complete. The current safe repository stage is the exact
Phase 1I store boundary. The following stages remain gated:

1. Merge the Phase 1I stores only after exact-head CI and Secret Scan prove the
   dormant contract and all existing DFW/tenant gates.
2. Implement protected plan assembly, webhook
   authentication/idempotency, and read-only reconciliation without adding a
   production entry-point import or provider credential.
3. Obtain owner-approved Klamath business hours, local contacts, and independent
   pricing/catalog inputs; preserve all runtime and customer-traffic flags off.
4. Create the exact JobTread fields, least-privilege Grant Key, webhook, and one
   inactive connector row only in a separately controlled provider window.
5. Continue Stage 8B persisted-lineage/runtime adoption in narrow tenant-safe
   waves after each dependency is proven.
6. Issue #4 Stage 4B additive persistence design after hosted tenant evidence,
   with organization-keyed uniqueness, composite lineage, and draft-only seeds.
7. Remaining tenant-owned tables and the read-only importer in narrow waves
   through the Stage 9A connector contract.
7. Twilio and Vapi provider prerequisites.
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
- exact JobTread quote/document, schedule/capacity, booking/job/task,
  cancellation, invoice, and communications mappings;
- staged ordering for the remaining tenant-owned authoritative tables;
- hosted migration provenance gaps identified by Stage 7C.
