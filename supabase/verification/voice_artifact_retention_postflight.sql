-- READ ONLY: postflight after the approved retention migration and at least
-- one scheduled execution. Output is privacy-safe aggregate/schema state only.

BEGIN TRANSACTION READ ONLY;

SELECT
  count(*) FILTER (
    WHERE version = '20260802043233'
  ) AS retention_migration_ledger_rows
FROM supabase_migrations.schema_migrations;

SELECT
  count(*) AS exact_job_rows,
  count(*) FILTER (
    WHERE active
      AND schedule = '7,17,27,37,47,57 * * * *'
      AND command =
        'SELECT private.purge_expired_voice_artifact_batch(500, NULL);'
  ) AS exact_active_job_rows,
  count(DISTINCT database) AS job_database_count,
  count(DISTINCT username) AS job_owner_count
FROM cron.job
WHERE jobname = 'bluladder-voice-artifact-retention-purge';

SELECT
  i.indisvalid AS retention_index_valid,
  i.indisready AS retention_index_ready
FROM pg_index AS i
WHERE i.indexrelid =
  'public.chat_messages_voice_retention_due_idx'::regclass;

SELECT
  NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'private', 'USAGE')
    AS private_schema_unavailable_to_api_roles,
  NOT has_function_privilege(
    'anon',
    'private.purge_expired_voice_artifact_batch(integer, uuid)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'private.purge_expired_voice_artifact_batch(integer, uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'private.purge_expired_voice_artifact_batch(integer, uuid)',
      'EXECUTE'
    ) AS purge_unavailable_to_api_roles;

SELECT
  started_at,
  finished_at,
  batch_size,
  rows_examined,
  rows_deleted,
  rows_skipped,
  rows_failed,
  elapsed_ms,
  status,
  error_code
FROM private.voice_artifact_purge_runs
ORDER BY started_at DESC, id DESC
LIMIT 1;

SELECT
  count(*) AS canonical_expired_remaining
FROM public.chat_messages AS m
INNER JOIN public.chat_conversations AS c
  ON c.id = m.conversation_id
WHERE c.channel = 'voice'
  AND c.organization_id IS NOT NULL
  AND m.role IN ('user', 'assistant')
  AND m.content IS NOT NULL
  AND btrim(m.content) <> ''
  AND m.tool_name IS NULL
  AND m.tool_result IS NULL
  AND m.ai_metadata ->> 'channel' = 'voice'
  AND m.ai_metadata ->> 'source' IN ('controller', 'end_of_call')
  AND m.ai_metadata ->> 'provider_call_id' = c.session_token
  AND private.try_parse_voice_retention_deadline(
    m.ai_metadata ->> 'retention_expires_at'
  ) <= clock_timestamp();

SELECT
  count(*) FILTER (WHERE status = 'failed') AS failed_runs,
  count(*) FILTER (WHERE status = 'skipped_concurrent')
    AS skipped_concurrent_runs,
  count(*) FILTER (WHERE rows_examined > batch_size)
    AS batch_limit_violations,
  count(*) FILTER (
    WHERE rows_deleted + rows_skipped + rows_failed > rows_examined
  ) AS metric_consistency_violations
FROM private.voice_artifact_purge_runs;

ROLLBACK;
