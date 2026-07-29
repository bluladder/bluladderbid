# Stage 7D cron window rehearsal

Status: repository package complete; protected cron mutation is not authorized.

Read-only hosted evidence on 2026-07-28 confirmed pg_cron 1.6.4, the supported
six-argument `cron.alter_job` signature, operator execute privilege, all three
jobs active with the expected schedules/fingerprints, and zero active runs at
the evidence instant.

## Secret boundary

Never select, log, export, reconstruct, unschedule, or reschedule a job command.
MD5 fingerprints are change detectors, not security hashes. Evidence may contain
only extension version, function/privilege booleans, job ID, schedule, active
state, fingerprint, run ID/status/timestamps, operator, reviewer, and transaction
timestamps. Never retain `command` or `return_message`.

## Future protected sequence

1. Run `tenant_stage_7d_cron_window_precheck.sql` read-only.
2. Require pg_cron 1.6.4, available/authorized `cron.alter_job`, exactly jobs
   3/5/6 with expected active state, schedules, and fingerprints, and no
   starting/running invocation.
3. Under separate cron-configuration authorization, run
   `tenant_stage_7d_cron_pause.sql`.
4. Require exactly three inactive rows with unchanged schedules/fingerprints.
5. Poll `tenant_stage_7d_cron_drain.sql` every five seconds. Reset the stability
   timer if any row appears. Require zero rows continuously for at least 65
   seconds before database migration.
6. After migration verification—or after an aborted/failed migration—run
   `tenant_stage_7d_cron_restore.sql`.
7. Require exactly three active rows with unchanged schedules/fingerprints.

The exact protected state-changing calls are:

```sql
SELECT cron.alter_job(3, active := false);
SELECT cron.alter_job(5, active := false);
SELECT cron.alter_job(6, active := false);
```

Restoration uses the same calls with `true`. The repository scripts use
`PERFORM` inside an atomic, serializable validation block.

## Failure recovery

| Observation | Required response |
|---|---|
| Pause transaction errors | Transaction rolls back; confirm all three remain active |
| Commit acknowledgment lost | Read safe state: all active means not paused; all inactive means paused; mixed/missing/fingerprint drift means stop |
| Drain does not stabilize | Leave jobs paused, abort migration, investigate |
| Migration fails | Preserve database evidence, then run reviewed restoration |
| Restore transaction errors | Rollback leaves jobs inactive; escalate and do not improvise |
| Any fingerprint changes | Stop; do not inspect command text |

Direct writes to `cron.job`, `cron.schedule`, `cron.unschedule`, or job
recreation are prohibited by this package.
