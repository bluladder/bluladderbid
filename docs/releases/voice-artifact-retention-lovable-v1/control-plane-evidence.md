# Voice artifact retention control-plane evidence contract

This document defines the minimum privacy-safe evidence needed to reconcile a
Lovable-assigned migration version with canonical repository version
`20260802043233`. It is not an execution record and does not authorize a hosted
action.

The supported release decision is preference **Option (c)**: Lovable-native
execution-version reconciliation with exact payload hashing and a generated Git
receipt.

## Proven mechanism constraints

| Mechanism                        | Finding                                                                                                                              | Release consequence                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Lovable Cloud database migration | Supported input exposes `description` and `query`, not a caller-supplied version. Existing hosted rows show execution-time versions. | Preserve Lovable's version and bind it to canonical SQL by exact stored-statement hash. |
| Repository GitHub Actions        | No existing production migration workflow or proven required Supabase secret-name presence.                                          | Do not add or assume a secret-backed deployment path for this release.                  |
| Direct Supabase connector        | Visible project is unrelated to BluLadder Bid production.                                                                            | Never use it for inspection or mutation of this release.                                |
| Migration-ledger repair          | Prohibited by repository policy and this release.                                                                                    | Reconcile repository files forward; never rewrite hosted history.                       |

The 151-row hosted ledger is mixed legacy history rather than a one-to-one copy
of repository filenames: 50 rows have blank names, five have UUID-shaped names,
and 96 have descriptive names; every row stores one SQL statement. Recent
Lovable-native rows use platform-assigned timestamp versions and UUID-shaped
names, while the separately applied exact-version Stage 7B row has a distinct
creator fingerprint. The prior Lovable Stage 7B reconciliation also proved the
single supported storage normalization used here: removal of one terminal line
feed from the submitted one-statement payload.

## Baseline evidence

The release manifest pins the complete values; evidence must not abbreviate them
even though this document shows only the verified ledger fingerprint prefix
`3366…`.

- project identity: Lovable project `b6e0d823-59c4-4b5a-afbe-182485e5458b`,
  Supabase ref `gyndziiuizpgwhqwyrvn`;
- hosted ledger row count: 151;
- hosted ledger tip: `20260801234014`;
- full ordered-ledger fingerprint: manifest value, verified prefix `3366…`;
- repository source version: `20260802043233`;
- canonical source SHA-256:
  `a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102`;
- target retention objects and scheduler absent;
- fresh aggregate retention/tenant/lock gates passing.

The catalog-only adversarial check also proved that production has no existing
`private` schema, no purge-command cron job under another name, and no
delete-side-effect trigger/rule or inbound foreign key on `chat_messages`. The
release-provenance primary key, seven check constraints, sole default, exact
BEFORE-UPDATE/DELETE trigger, rejection function, owner, and private ACLs match
the reviewed Stage 7B authority. The control envelope rechecks these as
transaction-time stop gates.

Any baseline drift invalidates authorization. A new migration cannot be folded
into this release merely by updating the expected row count.

## Artifact evidence

`release.json` must pin:

- source path, version, raw byte count, Git object identity, and SHA-256;
- deterministic assembler and checker paths;
- generated transport path, raw hash, byte count, and exactly one explicit
  transaction;
- the exact two-mode precondition control and one private append-only provenance
  insert atomic with the canonical payload;
- the expected hash and byte count after Lovable's observed transformation of
  removing one terminal line feed;
- preflight and postflight paths/hashes;
- exact production identities and baseline ledger fingerprint;
- evidence schema/validator and generated-receipt checker identities.

The assembler must preserve the canonical bytes verbatim inside the envelope.
The platform-normalized hash is not a second permissible SQL payload; it is the
same transport with the single historically observed storage transformation. Any
other whitespace, comment, line-ending, or statement change fails.

## Hosted execution evidence

Postflight may accept an execution only when one and only one ledger row is new
relative to the pinned baseline and all of these fields validate:

- execution version: valid platform timestamp shape and later than the pinned
  tip;
- statement cardinality: exactly one;
- stored-statement bytes and SHA-256: exact manifest values;
- migration-name shape and creator fingerprint: exact manifest contract, stored
  only in privacy-safe/hash form where appropriate;
- no second row with the same statement hash;
- exact retention object/function/index/privilege/job state;
- exactly one matching private release-provenance row;
- no unrelated migration or schema change.

Neither the execution version nor the migration description is authority for SQL
identity. The version/hash pair is indivisible.

## Ambiguous and partial states

The SQL transport's explicit transaction prevents partial PostgreSQL object
commit. The platform ledger is a separately verified control-plane record.
Evidence validation must reject each of these states:

- some target objects exist but others do not;
- target objects exist with no unique exact-hash ledger row;
- exact-hash row exists but object postflight fails;
- a new row uses the observed version but different SQL;
- two new rows exist or two rows share the expected hash;
- a scheduler job exists with a different command, owner, database, schedule, or
  active state;
- the hosted baseline changed before approval;
- the canonical active migration changes path, bytes, version, or hash;
- the control envelope accepts partial production state or a substituted clean
  rebuild.

Rejection means stop, no retry, no ledger repair, and no broad rollback. Resolve
with read-only evidence and a separately reviewed forward repair.

## Repository receipt evidence

The receipt bridges platform-assigned history to future CLI behavior. It is
accepted only after the hosted execution is unambiguous and Lovable's existing
Git integration produces its execution-version migration commit.

The receipt must prove:

1. its filename version equals the unique hosted execution version;
2. its bytes equal the exact reviewed transport bytes;
3. its hash equals the release manifest transport hash;
4. the hosted statement equals the documented terminal-line-feed-normalized
   transport hash;
5. the original canonical version remains simultaneously active and
   byte-identical under `supabase/migrations` for clean rebuilds;
6. the receipt version is later than the canonical version and collides with no
   other active migration;
7. an ordinary dry-run reports no pending retention migration.

Creating or committing this file does not repair the hosted ledger. It gives a
future linked Supabase CLI the same later version Lovable already recorded.
Ordinary `db push` then skips the older missing canonical version because it is
behind the remote tip. Repository policy permanently forbids `--include-all`,
historical replay, and repair, any of which would bypass that ordering safety.
Until the receipt is merged, all migration CLI operations remain prohibited.

For a clean rebuild, the canonical migration applies first and the later receipt
runs the generated transport's clean-rebuild path. That path must prove the
exact complete canonical object and scheduler state before its idempotent
convergence and provenance insert. Production-history mode requires the
canonical version and all target objects to be absent before execution.

## Privacy boundary

Evidence may include project/ref, versions, release IDs, hashes, aggregate
counts, object identities, schedules, statuses, elapsed time, and SQLSTATE. It
must never include transcript/message content, customer data, contact details,
full provider identifiers or payloads, secrets, credentials, or free-form
database errors that could contain sensitive values.
