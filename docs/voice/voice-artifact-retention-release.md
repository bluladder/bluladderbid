# Voice artifact retention release procedure

Status: **review-only; not deployed or applied**\
Baseline: `86502a65719b6f42141be986c0dfcb729d0a1941`\
Migration: `20260802043233_voice_artifact_retention_purge.sql`

This runbook is the activation boundary for the 30-day transcript/message
retention markers introduced by merged PR #75. Repository approval does not
authorize a database migration, Edge deployment, Vapi change, provider call, or
paid test call. Obtain separate approval for each production step and stop on
any discrepancy.

`VOICE_LIVE_BOOKING_ENABLED=false` throughout this release. Do not enable live
booking as part of retention activation or the controlled call.

## Audited storage and writers

The audit found one transcript/message table and one tenant-authority parent:

| Table                               | Columns involved                                                                                                                                                            | Purge use                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `public.chat_messages`              | `id`, `conversation_id`, `role`, `content`, `tool_name`, `tool_result`, `ai_metadata`, `created_at`                                                                         | Only `id` rows passing every predicate are deleted. `created_at` is audited but deliberately not used as an expiry fallback. |
| `public.chat_conversations`         | `id`, `channel`, `organization_id`, `session_token`                                                                                                                         | Read, joined, and row-locked to prove tenant/channel/provider lineage. Never updated or deleted.                             |
| `public.knowledge_feedback`         | `message_id`                                                                                                                                                                | Existing nullable, non-FK reference was audited. It is not read, changed, cascaded, or treated as purge authority.           |
| `private.voice_artifact_purge_runs` | `id`, `started_at`, `finished_at`, `organization_scope`, `batch_size`, `rows_examined`, `rows_deleted`, `rows_skipped`, `rows_failed`, `elapsed_ms`, `status`, `error_code` | New privacy-safe operational evidence only; no artifact or customer content.                                                 |

The retention marker and discriminator fields are JSON keys inside
`chat_messages.ai_metadata`: `channel`, `source`, `provider_call_id`, and
`retention_expires_at`. Controller writes originate in
`_shared/voice/controllerRoute.ts`; end-of-call writes originate in
`_shared/voice/vapiArtifactJournal.ts`; both use the 30-day helper in
`_shared/voice/turnJournal.ts`. Legacy journal calls can have a null deadline
and source `legacy`; they are intentionally ineligible rather than assigned a
new deadline.

No foreign key points from `knowledge_feedback.message_id` to
`chat_messages.id`, so deleting an eligible transcript row causes no cascade. No
other repository table stores the canonical bounded voice transcript.

## Exact data boundary

The purge deletes from one table only: `public.chat_messages`.

A row is eligible only when all of the following are true at the same locked
database snapshot:

1. Its parent `public.chat_conversations` row has `channel = 'voice'` and a
   non-null canonical `organization_id`.
2. An organization-scoped manual invocation, when used, matches that parent
   organization.
3. The message role is `user` or `assistant`, content is non-empty, and both
   tool fields are null.
4. `ai_metadata.channel` is `voice` and `ai_metadata.source` is exactly
   `controller` or `end_of_call`.
5. `ai_metadata.provider_call_id` exactly matches the parent conversation's
   `session_token`.
6. `ai_metadata.retention_expires_at` is a strict JavaScript UTC ISO timestamp
   (`YYYY-MM-DDTHH:MM:SS.mmmZ`) and is at or before the batch cutoff.

Null, malformed, offset-form, legacy-source, mismatched-provider, web-parent,
tool, system, blank, and unexpired rows fail closed and remain untouched. There
is no fallback to `created_at`.

The purge never deletes conversations, quote sessions, quotes, customers,
properties, bookings, SMS/email records, provider reconciliation evidence, or
any other table. It does not update a conversation or business record.

## Migration and scheduler behavior

- The existing Supabase `pg_cron` extension is the only scheduler.
- One named job, `bluladder-voice-artifact-retention-purge`, runs at minutes 7,
  17, 27, 37, 47, and 57 of every hour.
- Each invocation locks and examines at most 500 eligible rows, uses
  `FOR UPDATE ... SKIP LOCKED` on both message and tenant-authority parent,
  rechecks every predicate at deletion, and deletes only the selected UUIDs.
