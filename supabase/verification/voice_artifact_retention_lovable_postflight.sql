-- READ ONLY: Lovable-native postflight for the checksum-pinned voice artifact
-- retention release. Output is migration/schema aggregates only; never add
-- stored SQL, artifact content, contact data, provider IDs, or credentials.

BEGIN TRANSACTION READ ONLY;

WITH ledger AS (
  SELECT
    version,
    cardinality(statements) AS statement_count,
    octet_length(COALESCE(array_to_string(statements, E'\x1e'), ''))
      AS statement_bytes,
    encode(
      extensions.digest(
        convert_to(
          COALESCE(array_to_string(statements, E'\x1e'), ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) AS statement_sha256,
    COALESCE(name, '<NULL>') AS migration_name
  FROM supabase_migrations.schema_migrations
), classified AS (
  SELECT
    *,
    statement_count = 1
      AND (
        (
          statement_bytes = 27671
          AND statement_sha256 =
            'ba5c00e1e5301834fbb5182edd4d5730d25cc1f1e95719a146645f378ad75fed'
        )
        OR (
          statement_bytes = 27670
          AND statement_sha256 =
            '7c55e5f1389c6003a81dc6951629f9db2fed5416afe4e18c1f2081eda8d92530'
        )
      ) AS exact_release_payload
  FROM ledger
), baseline AS (
  SELECT
    count(*) AS row_count,
    encode(
      extensions.digest(
        convert_to(
          string_agg(
            version || E'\x1f' || migration_name || E'\x1f' ||
              statement_count::text || E'\x1f' || statement_sha256,
            E'\x1d' ORDER BY version
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) AS fingerprint
  FROM classified
  WHERE version <= '20260801234014'
)
SELECT
  (SELECT count(*) FROM classified) AS ledger_rows,
  (SELECT row_count FROM baseline) AS preserved_baseline_rows,
  (SELECT fingerprint FROM baseline) AS preserved_baseline_fingerprint,
  (SELECT fingerprint FROM baseline) =
    '3366d93be81fb4d5056a93d91a2474df380b3707124568b2c6fc5f1a19f70d0d'
    AS preserved_baseline_matches,
  count(*) FILTER (WHERE version > '20260801234014') AS new_ledger_rows,
  count(*) FILTER (WHERE exact_release_payload) AS exact_payload_rows,
  count(*) FILTER (
    WHERE version > '20260801234014' AND exact_release_payload
  ) AS exact_new_payload_rows,
  count(*) FILTER (WHERE version = '20260802043233')
    AS canonical_source_version_rows,
  min(version) FILTER (WHERE exact_release_payload) AS lovable_execution_version,
  min(statement_count) FILTER (WHERE exact_release_payload)
    AS stored_statement_count,
  min(statement_bytes) FILTER (WHERE exact_release_payload)
    AS stored_statement_bytes,
  min(statement_sha256) FILTER (WHERE exact_release_payload)
    AS stored_statement_sha256,
  bool_and(version ~ '^[0-9]{14}$' AND version > '20260802043233')
    FILTER (WHERE exact_release_payload) AS execution_version_is_later
FROM classified;

SELECT
  count(*) AS exact_provenance_rows,
  count(*) FILTER (
    WHERE release_commit = '27bad0cd0e5053cfb436752bee0976c5e1278fd8'
      AND source_sha256 =
        'a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102'
      AND correction_sha256 =
        'e019c2a1d50fbc1eb539906ed3c9c1754bf06af1d814419da6e6bccf51a9e9ac'
      AND artifact_sha256 =
        '65836de375d970baa6354ab648c74124d22b39dd1f8b8b93a7ad5800e019cc62'
      AND project_ref = 'gyndziiuizpgwhqwyrvn'
      AND environment = 'Live/production'
      AND operator_identity = 'benjamin-millen'
      AND approval_record = 'owner-operated-voice-retention-lovable-v1'
      AND execution_mechanism = 'lovable_cloud_approval'
      AND transaction_outcome = 'committed'
  ) AS matching_provenance_rows
FROM tenant_security.release_provenance
WHERE release_id = 'voice-artifact-retention-lovable-v1';

SELECT
  (SELECT count(*) FROM cron.job
    WHERE command ~* 'purge_expired_voice_artifact_batch')
    AS purge_command_jobs,
  count(*) AS exact_job_rows,
  count(*) FILTER (
    WHERE active
      AND schedule = '7,17,27,37,47,57 * * * *'
      AND command =
        'SELECT private.purge_expired_voice_artifact_batch(500, NULL);'
  ) AS exact_active_job_rows,
  count(*) FILTER (
    WHERE active
      AND database = current_database()
      AND username = current_user
      AND schedule = '7,17,27,37,47,57 * * * *'
      AND command =
        'SELECT private.purge_expired_voice_artifact_batch(500, NULL);'
  ) AS exact_authoritative_job_rows,
  count(DISTINCT database) AS job_database_count,
  count(DISTINCT username) AS job_owner_count,
  min(database) AS job_database,
  min(username) AS job_username
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
