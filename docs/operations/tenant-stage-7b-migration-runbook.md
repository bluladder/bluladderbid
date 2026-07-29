# Stage 7B controlled migration runbook

Status: Stage 7D reconciliation complete; hosted mutation remains NO-GO.

## Prerequisites

- PR #15 merged and its exact migration SHA approved.
- Stage 7C read-only evidence reviewed with every stop condition cleared.
- Production owner explicitly authorizes schema mutation and data backfill for a
  named window; read-only approval is insufficient.
- Current logical backup/PITR status independently verified.
- Operator has Supabase CLI, approved project link, migration-only access,
  rollback reviewer, incident channel, and a frozen deploy window.
- Application remains on DFW-compatible code; no second organization is active.
- The independent Stage 7D audit's zero-action ledger manifest is unchanged.
  The rejected 99-revert/107-apply bulk repair has not been executed.
- Hosted-only ledger version `20260128005316` has an approved repository
  provenance disposition. Do not remove or remap it ad hoc.
- A read-only `supabase migration list --linked` comparison is captured and
  reconciled to the accepted legacy-drift exception. Timestamp parity alone is
  not schema equivalence.
- Cron jobs 3, 5, and 6 have a separately authorized, rehearsed
  `cron.alter_job(..., active := false/true)` pause/restoration procedure and a
  drain gate; their credential-bearing commands must never be selected or
  copied into evidence.
- The approved detached release checkout is exactly `bb96ec9`, with Supabase
  CLI exactly `2.101.0` and the Stage 7B migration SHA-256 exactly
  `b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca`.
  Current main is not an acceptable release checkout.

## Dry run and execution

From a clean approved checkout:

```sh
supabase db push --linked --dry-run
```

Expected: exactly
`20260728060000_tenant_foundation_stage_7b.sql`, no unrelated migration, and no
remote destructive statement warning. Any other output is a stop.

Never use `--include-all`. The disposable Stage 7B release rehearsal selects
108 older local-only versions with that flag, including a historical `DELETE`.

Only after the separate production authorization:

```sh
supabase db push --linked
```

Expected: one migration applied successfully. Capture redacted CLI output,
repository SHA, migration checksum, UTC timestamps, project ref, operator, and
reviewer. Do not use `--include-all`, repair the ledger, or bypass prompts during
the window.

Cron pause is a distinct protected phase. It must be separately authorized,
completed, and verified before this command. Do not perform a ledger repair or
improvise cron operations inside the Stage 7B schema/backfill window.

## Post-migration verification

Run `supabase/verification/tenant_foundation_stage_7b.sql` through an approved
read-only connection. Require:

- one active canonical DFW organization;
- zero null first-wave organization IDs;
- zero customer/quote/booking lineage mismatches;
- zero duplicate active resolution keys;
- zero platform-role users missing DFW membership;
- all four foreign keys validated;
- DFW smoke tests unchanged.
- exactly one new hosted ledger version: `20260728060000`;
- the three cron jobs restored only after verification, with command
  fingerprints unchanged.

Generated types are a distinct authorized repository step after verification:

```sh
supabase gen types typescript --linked --schema public \
  > /tmp/bluladder-supabase-types.ts
```

Review the diff before replacing the tracked type file. This command reads hosted
schema but must not be bundled into the mutation window automatically.

## Forward-safe rollback

On failure, stop runtime rollout and new writes. Do not drop columns, erase
organization IDs, delete the DFW organization, or rewrite the ledger. If RLS or
lineage triggers alone block a proven DFW path, prepare and review a new forward
migration that removes only the named restrictive policies/triggers while
retaining additive data. Restore the prior application release if runtime
adoption occurred. Use PITR only under incident authority.

## Evidence package

Retain preflight output, redacted cron/storage inventory, migration dry run and
execution output, before/after row counts, verification results, checksums,
operator/reviewer approvals, incident notes, generated-type diff, and CI links.
No secrets, connection strings, raw customer records, or provider tokens belong
in the evidence package.