- Index creation has a five-second lock timeout and two-minute statement
  timeout. The migration fails instead of waiting through an unsafe writer lock
  or unexpectedly large build.
- A transaction-scoped advisory lock makes cron/manual overlap fail fast.
  `pg_cron` also prevents overlapping runs of the same named job.
- Retries are idempotent because already-deleted UUIDs are absent and no
  deadline is synthesized for skipped rows.
- The named `cron.schedule` call converges on one job definition when the
  migration is replayed; it never writes `cron.job` directly and makes no HTTP
  or Edge invocation.
- Private run metrics contain only run UUID, optional organization UUID,
  timestamps, batch size, examined/deleted/skipped/failed counts, elapsed
  milliseconds, status, and SQLSTATE. They contain no message text, transcript,
  contact details, provider IDs or payloads, exception text, or credentials.
- A batch-level delete error is rolled back and recorded as a privacy-safe
  failure. A metrics-write error rolls back the entire statement, including the
  delete.

## Release order

### 1. Merge

Merge only the exact reviewed PR head after all exact-head CI and Secret Scan
checks pass. Confirm the merged tree still contains the unchanged Stage 7B
tenant-authority migration and all protected-contract checks. Merging does not
apply the new migration.

### 2. Fresh hosted preflight

Run a new read-only preflight against the expected Supabase project. Do not
reuse PR evidence. Execute
`supabase/verification/voice_artifact_retention_preflight.sql` unchanged and
record counts only; do not export content or identifiers.

Confirm:

- the hosted project reference is the approved project;
- `VOICE_LIVE_BOOKING_ENABLED` is absent or `false` by presence/status check,
  without displaying secret values;
- the migration ledger does not yet contain `20260802043233`;
- `pg_cron` is installed and healthy;
- no existing cron job uses the new exact job name;
- `chat_messages.ai_metadata` and
  `chat_conversations.organization_id/channel/session_token` exist;
- every would-be candidate has a non-null parent organization, a voice parent,
  an exact provider/session match, an approved source, and a valid passed
  deadline;
- counts of null, malformed, legacy, provider-mismatched, web-parent, tool,
  blank, and unexpired rows are reported separately and are not candidates;
- no long transaction or conflicting lock makes index creation unsafe.

Use aggregate projections only. A suitable candidate predicate is the exact
predicate in the migration; do not substitute `created_at`, phone, email, caller
metadata, or the only active organization.

Stop if tenant lineage conflicts, the expected columns differ, the migration is
unexpectedly present, a duplicate scheduler exists, or the candidate count
cannot be explained without reading transcript content.

### 3. Apply the migration

During an approved database change window, apply exactly
`20260802043233_voice_artifact_retention_purge.sql` through the established
Supabase migration process. Do not paste an edited SQL variant and do not run
the repository rehearsal against production.

Stop and roll back the transaction if the index cannot acquire its lock, the
private objects cannot be created, `cron.schedule` is unavailable, or any
statement differs from the reviewed SHA. Applying the migration activates the
scheduled purge; that activation requires explicit owner approval.

### 4. Verify the bounded purge

Before any Edge or Vapi change:

1. Confirm the migration ledger contains exactly `20260802043233` once.
2. Query `cron.job` read-only and confirm exactly one active job has the exact
   name, schedule, database, owner, and function-only command from the
   migration. Do not update `cron.job` directly.
3. Wait for one scheduled execution.
4. Read only the newest private aggregate run row. Require batch size at most
   500, non-negative internally consistent counts, elapsed time below the
   operations threshold, and status `deleted` or `no_candidates`.
5. Re-run the aggregate preflight. Eligible expired count must decrease by no
   more than the recorded deletion count; all non-eligible buckets and parent
   tables must be unchanged.
6. Confirm no failed or repeatedly skipped-concurrent run and no unexpected
   `cron.job_run_details` error.

Run `supabase/verification/voice_artifact_retention_postflight.sql` unchanged
for the schema/job/privilege/metric assertions, then rerun the preflight file
for the full bucket comparison.

Stop before provider reconciliation if any count, tenant boundary, scheduler
definition, or metric is inconsistent.

### 5. Deploy the two voice Edge bundles

