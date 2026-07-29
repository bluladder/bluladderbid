# Stage 7D migration gate

Status: repository reconciliation complete; hosted mutation remains **NO-GO**.

Production project ref: `gyndziiuizpgwhqwyrvn`. The empty project
`fqyplaphuafbtalrxqzd` is not an acceptable target.

## Decision summary

The 2026-07-28 read-only snapshot contains 145 hosted ledger rows. Current main
contains 154 repository migrations. Content and live-object reconciliation
produced:

- 45 applied and ledger-aligned repository versions;
- 99 applied migrations whose hosted ledger version differs;
- 7 migrations whose complete durable behavior is present but whose repository
  version is absent from the hosted ledger;
- 1 superseded one-time cleanup migration that must never be replayed;
- 2 genuinely pending main-branch migrations: Stage 7B and Stage 8A;
- 1 hosted-only ledger row, `20260128005316`, that created
  `big_job_settings`, `eligibility_rules`, and `schedule_blocks`;
- 1 new Stage 7D security migration on this branch, also pending.

The machine-readable source of truth is
`tenant-stage-7d-migration-reconciliation.json`. It includes every main-branch
migration's SHA-256, SQL MD5, hosted match, confidence, evidence,
classification, and replay disposition.

## The two 2026-07-27 migrations

### Customer intelligence attribution (`20260727002000`)

Classification: **functionally present but ledger provenance differs**.

Hosted evidence proves:

- `lead_source_definitions` and `lead_source_sync_events` exist;
- all 12 expected attribution columns exist;
- `normalize_lead_source` and `validate_lead_source_submission` exist;
- the expected indexes, RLS policies, comments, and seeded source definitions
  are present.

No hosted migration statement contains `lead_source_definitions`. The migration
must be marked applied through a separately authorized ledger repair; its SQL
must not be replayed.

### Booking attribution trigger (`20260727004500`)

Classification: **functionally present but ledger provenance differs**.

The hosted `persist_booking_lead_attribution()` definition and the trigger on
`bookings` match the repository migration. No hosted ledger statement contains
that function name. It must be marked applied through ledger repair and must not
be replayed.

## Hosted-only table provenance

Hosted ledger version `20260128005316` contains the creation statements for:

| Table | Creation offset in hosted statement |
|---|---:|
| `eligibility_rules` | 252 |
| `big_job_settings` | 913 |
| `schedule_blocks` | 1424 |

This is authoritative hosted provenance, but the corresponding source migration
is absent from the repository.

The restoration strategy is:

1. Retain the hosted row and its captured checksum as historical evidence.
2. Create a new, forward-dated repository baseline only after the complete
   current definitions, grants, policies, triggers, constraints, comments, and
   defaults have been reviewed.
3. The forward baseline must create the tables for a new empty environment but
   be idempotent against production. It must not pretend to be the historical
   `20260128005316` migration.
4. Validate the forward baseline in an empty local database and against a
   schema-only production clone.
5. Only then decide whether the hosted-only ledger row remains as an accepted
   exception or is replaced by an authorized ledger-only mapping.

Stage 7D does not fabricate a historical migration and does not alter the
already-shipped hosted row.

## Dry-run determinism

Supabase CLI compares migration timestamps, not migration SQL. Therefore the
current history is not a nine-file discrepancy in CLI terms.

Before any repair:

- 100 hosted versions have no same-version local file: 99 shifted versions plus
  hosted-only `20260128005316`;
- 110 branch-local versions have no same-version hosted row: the corresponding
  99 repository versions, seven functionally-present provenance gaps, the
  superseded cleanup, Stage 7B, Stage 8A, and the Stage 7D security migration.

Ordinary `supabase db push --linked --dry-run` considers unapplied migrations
after the hosted history tip. It does not automatically select all older
local-only migrations. The `--include-all` flag expands selection to those
historical files, including destructive cleanup SQL, and is prohibited.

The approved-window acceptance target remains exactly:

```text
20260728060000_tenant_foundation_stage_7b.sql
```

Reaching it requires all of the following:

1. Do not execute the rejected 99-revert/107-apply bulk repair.
2. Retain all existing hosted ledger rows and the zero-action repair manifest.
3. Resolve the hosted-only `20260128005316` provenance strategy.
4. Use the Stage 7B release checkout at `bb96ec9`, which does not contain later pending
   Stage 8A or Stage 7D migration files.
5. Pin Supabase CLI `2.101.0`.
6. Run `supabase migration list --linked` and independently compare its output
   with the reconciliation ledger.
7. Run the dry run without `--include-all`; stop unless exactly Stage 7B appears.

No ledger repair is authorized or currently justified. Capture the ledger and
have a second operator compare it before any future protected action.

## Security-definer review

All three functions are owned by `postgres`, are `SECURITY DEFINER`, and set
`search_path=public`. Their SQL is static and has no dynamic-SQL injection path.

| Function | Intent and authorization | Disclosure/tenant finding | Decision |
|---|---|---|---|
| `audit_business_knowledge()` | Trigger-only. No direct caller authorization is needed. | Writes complete old/new knowledge rows to the audit table. RLS protects the audit table, but future audit rows require organization lineage. | Revoke direct execution from `PUBLIC`, `anon`, `authenticated`, and `service_role`. |
| `persist_booking_lead_attribution()` | Trigger-only. No direct caller authorization is needed. | Uses globally unique `source_session_id`; this is safe only while one organization is active. It must become organization-scoped before tenant expansion. | Revoke direct execution from all application roles. |
| `search_published_business_knowledge(text, integer)` | Intentional read-only application RPC. Anonymous and authenticated access supports customer-facing AI retrieval. | Static query; trims input, caps limit to 1–40, and returns only active, published, effective rows. Knowledge is currently DFW-global and cannot serve a second organization until scoped. | Revoke inherited `PUBLIC`; explicitly grant `anon`, `authenticated`, and `service_role`. |

