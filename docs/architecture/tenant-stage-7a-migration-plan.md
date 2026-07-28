# Tenant migration, verification, and rollback plan

This plan is intentionally unexecuted. Hosted inspection, migration, provider
configuration, and runtime behavior belong to a separately approved Stage 7B.

## Gates and stages

1. **Read-only hosted preflight.** Reconcile migration ledger, tables/views,
   overloads, grants, RLS, indexes, constraints, cron, storage, extensions, row
   counts, and schema drift. Confirm there are no out-of-band tenant surfaces.
   Inventory null/duplicate/cross-parent ownership candidates without exposing
   customer data.
2. **Add identity primitives.** Create organizations, memberships, provider/site
   mappings, resolution audit/quarantine, and a dedicated test organization.
   Seed the approved DFW identity. No runtime routing changes.
3. **Add nullable scope.** Add nullable `organization_id` and supporting indexes
   to every classified tenant table. Do not use a column default.
4. **Backfill roots, then descendants.** Map connector/config roots; backfill
   proven legacy business roots to DFW in bounded, restartable batches; derive
   children/audits/caches only through authoritative joins. Quarantine zero- or
   multi-match rows.
5. **Dual-write and shadow-resolve.** Introduce shared server-side resolution;
   dual-write organization IDs; compare resolved versus stored lineage. Keep
   enforcement disabled until mismatch and orphan gates are zero.
6. **Constrain.** Add composite parent FKs and organization-keyed uniqueness,
   initially non-blocking/`NOT VALID` where supported. Validate before making
   scope non-null. Update views and final routine definitions.
7. **Enforce runtime and RLS.** Apply membership RLS and explicit service-role
   predicates. Process jobs per organization. Enable by surface in reversible
   cohorts, with DFW first and no Oregon activation.
8. **Isolation qualification.** Create synthetic A/B tenants and prove every
   public, admin, provider, queue, RPC, view, and frontend workflow cannot cross.
   Remove legacy compatibility only after the observation window.

## Verification gates

- Classified object coverage equals hosted object coverage.
- Every scoped root has exactly one organization; every descendant matches its
  authoritative parent; zero cross-organization joins.
- Organization-keyed natural IDs, provider resources, idempotency keys, queue
  claims, locks, caches, and active config versions have no duplicates.
- Shadow resolution has zero conflicts and no unreviewed unmatched business rows.
- RLS tests cover member/non-member, inactive org, multi-membership selection,
  anonymous capability, platform operator, and service-role internal assertions.
- Synthetic two-tenant tests cover booking, reschedule/cancel, quote, customer
  portal, chat, SMS, email, voice, campaigns, knowledge, Jobber sync/webhooks,
  retries, and audit visibility.
- Existing DFW golden flows retain pricing, availability, Jobber-first failure
  behavior, idempotency, concurrency locks, and audit trails.
- Secrets never appear in migrations, generated artifacts, logs, or test output.

Record exact SQL/app/test commands, counts, timings, and redacted evidence for
each gate. A reviewer must approve each transition.

## Rollback

Rollback is forward-safe and surface-by-surface:

1. Disable the affected enforcement/dual-read flag and stop only its tenant-aware
   worker cohort.
2. Restore the previous application version and prior RLS policy set from a
   reviewed migration; retain newly captured audit/quarantine data.
3. Leave additive organization columns, identity rows, and backfill data in place
   while diagnosing. Do not destructively drop or null ownership.
4. If a backfill batch is wrong, restore affected values from its before-image
   ledger using explicit primary keys and re-run verification.
5. Rotate the exposed historical cron credential through the approved security
   process separately; never attempt to “roll back” to it.

No migration proceeds if rollback artifacts, row-count reconciliation, or the
two-tenant isolation suite are missing.
