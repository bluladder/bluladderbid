# Voice artifact retention Lovable-native release control

Status: **control path prepared for review; no production action authorized or
performed**.

No production mutation occurred while preparing this package.

This package resolves the migration-control mismatch for the voice-artifact
retention release without pretending that Lovable Cloud preserves a
caller-supplied migration version. It keeps the repository version and SQL
identity authoritative, lets Lovable assign its supported execution-time ledger
version, and requires a cryptographically bound repository receipt before any
later Supabase CLI migration run.

## Decision

Use preference **Option (c)**, the Lovable-native execution-version
reconciliation path described in the operator runbook. The two preferred
alternatives are not available:

1. Lovable's supported database-migration tool accepts `description` and
   `query`; it exposes no caller-supplied `version` input. The existing hosted
   history confirms that Lovable assigns an execution-time version.
2. The repository has no proven, existing GitHub Actions production migration
   path. Its workflows are verification-only, use only `GITHUB_TOKEN`, and do
   not prove the required Supabase production secret names are present.

Do not use the direct Supabase connector. Its visible project is not the
BluLadder Bid production project.

## Fixed identities

- Release ID: `voice-artifact-retention-lovable-v1`
- Lovable project ID: `b6e0d823-59c4-4b5a-afbe-182485e5458b`
- Supabase project reference: `gyndziiuizpgwhqwyrvn`
- Repository source version: `20260802043233`
- Canonical SQL SHA-256:
  `a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102`
- Reviewed source baseline: `27bad0cd0e5053cfb436752bee0976c5e1278fd8`
- Hosted ledger baseline: 151 rows, tip `20260801234014`
- Hosted ledger fingerprint: the complete value pinned in `release.json`
  (verified prefix `3366…`)

Generated transport paths, byte counts, and hashes are authoritative only as
recorded in `release.json`. This document deliberately does not copy values that
a deterministic assembler must calculate.

## Three separate identities

The release never collapses these into one value:

1. **Repository source identity** — version `20260802043233` and the canonical
   SQL SHA-256 above.
2. **Lovable transport identity** — a deterministically assembled file with one
   explicit transaction around the canonical bytes. Its file hash and the
   expected one-terminal-newline-normalized ledger hash are pinned in
   `release.json`.
3. **Hosted execution identity** — the version Lovable assigns when the owner
   approves the migration. It is accepted only when exactly one new ledger row
   contains exactly one statement with the expected transport hash and all
   postflight object checks pass.

An execution-time version is location metadata, not proof of SQL identity. The
statement digest is the proof. A matching version with different SQL fails.

## Transaction and partial-application boundary

The canonical source has no outer transaction. The generated Lovable transport
therefore has this fixed shape:

```sql
BEGIN;
-- exact canonical source bytes, unchanged
COMMIT;
```

The assembler first verifies the canonical source hash, then inserts the exact
source bytes between the transaction boundaries. It rejects nested transaction
control, substitutions, a changed source hash, an unexpected path, or a
different generated artifact. Schema objects, purge function, grants, index,
`pg_cron` registration, and one private append-only release-provenance row
consequently commit or roll back together. The provenance row records release,
project, source, control, and artifact identities; it is not a migration-ledger
repair and contains no customer or transcript data.

The platform's ledger write is verified separately because repository code
cannot prove that Lovable records its migration row in the same PostgreSQL
transaction. An error, disconnect, timeout, missing ledger row, extra ledger
row, or object/ledger disagreement is an **ambiguous outcome**. Never retry the
transport in that state. Keep live booking false, run read-only reconciliation,
and prepare a separately reviewed forward repair if needed.

## Why substitution cannot pass

- The source path, byte count, and SHA-256 are pinned in the release manifest.
- The transport is generated, not manually edited, and its hash is pinned.
- The complete SQL approval card must match that generated transport before the
  single approval.
- Postflight recomputes SHA-256 inside PostgreSQL over the sole new ledger
  statement and compares the documented one-terminal-newline normalization.
- The atomic private provenance row must contain the same manifest-bound source,
  control, artifact, project, and release identities.
- Schema, privileges, function definitions, scheduler identity, and aggregate
  retention behavior must also match the reviewed contract.

Changing the description, Lovable-assigned version, or migration name cannot
conceal different SQL.

## Preventing later duplicate application

The byte-identical canonical source remains the active repository migration at
version `20260802043233`. This preserves clean rebuilds and its original Git
identity. Lovable production history will not contain that caller version,
because the supported control plane assigns a later execution-time version.

After a successful execution and postflight, the observed Lovable version is
captured as evidence. Lovable's existing Git integration must produce one active
migration file at that observed version, as it did for the proven Stage 7B
release. The repository checker accepts that receipt only when its bytes are the
exact reviewed transport (allowing only removal of the terminal LF), its SQL
hash matches the release manifest, and its version/hash match the unique hosted
row. It also requires the established Lovable bot to have introduced that sole
migration path in a reachable commit, rejects any 14-digit version collision,
and requires completed non-fixture preflight, approval, postflight, and CLI
dry-run evidence. A copied file or self-selected timestamp is not a receipt.
This does not insert, delete, rename, or repair a hosted ledger row; it
reconciles the repository to a row Lovable already created.

Ordinary Supabase CLI `db push` applies only local migrations newer than the
remote history tip. Once the later Lovable-version receipt is merged, it sees
that exact remote version and does not select the older missing caller version.
The `--include-all` flag would deliberately include older local migrations that
are missing remotely, so repository policy and this release permanently forbid
it, historical replay, and migration repair. A mandatory dry-run must select no
retention migration.

No migration operation may run between Lovable execution and merge of the
receipt commit. Any selected canonical source, version/hash disagreement, or use
of an include-all/repair path remains a hard stop.

On a clean rebuild, the canonical migration runs first. The later receipt then
runs the same transport in its explicit **clean-rebuild mode**, which accepts
only a pristine, empty canonical object and scheduler state. It drops and
recreates the two `IF NOT EXISTS` table/index objects from the embedded
canonical bytes before verifying the final schema, functions, ACLs, index,
scheduler, and provenance. Hosted production instead uses the transport's
**production-history mode**, which requires the canonical version and every
target object to be absent before it changes anything. The two modes prevent the
receipt from masking partial or substituted state.

## Safety boundary

This package does not authorize or perform a migration, raw DDL, migration
ledger edit, Edge deployment, Vapi change, Lovable publication, booking enable,
provider configuration, message delivery, Jobber contact, or test call.

See `operator-runbook.md` for the protected sequence and
`control-plane-evidence.md` for the evidence contract.
