# Stage 7C hosted preflight

This package prepares a later controlled Stage 7B migration window. It does not
authorize or perform hosted access.

## Operator procedure

Prerequisites: approved read-only database access, the exact production project
identifier independently confirmed, `psql`, a clean checkout of the approved
commit, and an evidence directory outside the repository with access restricted
to the migration operators. Never paste connection strings or query output
containing customer rows into GitHub.

Run the catalog package under a database-enforced read-only transaction:

```sh
psql "$READ_ONLY_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --file=supabase/preflight/tenant_stage_7c_core.sql \
  --single-transaction \
  --echo-errors
```

The supplied role must have `default_transaction_read_only=on`. Confirm before
queries with `SHOW transaction_read_only;`; expected value is `on`. Capture
stdout, stderr, UTC start/end time, operator, project ref, database host hash,
repository SHA, and query-file SHA-256.

If the final core result reports all optional relations, run:

```sh
psql "$READ_ONLY_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --file=supabase/preflight/tenant_stage_7c_optional.sql \
  --single-transaction \
  --echo-errors
```

## Review requirements

- Migration ledger matches repository ordering and identifies whether the Stage
  7B migration is absent.
- `big_job_settings`, `eligibility_rules`, and `schedule_blocks` exist, and
  columns/policies/indexes establish their hosted shape. Their creation
  provenance must be traced to a ledger migration, dashboard action record, or
  explicit signed exception; catalog existence alone is not provenance.
- Record exact row counts for the four first-wave tables.
- Diff live policies, functions, triggers, constraints, and indexes against
  repository definitions. Pay special attention to `SECURITY DEFINER`,
  `search_path`, permissive public policies, and unvalidated constraints.
- Review every cron command without copying embedded credentials. Redact commands
  before attaching evidence and flag literal credentials for rotation through a
  separately authorized security procedure.
- Record storage buckets and storage policies. Zero repository-declared buckets
  does not prove zero hosted buckets.
- Reconcile every platform role to the proposed DFW membership role. Unknown
  roles stop the migration.
- Identify uniqueness constraints on customer email, booking reference,
  normalized property address, provider identifiers, session/idempotency keys,
  and active configuration. These remain global blockers for a second tenant.

## Stop conditions

Stop before migration if access is not provably read-only, project identity is
uncertain, the ledger diverges, any first-wave table is missing or unexpectedly
partitioned, table size makes the single-transaction backfill unsafe, platform
roles cannot be mapped, duplicate DFW seed identity exists, RLS ownership is
unexpected, functions/triggers differ materially, or optional cron/storage state
cannot be reconciled. Never “fix forward” during preflight.
