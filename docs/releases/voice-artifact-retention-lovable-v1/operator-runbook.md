# Voice artifact retention Lovable Cloud operator runbook

Status: **review-only**. Follow this runbook only after the release-control PR
is merged and the exact production authorization at the end is given. Repository
approval alone does not authorize a hosted action.

## Absolute prohibitions

- Do not use the direct Supabase connector; it points at an unrelated project.
- Do not manually insert, delete, rename, or repair a migration-ledger row.
- Do not execute raw DDL outside Lovable's supported migration approval flow.
- Do not execute a mutating `supabase db push`; specifically, never run
  `supabase db push --include-all`, migration repair, or a historical replay.
  Never run `supabase migration repair` for this release. The sole CLI use
  permitted here is the manifest-pinned read-only dry-run after the receipt
  commit.
- Do not retry after an error, timeout, disconnect, or uncertain approval
  result.
- Do not deploy Edge Functions, change Vapi, publish Lovable, enable live
  booking, contact a provider, send a message, or place a call.

## Gate 0 — immutable release package

From the exact merged release commit:

1. Run the release contract checker and deterministic assembler named in
   `release.json`.
2. Require source version `20260802043233` and canonical SHA-256
   `a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102`.
3. Require the generated Lovable transport to match every manifest path, hash,
   byte count, transaction count, and normalization hash. The reviewed raw
   artifact SHA-256 is
   `ba5c00e1e5301834fbb5182edd4d5730d25cc1f1e95719a146645f378ad75fed`.
4. Require the canonical source to remain at its manifest-pinned active
   `supabase/migrations` path with exact bytes and hash. Require no generated
   Lovable-version receipt before production execution.
5. Require the evidence validator's adversarial fixtures to reject substituted
   source SQL, substituted transport SQL, a second new ledger row, a mismatched
   execution version/hash pair, partial object state, and premature receipt
   creation.

Stop on any generated diff or mismatch. Do not regenerate from production and do
not hand-edit the artifact or manifest.

## Gate 1 — identify the only allowed backend

In Lovable Cloud, open BluLadder Bid project
`b6e0d823-59c4-4b5a-afbe-182485e5458b` and confirm its attached production
backend reference is exactly `gyndziiuizpgwhqwyrvn`.

Confirm `VOICE_LIVE_BOOKING_ENABLED` remains absent or false by secret-name and
status only; never display or retain its value. Stop if project identity is
ambiguous or if any connected tool shows a different project.

## Gate 2 — fresh read-only preflight

Run the manifest-pinned Lovable preflight through the read-only database query
tool, one `SELECT` per call. Do not submit transaction control or a multi-query
batch through that tool. Retain only aggregate/catalog output and hashes; never
retain transcript text, contact data, provider payloads, identifiers, or
secrets.

Require all of the following:

- production project reference exactly `gyndziiuizpgwhqwyrvn`;
- exactly 151 migration rows, tip `20260801234014`, and the complete ledger
  fingerprint pinned in `release.json` (prefix `3366…`);
- no repository version `20260802043233` and no statement matching the expected
  Lovable transport hash already in the hosted ledger;
- no migration after the pinned tip;
- the exact retention schema/column/extension prerequisites;
- no target function, metrics object, partial index, or named scheduler job;
- the `private` schema is absent and no cron job under any name references the
  purge function;
- the release-provenance primary key, constraints, default, trigger/function
  semantics, owner, and ACLs match the reviewed Stage 7B authority;
- `chat_messages` has no inbound foreign key, non-internal DELETE trigger, or
  DELETE rewrite rule that could expand the reviewed deletion scope;
- every aggregate tenant, retention, scheduler, eligibility, lock, and
  malformed-marker gate from the retention preflight passes;
- live booking remains false;
- no conflicting lock or long transaction makes index creation unsafe.

The pinned ledger baseline makes concurrent migration activity a stop gate. If
the count, tip, fingerprint, object state, or eligibility buckets differ, stop
without approval and re-review the release package.

## Gate 3 — review one complete generated migration

Attach only the manifest-pinned generated Lovable transport in Lovable chat. Ask
Lovable to prepare one database migration and show the complete SQL approval
card without executing it.

Compare the complete card with the generated file. Require:

- one leading `BEGIN;` and one terminal `COMMIT;`;
- the exact canonical source bytes inside that envelope;
- no second migration, added statement, substituted value, placeholder,
  truncation, or unrelated DDL;
- the exact production-history and clean-rebuild preconditions plus one private
  release-provenance insert after the canonical bytes;
- the clean-rebuild-only pristine/empty-state gate and exact table/index
  recreation from the embedded canonical source;
- the exact production backend shown in Gate 1.

Lovable's migration interface accepts a description and query, not a caller
version. Do not type or imply that the approval card preserves `20260802043233`;
the canonical repository version is reconciled by hash after execution.

## Gate 4 — approve exactly once

After the owner authorization is recorded, approve the complete migration card
exactly once. Record approval ID and start/finish UTC. Retain the Lovable chat
approval history and privacy-safe database logs.

