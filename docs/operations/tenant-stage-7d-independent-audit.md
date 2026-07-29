# Stage 7D independent repair audit

Status: **NO-GO** for every hosted mutation.

This audit independently reviewed the merged Stage 7D proposal. It replaces the
proposed 99-revert/107-apply batch with a zero-action repair manifest. Nothing
in this package authorizes a migration-ledger change, schema change, backfill,
cron change, deployment, or provider change.

## Batch decision

The hosted ledger contains 145 versions from `20260125015830` through
`20260726194719`. Current main contains 154 migration files. Forty-five
timestamps are identical. The previous generator paired 99 other repository
migrations with hosted versions by nearest timestamp within 65 seconds and
ordering. It did not independently compare all hosted names, SQL statements,
hashes, or durable effects.

The 99/107 proposal is arithmetically consistent but evidentially unsafe:

- `migration repair --status reverted` deletes ledger rows without undoing SQL;
- `migration repair --status applied` inserts ledger rows without running SQL;
- a false revert can make historical SQL replay-eligible;
- a false apply can suppress SQL that never ran.

The smallest independently defensible repair is therefore **zero ledger
mutations**. The generated bulk repair script is deliberately disabled.

A fresh independent read-only transaction reconfirmed PostgreSQL 17.6,
`transaction_read_only=on`, the 145-row bounds above, and the secret-free
version/name fingerprint `73ed8522db78e51049a421e1f72b18c3`. Hosted-only
`20260128005316` has one ledger statement, blank name, statement fingerprint
`caac83d911c70e3f539cc2230dd8586b`, and mentions all three of
`big_job_settings`, `eligibility_rules`, and `schedule_blocks`. This confirms
the hosted row's creation provenance without proving any of the 99 inferred
timestamp aliases.

## CLI semantics and version pin

The reviewed version is Supabase CLI **2.101.0**. A migration window must stop
unless `supabase --version` returns exactly that version.

`migration list` compares version identifiers, not schema equivalence.
`db push --dry-run` selects files but does not parse or execute their SQL.
Ordinary `db push` selects unapplied migrations after the remote history tip.
Older local-only migrations are included only when `--include-all` is supplied.
That flag is prohibited.

Migration-list divergence is evidence to investigate; it does not by itself
prove ordinary `db push` will replay all historical local files.

## Replay-risk matrix

| Class | Count | Stage 7B-window disposition |
|---|---:|---|
| Ledger-aligned, already applied | 45 | Prohibited |
| Timestamp-shifted, claimed applied | 99 | Prohibited; equivalence not independently proven |
| Functionally present, provenance differs | 7 | Prohibited |
| Superseded cleanup | 1 | Prohibited |
| Genuinely pending on the audited branch | 3 | Stage 7B conditional; two deferred |

Repository-wide lexical review found eight migration-time `DELETE` files, 33
files containing `UPDATE`, 39 containing `INSERT`, seven containing
`ALTER TABLE ... DROP`, 35 non-idempotent `CREATE TABLE` statements, and 29
non-idempotent `CREATE INDEX` statements. A dry run selecting any historical
file is an immediate stop.

The superseded cleanup
`20260713051500_cleanup_geocode_verify_precheck.sql` must never replay. It is
semantically duplicative of the adjacent cleanup and performs data deletion.

## Immutable release boundary

Any later Stage 7B window must use a detached, clean checkout of merge commit
`bb96ec9`. That commit contains Stage 7B but predates Stage 8A and the Stage 7D
security migration.

The only conditionally allowlisted file is:

```text
20260728060000_tenant_foundation_stage_7b.sql
SHA-256 b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca
```

Stage 7B is not safe to replay: it performs four backfills, upserts canonical
DFW metadata, and replaces triggers, policies, and grants. It is allowlisted
once only against a verified pre-Stage-7B schema.

## Minimal command set for a separately authorized window

These commands are proposed, not authorized:

```sh
git worktree add --detach /tmp/bluladder-stage-7b-release bb96ec9
cd /tmp/bluladder-stage-7b-release
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "bb96ec9"
test "$(sha256sum supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql | cut -d' ' -f1)" = \
  "b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca"
test "$(supabase --version)" = "2.101.0"
test "$(cat supabase/.temp/project-ref)" = "gyndziiuizpgwhqwyrvn"
supabase migration list --linked
supabase db push --linked --dry-run
```

Do not run `supabase migration repair`. Do not add `--include-all`. Stop unless
the ordinary dry run proposes exactly the allowlisted Stage 7B file.

The separately authorized schema command would then be:

```sh
supabase db push --linked
```

It remains prohibited now.

## Abort and recovery

Before any future protected action, capture the complete hosted ledger
(`version`, `name`, and statement fingerprints) in a read-only transaction,
plus project identity, CLI version, release SHA, working-tree state, migration
hash, migration list, and dry-run output.

Abort before mutation if any identity, count, hash, version, project, schema
precondition, cron fingerprint, or allowlist result differs. A dry run that
contains a historical migration, Stage 8A, the security migration, or more than
one file is a hard stop.

Ledger repair is not rollback. A compensating `repair` cannot reverse migration
SQL and may not restore original row metadata. After a partially applied Stage
7B migration, preserve additive objects and use a new forward corrective
migration; do not drop tenant columns, erase organization IDs, or rewrite
history during an incident.

## Evidence checklist

- Correct project ref `gyndziiuizpgwhqwyrvn`; reject
  `fqyplaphuafbtalrxqzd`.
- Read-only hosted ledger export before and after any separately authorized
  ledger operation.
- Supabase CLI exactly `2.101.0`.
- Detached clean release checkout exactly `bb96ec9`.
- Allowlisted migration SHA-256 exact match.
- No `--include-all` in command transcript.
- Ordinary dry run selects exactly one allowlisted file.
- Independent local migration SQL validation; dry run is not SQL validation.
- Pre/post schema verification and exact Stage 7B ledger delta.
- Secret-safe cron evidence without full commands.
- Two-person approval at the protected-action boundary.

## Unresolved decisions

1. Whether historical timestamp drift should remain a signed legacy exception
   or be replaced by a forward-dated audited baseline.
2. How to restore repository provenance for hosted-only `20260128005316`
   without fabricating history.
3. Whether all 99 aliases can ever be proven sufficiently to justify rewriting
   established production history.
4. How jobs 3, 5, and 6 can be paused and restored without exposing or
   rewriting credential-bearing commands.

Until those decisions and the Stage 7B preconditions are separately approved,
the recommendation remains **NO-GO**.