The repository-only forward correction is
`20260728080000_restrict_security_definer_execution.sql`. It is not authorized
for hosted application and is not part of the Stage 7B window.

The April 2026 Supabase Data API default change reinforces the use of explicit
grants for new tables/functions. Stage 7B already uses explicit grants; the
migration-window reviewer must retain that behavior.

## Cron review

No complete cron command or credential-bearing URL was captured.

| Job | Schedule | Destination | Authentication | Tenant behavior | Risk |
|---:|---|---|---|---|---|
| 3 | `* * * * *` | HTTP POST to `process-sms-queue` | Cron shared-secret header | No organization/tenant marker; project/DFW marker present | High |
| 5 | `*/5 * * * *` | HTTP POST to `jobber-autosync` | Cron shared-secret header | No organization/tenant marker; project/DFW marker present | High |
| 6 | `30 8 * * *` | HTTP POST to `jobber-autosync` | Cron shared-secret header | No organization/tenant marker; project/DFW marker present | High |

All three commands contain a long quoted literal and credential markers.
Credentials appear embedded in `cron.job` rather than resolved from Vault or a
database setting. Rotation/provider remediation is outside Stage 7D authority.

Stage 7B changes `bookings` and its triggers. Jobs 5 and 6 can write booking or
Jobber synchronization state; job 3 processes unscoped communication queues.
Because jobs run continuously, the mutation window must either receive explicit
authorization to pause all three or prove in a rehearsal that concurrent
execution is harmless. The safer gate is a reviewed pause and restoration.

The previously documented direct `UPDATE cron.job` pause/restore procedure is
withdrawn. Current Supabase Cron does not allow direct inserts or updates to
`cron.job`.

The supported secret-preserving primitive for a separately authorized window is
`cron.alter_job(jobid, active := false)` and its `true` counterpart. It retains
the job ID, schedule, and credential-bearing command. Never unschedule and
recreate these jobs.

Before that protected transaction, verify in read-only mode:

- the installed pg_cron version and exact `cron.alter_job` signature;
- ownership/permission for the window operator;
- exactly jobs 3, 5, and 6 with expected active state and MD5 fingerprints;
- zero starting or running invocations.

The protected transaction must revalidate those exact tuples, invoke
`cron.alter_job` for all three, and return only job ID, schedule, active state,
and command fingerprint. After commit, poll safe `cron.job_run_details`
metadata until all in-flight invocations drain. Restoration mirrors the same
checks with `active := true`.

No cron operation is authorized now. Stop if the function, owner, count, state,
or fingerprint differs; any call fails; jobs do not drain; or command text
would need to be exposed or reconstructed.

## Uniqueness classification

`tenant-stage-7d-uniqueness-classification.json` classifies all 65 hosted
non-primary unique indexes:

- 33 organization-scoped composite keys;
- 9 provider-scoped keys;
- 6 intentionally platform-global keys;
- 6 safe only for current single-organization compatibility;
- 11 ambiguous keys requiring a product/security decision.

The intentionally global set is limited to bearer/security token identity and
the separate platform-role contract. DFW configuration singletons are not
classified as globally valid.

The 11 unresolved decisions block second-organization activation, but do not
block the additive DFW-only Stage 7B migration.

## Pending and never-replay sequence

Genuinely pending sequence:

1. `20260728060000_tenant_foundation_stage_7b.sql`
2. `20260728070000_organization_routing_stage_8a.sql` — only after Stage 7B
   verification and separate authorization.
3. `20260728080000_restrict_security_definer_execution.sql` — separate security
   window after compatibility verification.

Must never replay:

- all 144 repository migrations classified as already applied;
- all seven functionally-present provenance gaps;
- `20260713051500_cleanup_geocode_verify_precheck.sql`.

## Rejected protected ledger commands

The previous 99-revert/107-apply manifest was derived from timestamp proximity
and ordering. It is not independently proven and must not be generated or
executed. `scripts/print-stage-7d-ledger-repair.mjs` now fails closed. The only
audited repair manifest contains zero actions.

## Migration-window acceptance

From the immutable Stage 7B release checkout, after provenance review:

```sh
supabase migration list --linked
supabase db push --linked --dry-run
```

Accept only one proposed migration:

```text
20260728060000_tenant_foundation_stage_7b.sql
```

Then, under distinct schema/backfill authorization:

```sh
supabase db push --linked
```

Post-migration verification:

```sh
psql "$READ_ONLY_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --single-transaction \
  --echo-errors \
  --file=supabase/verification/tenant_foundation_stage_7b.sql
```

Require one canonical DFW organization, zero first-wave nulls, zero lineage
mismatches, zero duplicate active resolution keys, complete platform-role
membership mapping, four validated foreign keys, unchanged DFW smoke behavior,
and an exact one-row Stage 7B ledger addition.

## Rollback implications

Ledger repair changes metadata only; it does not reverse SQL. No repair is
approved. A compensating repair cannot be assumed to restore original ledger
metadata, so the rejected bulk rewrite has no acceptable rollback plan.

For Stage 7B, rollback remains forward-safe: stop runtime adoption, retain
additive columns and backfilled IDs, and use a new corrective migration for a
specific policy/trigger problem. Do not drop tenant columns, delete the DFW
organization, erase organization IDs, or rewrite the ledger during an incident.

## Recommendation

**NO-GO** for hosted mutation today.

Repository-remediable analysis, security hardening, contract checks, and
runbooks are complete. Remaining gates include a successful pinned-CLI
rehearsal, a secret-safe cron decision, and an approved provenance decision for
hosted-only `20260128005316`. Historical ledger mutation is not presently
recommended.
