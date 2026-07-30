# Stage 7B corrected release candidate

Decision: **NO-GO for hosted execution** until a production authorization names
the exact candidate hash, direct-psql mechanism, operator, reviewer, approval
record, project, environment, cron window, and forward-only provenance
disposition. This package does not authorize any hosted action.

## Immutable composition

The assembler performs one deterministic composition:

1. immutable Stage 7B source without its terminal `COMMIT`;
2. reviewed security correction;
3. private append-only provenance component;
4. one terminal `COMMIT`.

| Component | SHA-256 | Bytes |
|---|---|---:|
| Source introduced at `5904484df00d9762aa140f6a246d27078029da99` | `b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca` | 12,135 |
| Security correction | `abcc90c9044b32fc02fce5f7c3fd445f91fe4f186c5c8a2ee93007809f3a69d0` | 7,154 |
| Provenance component | `bd8cb82c61f47dd6d22fed6c25043c3a5e34e8abd7d5a0e51cde5ff04ee8081f` | 5,429 |
| Assembled candidate | `1c1da7314771172e7ab07eb826e6ba54d00b01ae3e2e20db9a3798b0456fdb59` | 24,721 |

`scripts/check-stage-7b-corrected-release.mjs` fails if any identity,
transaction boundary, evidence contract, or release-safety assertion changes.
The manifest also pins the Git blob IDs for all three source components and the
introduction commits for the source and correction. The provenance component's
commit cannot be embedded in the same uncommitted package without
self-reference; the operator records the post-merge checkout commit containing
the pinned provenance blob in external `artifact.provenance_commit` evidence.

## Atomic provenance decision

The durable provenance row is inserted into
`tenant_security.release_provenance` before the sole `COMMIT`. The table is
private, owner-controlled, and guarded against `UPDATE` and `DELETE`. An exact
rerun is a no-op only when every immutable field matches; a mismatch raises and
rolls back.

The assembled hash is supplied through a quoted `psql` variable after the file
is assembled and hashed. This avoids embedding a self-referential hash while
keeping schema, backfill, security correction, and provenance in the same
database transaction. Row existence therefore proves that transaction
committed. PostgreSQL's transaction outcome cannot prove later cron restoration,
so postflight and restore evidence remain in the separately hashed append-only
operator bundle.

No existing application table is suitable: those tables are mutable,
tenant/runtime-oriented, and do not provide private append-only release
semantics.

## Execution and history decision

The only prepared mechanism is exact direct execution with:

```text
psql -X -v ON_ERROR_STOP=1 -v <reviewed variables> -f <assembled candidate>
```

Direct execution leaves `supabase_migrations.schema_migrations` unchanged. The
atomic private provenance row is the canonical forward-only database record.
No ledger row is inserted, repaired, deleted, or remapped. Authorization must
explicitly accept that outcome; otherwise this release remains NO-GO.

CLI `db push`, `migration up`, `--include-all`, migration repair, raw dashboard
execution, MCP `apply_migration`, and every later migration remain excluded.

## Repository evidence

- Manifest: `release.json`
- Operator template: `provenance-evidence-template.json`
- Exact runbook: `direct-execution-runbook.md`
- Read-only preflight:
  `supabase/preflight/tenant_stage_7b_corrected_release.sql`
- Read-only postflight:
  `supabase/verification/tenant_stage_7b_corrected_postflight.sql`
- Evidence validator: `scripts/validate-stage-7b-evidence.mjs`
- Disposable PostgreSQL rehearsal: `scripts/rehearse-stage-7b-postgres.sh`

The evidence validator fails closed on project/environment drift, component or
candidate hash drift, missing or failed preflight, incomplete cron pause/drain,
transaction failure, verification/provenance mismatch, and incomplete restore.

## Recovery boundary

Abort before execution on any mismatch. If the candidate fails, its single
transaction must roll back the provenance row with every schema/data change.
Do not rerun after an ambiguous client result until read-only postflight proves
whether the provenance row exists. Never drop additive objects, erase backfill,
rewrite migration history, or improvise rollback. A partial or mismatched state
requires containment and a separately reviewed forward repair; PITR remains an
incident-authority action.