If the UI errors, disconnects, times out, or leaves the outcome uncertain, do
not approve again. Proceed only to the read-only ambiguity checks in Gate 5.

## Gate 5 — immediate read-only postflight

Run the manifest-pinned postflight one `SELECT` per call. It must prove:

1. The original 151-row baseline remains an exact prefix of history.
2. Exactly one newer ledger row exists.
3. That row has a valid Lovable execution-time version greater than
   `20260801234014`, exactly one stored statement, and the expected
   platform-shape metadata without exposing its raw values.
4. PostgreSQL SHA-256 over the stored statement equals the manifest's expected
   transport-ledger hash after only the documented removal of one terminal line
   feed.
5. The retention function, strict timestamp parser, private metrics object,
   privileges, bounded partial index, and sole purge-command `pg_cron` job match
   the reviewed migration, including exact database and owner.
6. Exactly one private append-only release-provenance row matches the
   manifest-bound release, project, source, control, and artifact identities.
7. No unrelated schema, scheduler, tenant, or message object changed.

The observed execution version is valid only as a pair with the exact statement
hash. A matching version with different SQL, matching SQL in more than one row,
an extra new migration, or correct objects without the unique ledger row is a
hard failure.

If postflight cannot establish a unique committed state, keep live booking false
and do not retry. If the scheduler exists in an unsafe or ambiguous state, pause
it only through a separately authorized, exact-name `cron.alter_job` operation;
never update `cron.job` directly. Open an incident and use a reviewed forward
repair. Do not rewrite history.

## Gate 6 — one bounded scheduler observation

Only after Gate 5 passes, wait for one scheduled interval and run the existing
privacy-safe retention postflight. Record aggregate examined, deleted, skipped,
failed, elapsed, and status values only. Require the documented batch maximum,
internally consistent non-negative metrics, one exact job, and no change to
ineligible buckets or parent records.

An unexpected count, tenant boundary, job definition, or failure state blocks
the receipt and every later release step.

## Gate 7 — capture the execution receipt

Record the unique Lovable execution version and the exact stored-statement hash
in the manifest-defined evidence file. Validate it against the fresh preflight,
postflight, approval history, and generated transport.

Then inspect Lovable's bot-generated Git migration commit. It must contain one
active migration file named with the observed Lovable version and the exact
reviewed transport bytes. Run the repository release checker; it must fail
unless:

- the evidence is complete and cryptographically bound to this release;
- the execution version is the unique post-baseline hosted row;
- source, transport, normalized ledger, and receipt hashes all agree;
- the canonical migration remains active and byte-identical at version
  `20260802043233`;
- the observed execution version is later than the canonical version and does
  not collide with any active migration;
- no other active file claims either identity.

Commit and merge that receipt before any Supabase CLI migration operation. Until
then, migration tooling is frozen. The receipt commit is repository
reconciliation only: it must not execute SQL or mutate the hosted ledger. Do not
manufacture a replacement if Lovable does not produce the expected commit; keep
migration tooling frozen and stop.

## Gate 8 — release closeout

Retain:

- the exact merged release commit and `release.json`;
- Git hashes for canonical source and generated transport;
- fresh preflight and postflight output hashes;
- owner authorization and Lovable approval history;
- the unique execution-version/statement-hash pair;
- privacy-safe database log hash and bounded purge aggregate evidence;
- the receipt commit and a CLI dry-run showing no pending retention migration.

The CLI dry-run must be read-only and must happen only after the receipt commit
is merged. Under ordinary `db push` ordering, the later remote/receipt version
causes the older missing canonical version to remain skipped. Any pending
retention migration means reconciliation failed: the dry-run must select
nothing. Do not push. Never use `--include-all`, which deliberately selects
older missing versions.

## Failure disposition

| Observation                                                            | Required action                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Failure before Lovable approval                                        | Stop; production is unchanged.                                                                     |
| PostgreSQL error inside the explicit transaction                       | Verify complete rollback read-only; never retry without a new authorization and root-cause review. |
| Unknown Lovable outcome                                                | Do not retry; run read-only ledger and object reconciliation.                                      |
| Objects absent and no matching new row                                 | Record not-applied evidence; a new attempt still requires new authorization.                       |
| Objects present and unique exact-hash row present                      | Treat as committed only if every postflight assertion passes.                                      |
| Objects/ledger disagree, hash differs, or more than one new row exists | Incident; keep controls disabled and prepare a forward repair. Never repair history ad hoc.        |
| Receipt cannot be generated exactly                                    | Freeze migration tooling and resolve the discrepancy before any CLI use.                           |

## Exact one-step production authorization

> I authorize exactly one Lovable Cloud migration approval for release
> `voice-artifact-retention-lovable-v1` on production project
> `b6e0d823-59c4-4b5a-afbe-182485e5458b` / backend `gyndziiuizpgwhqwyrvn`, using
> repository version `20260802043233`, canonical SHA-256
> `a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102`, and the
> exact merged manifest hashes, only after the fresh preflight passes; approve
> once, never retry ambiguity, run only the pinned read-only postflight and one
> bounded scheduler observation, and stop before any Edge, Vapi, booking,
> provider, messaging, or call action.
