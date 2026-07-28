# Tenant production authorization checklist

Each phase requires its own recorded authorization. Approval of one phase does
not authorize later phases.

## Phase 1 — read-only checks

- [ ] Project identity and read-only role confirmed
- [ ] Core and optional preflight scripts approved
- [ ] Evidence handling/redaction approved
- [ ] Ledger, provenance gaps, row counts, RLS, routines, triggers, cron,
      storage, roles, and uniqueness reviewed

Permitted effect: catalog and aggregate reads only.

## Phase 2 — schema mutation

- [ ] Migration checksum and dry-run output approved
- [ ] Backup/PITR and rollback reviewer confirmed
- [ ] Window and operator named
- [ ] Exactly one migration authorized

Permitted effect: additive organizations/memberships/mappings, nullable columns,
indexes, validated FKs, policies, functions, and triggers.

## Phase 3 — data backfill

- [ ] First-wave row counts and lock/time estimate accepted
- [ ] Canonical DFW UUID confirmed
- [ ] Null-only update predicates reviewed
- [ ] Post-backfill mismatch/null queries approved

Permitted effect: assign proven legacy first-wave rows and platform-role users to
DFW. Unknown traffic and ambiguous rows are not authorized for DFW assignment.

## Phase 4 — generated types

- [ ] Hosted schema verification passed
- [ ] Read-only type generation separately approved
- [ ] Generated diff contains only expected primitives/columns/functions
- [ ] CI passes before merge

Permitted effect: repository files only.

## Phase 5 — runtime adoption

- [ ] Every authoritative writer in the enabled cohort resolves server-side
- [ ] Service-role lineage assertions and two-tenant isolation tests pass
- [ ] Null/ambiguity telemetry and manual-review handling operational
- [ ] Rollback flag/release identified
- [ ] No second organization activated

Permitted effect: explicitly named DFW runtime cohort only. Oregon activation,
provider changes, deployment, and additional tenant onboarding require separate
authorization.
