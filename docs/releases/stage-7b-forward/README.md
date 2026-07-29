# Stage 7B forward-only release package

Decision: **NO-GO**. This package is immutable evidence, not production
authorization.

## Sole payload

The only payload is
`supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql` from commit
`bb96ec9fd54e352f049dda61d694de6c09767090`.

| Property | Required value |
|---|---|
| Size | 12,135 bytes |
| Git blob | `4823d772a456a4a40f9883c408da3d85ba3a1d9d` |
| SHA-256 | `b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca` |
| Project ref | `gyndziiuizpgwhqwyrvn` |
| PostgreSQL | 17.6 |
| Supabase CLI, if used for inspection | 2.101.0 |

The package must reject historical migrations, Stage 8A
`20260728070000`, Stage 7D security migration `20260728080000`,
`--include-all`, and every migration-ledger repair.

## Expected impact

The migration creates three tenant primitive tables, upserts the canonical DFW
organization, maps the existing platform-role user to a DFW membership, adds
nullable `organization_id` columns to four first-wave tables, backfills the
current 30 rows, creates seven explicit indexes, adds and validates four foreign
keys, installs two functions and two lineage triggers, enables RLS on the new
tables, replaces eight policies, and applies explicit grants.

The migration contains its own `BEGIN`/`COMMIT`. Four DDL changes, four
backfills, non-concurrent indexes, foreign-key validation, policy changes, and
trigger changes occur in that transaction.

## Preconditions

All conditions are mandatory:

1. A new production authorization names the exact release hash and mechanism.
2. Project identity, PostgreSQL version, ledger count/tip/fingerprint, table
   counts, schema state, role distribution, and cron fingerprints match the
   signed preflight.
3. Stage 7B objects and first-wave columns are completely absent; partial state
   is a stop.
4. Counts are exactly 16 customers, 10 properties, 2 quotes, 2 bookings, and
   one platform-role user, unless a newly reviewed impact calculation replaces
   them.
5. Jobs 3, 5, and 6 are separately authorized, paused with
   `cron.alter_job`, fingerprint-stable, and fully drained.
6. Disposable PostgreSQL/Supabase rehearsal proves RLS, grants, transaction
   behavior, ledger behavior, rerun behavior, and rollback behavior.
7. A selected mechanism can prove one exact payload and an acceptable migration
   history outcome without legacy ledger rewriting.

## Current blockers

- PostgreSQL 17.6 disposable rehearsal confirms that
  `Organization admins manage memberships` fails with
  `infinite recursion detected in policy for relation
  "organization_memberships"` (SQLSTATE `42P17`).
- The authenticated admin policies lack the table DML grants needed to perform
  the operations their names describe.
- `is_organization_member(uuid,uuid)` is `SECURITY DEFINER`, executable by
  authenticated users, accepts a caller-selected user ID, and uses
  `search_path=public`.
- The migration's embedded transaction commands have not been proven compatible
  with a platform migration wrapper that also records history transactionally.
- Supabase CLI has no supported linked single-file selector that bypasses
  legacy migration comparison.

These are correctness and isolation blockers. Do not modify the immutable
payload to hide them. Prepare a newly reviewed migration artifact instead.

## Postconditions

A future successful window must prove:

- exactly one canonical active DFW organization and zero active Oregon
  organizations;
- exactly 30 preexisting first-wave rows mapped to DFW and zero null tenant IDs;
- one active DFW membership for every platform-role user;
- zero booking/quote-to-customer lineage mismatches;
- four validated foreign keys;
- expected indexes, triggers, policies, grants, and function ACLs only;
- unchanged legacy DFW behavior;
- an exact, independently approved migration-history outcome;
- all three cron jobs restored with unchanged fingerprints.

## Abort and forward recovery

Abort before mutation on any identity, hash, count, role, schema, policy,
function, trigger, ledger, activity, or cron mismatch. Abort if more than one
payload is selectable or if any historical/later migration is visible to the
execution mechanism.

On execution failure, stop runtime adoption and capture read-only schema and
history evidence. Do not retry, repair history, drop additive objects, erase
organization IDs, or use `--include-all`. If a transaction was not fully rolled
back, recover only through a separately reviewed forward corrective migration.
PITR remains an incident-authority action.

Use `operator-evidence-template.json` for the future evidence record.