Only after the database verification passes and Edge deployment receives its own
approval, deploy `voice-llm-adapter` and `voice-vapi-events` from the same
reviewed repository SHA, including their shared dependencies. Keep live booking
false. Run provider-stub and read-only health checks; do not send SMS, email,
contact Jobber, or place a call during this step.

### 6. Reconcile the Vapi manifest

Only after a separately approved provider-configuration window, reconcile the
isolated assistant to `buildVoiceBetaAssistantManifest()` in
`supabase/functions/_shared/voiceProviderConfig.ts`:

- Language: English (`en`).
- Primary transcriber: Deepgram **Nova-3**, English, smart formatting enabled.
- Approved keyterms, exactly and in order: `BluLadder`, `McKinney`, `Frisco`,
  `Prosper`, `Allen`, `Celina`, `Aubrey`, `Little Elm`, `Melissa`, `Anna`,
  `Plano`, `Binbranch`, `Parkland`, `window cleaning`, `gutter cleaning`,
  `house washing`, `pressure washing`, `solar screens`.
- Explicit fallback: AssemblyAI Universal Streaming English with the same
  keyterm prompt and VAD-assisted endpointing enabled; implicit automatic
  fallback disabled.
- Start speaking wait: 0.4 seconds; Vapi smart endpointing enabled; punctuation
  wait 0.3 seconds; no-punctuation wait 1.2 seconds; spoken-number wait 1.0
  second.
- Logging: enabled.
- Full message history: enabled.
- Transcript artifact: enabled.
- End-of-call artifact event: `end-of-call-report` enabled. Allowed events
  remain only `assistant.started`, `status-update`, `hang`, and
  `end-of-call-report`.
- Raw recording: disabled.
- Video recording: disabled.
- PCAP: disabled.
- Summary: disabled.
- Structured-data analysis: disabled.
- Success analysis: disabled.
- Tools and transfer destination: none.
- Maximum duration and warning/cutoff copy: unchanged from the manifest.

Verify dashboard values without copying secrets, contact data, or transcripts
into release evidence. Stop if Vapi cannot match the reviewed manifest or its
Zero Data Retention requirement.

### 7. Authorize and run one controlled paid call

Only after the previous six gates pass, obtain a final, explicit authorization
for one paid call. Use the existing isolated direct-DID worksheet and a
synthetic, approved-service-area identity. Keep live booking false. During the
call:

1. Request one supported quote.
2. Spell one address component and correct one name component.
3. Explicitly confirm the captured name, phone, email, and address.
4. Request quote delivery by text and ask for availability.
5. Verify the caller hears no booking-success claim and no live booking occurs.
6. Verify one same-tenant conversation/session projection, one signed quote, one
   approved message attempt, one copy of each bounded turn, the exact 30-day
   retention marker shape, and no raw recording/video/PCAP/analysis.
7. Replay the same end-of-call artifact only through the approved stub harness
   and verify zero duplicate rows.

Stop immediately on tenant mismatch, false success language, repeated question,
stale quote, ambiguous identity, missing projection, unexpected provider action,
raw/sensitive log content, duplicate row, or missing expiry.

## Scheduler pause and rollback

There is no content restore: successfully expired/deleted artifacts must not be
recreated from a provider. If the purge is unsafe, pause future executions using
the supported `cron.alter_job(job_id, active := false)` API after resolving the
exact job ID by its unique name. Never update `cron.job` directly.

For a full schema rollback in an approved database window:

1. Use `cron.unschedule('bluladder-voice-artifact-retention-purge')` and verify
   the named job is absent.
2. Preserve the privacy-safe run metrics as release evidence unless privacy or
   legal review explicitly directs otherwise.
3. Drop the purge function, strict parser, and partial index only after proving
   no job or operator can call them.
4. Drop the metrics table/private schema only if separately approved and the
   schema has no unrelated objects.
5. Restore prior Edge bundles and prior Vapi manifest only within separately
   authorized windows; keep live booking false.

Pausing or rolling back the mechanism does not authorize provider retention or
continued transcript delivery without an approved replacement purge.

## Evidence to retain

Retain only repository SHA, migration ledger status, exact cron definition,
aggregate preflight buckets, privacy-safe purge metrics, Edge bundle versions,
manifest checkbox results, and sanitized controlled-call pass/fail outcomes.
Never retain transcript content, names, full addresses, phone numbers, email
addresses, provider payloads, credential values, or raw exception text in the
release record.
