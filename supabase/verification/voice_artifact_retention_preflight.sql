-- READ ONLY: hosted preflight for the 30-day voice artifact purge migration.
-- Output is aggregate/schema state only. Never add message content, contact
-- fields, provider payloads, provider identifiers, or credentials.

BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS database_role,
  current_setting('server_version') AS postgres_version,
  clock_timestamp() AS checked_at;

SELECT
  to_regclass('public.chat_messages') IS NOT NULL AS chat_messages_present,
  to_regclass('public.chat_conversations') IS NOT NULL AS chat_conversations_present,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'ai_metadata'
      AND data_type = 'jsonb'
  ) AS ai_metadata_present,
  (
    SELECT count(*) = 3
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_conversations'
      AND column_name IN ('organization_id', 'channel', 'session_token')
  ) AS conversation_authority_columns_present;

SELECT
  extversion AS pg_cron_version
FROM pg_extension
WHERE extname = 'pg_cron';

SELECT
  count(*) FILTER (
    WHERE version = '20260802043233'
  ) AS retention_migration_ledger_rows
FROM supabase_migrations.schema_migrations;

SELECT
  count(*) AS existing_exact_name_jobs,
  count(*) FILTER (WHERE active) AS existing_active_exact_name_jobs
FROM cron.job
WHERE jobname = 'bluladder-voice-artifact-retention-purge';

SELECT
  count(*) FILTER (
    WHERE l.granted
      AND l.pid <> pg_backend_pid()
      AND l.mode IN (
        'RowExclusiveLock',
        'ShareUpdateExclusiveLock',
        'ShareLock',
        'ShareRowExclusiveLock',
        'ExclusiveLock',
        'AccessExclusiveLock'
      )
  ) AS current_chat_messages_writer_or_ddl_locks
FROM pg_locks AS l
WHERE l.relation = 'public.chat_messages'::regclass;

SELECT
  count(*) FILTER (
    WHERE pid <> pg_backend_pid()
      AND xact_start < clock_timestamp() - interval '5 minutes'
  ) AS transactions_open_over_five_minutes
FROM pg_stat_activity
WHERE datname = current_database();

WITH artifact_rows AS (
  SELECT
    c.channel AS conversation_channel,
    c.organization_id,
    c.session_token,
    m.role,
    m.content IS NOT NULL AND btrim(m.content) <> ''
      AND m.tool_name IS NULL AND m.tool_result IS NULL AS artifact_shape_ok,
    m.ai_metadata ->> 'channel' AS metadata_channel,
    m.ai_metadata ->> 'source' AS artifact_source,
    m.ai_metadata ->> 'provider_call_id' AS provider_call_id,
    m.ai_metadata ->> 'retention_expires_at' AS retention_marker
  FROM public.chat_messages AS m
  LEFT JOIN public.chat_conversations AS c
    ON c.id = m.conversation_id
), marker_classification AS (
  SELECT
    *,
    retention_marker ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      AND pg_input_is_valid(retention_marker, 'timestamp with time zone')
      AS marker_is_strict_valid
  FROM artifact_rows
), classified AS (
  SELECT
    *,
    CASE
      WHEN marker_is_strict_valid THEN retention_marker::timestamptz
      ELSE NULL
    END AS retention_deadline,
    conversation_channel = 'voice'
      AND organization_id IS NOT NULL
      AND role IN ('user', 'assistant')
      AND artifact_shape_ok
      AND metadata_channel = 'voice'
      AND artifact_source IN ('controller', 'end_of_call')
      AND provider_call_id = session_token
      AND marker_is_strict_valid AS canonical_artifact
  FROM marker_classification
)
SELECT
  count(*) AS total_chat_messages_examined,
  count(*) FILTER (
    WHERE canonical_artifact
      AND retention_deadline <= clock_timestamp()
  ) AS canonical_expired_eligible,
  count(*) FILTER (
    WHERE canonical_artifact
      AND retention_deadline > clock_timestamp()
  ) AS canonical_unexpired,
  count(*) FILTER (WHERE conversation_channel IS DISTINCT FROM 'voice')
    AS non_voice_or_missing_parent,
  count(*) FILTER (
    WHERE conversation_channel = 'voice' AND organization_id IS NULL
  ) AS voice_parent_missing_organization,
  count(*) FILTER (WHERE metadata_channel IS DISTINCT FROM 'voice')
    AS non_voice_metadata,
  count(*) FILTER (
    WHERE artifact_source IS NULL
      OR artifact_source NOT IN ('controller', 'end_of_call')
  ) AS disallowed_or_missing_source,
  count(*) FILTER (
    WHERE provider_call_id IS DISTINCT FROM session_token
  ) AS provider_session_mismatch,
  count(*) FILTER (WHERE retention_marker IS NULL) AS null_retention_marker,
  count(*) FILTER (
    WHERE retention_marker IS NOT NULL AND NOT marker_is_strict_valid
  ) AS malformed_retention_marker,
  count(*) FILTER (
    WHERE role NOT IN ('user', 'assistant') OR NOT artifact_shape_ok
  ) AS non_artifact_shape
FROM classified;

ROLLBACK;
