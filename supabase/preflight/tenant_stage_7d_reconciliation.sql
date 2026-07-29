-- Stage 7D focused hosted reconciliation.
-- SELECT-only. The explicit read-only transaction is mandatory.

BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS database_user,
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('server_version') AS server_version,
  pg_is_in_recovery() AS is_replica;

SELECT
  version,
  COALESCE(name, '') AS name,
  md5(array_to_string(statements, E'\n')) AS statements_md5,
  cardinality(statements) AS statement_count,
  length(array_to_string(statements, E'\n')) AS sql_length
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- Durable evidence for the two 2026-07-27 repository migrations.
WITH expected_columns(table_name, column_name) AS (
  VALUES
    ('attribution_events', 'self_reported_source'),
    ('attribution_events', 'self_reported_source_detail'),
    ('attribution_events', 'normalized_source_key'),
    ('attribution_events', 'attribution_source'),
    ('attribution_events', 'attribution_medium'),
    ('attribution_events', 'attribution_campaign'),
    ('attribution_events', 'attribution_content'),
    ('attribution_events', 'first_touch_referrer'),
    ('attribution_events', 'last_touch_referrer'),
    ('attribution_events', 'callrail_tracking_number'),
    ('attribution_events', 'callrail_campaign'),
    ('attribution_events', 'source_required_resolved_at')
)
SELECT
  expected_columns.table_name,
  expected_columns.column_name,
  columns.column_name IS NOT NULL AS present
FROM expected_columns
LEFT JOIN information_schema.columns AS columns
  ON columns.table_schema = 'public'
 AND columns.table_name = expected_columns.table_name
 AND columns.column_name = expected_columns.column_name
ORDER BY expected_columns.table_name, expected_columns.column_name;

SELECT
  p.oid::regprocedure::text AS signature,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.proconfig AS configuration,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AS authenticated_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'audit_business_knowledge',
    'persist_booking_lead_attribution',
    'search_published_business_knowledge'
  )
ORDER BY p.proname;

-- Credential-safe cron classification. Never select the complete command.
SELECT
  jobid,
  schedule,
  active,
  CASE
    WHEN command ~* 'net\.http_post|http_post' THEN 'HTTP POST'
    WHEN command ~* 'net\.http_get|http_get' THEN 'HTTP GET'
    ELSE 'database SQL'
  END AS destination_class,
  COALESCE(
    (regexp_match(command, '/functions/v1/([a-zA-Z0-9_-]+)'))[1],
    'not-an-edge-function'
  ) AS destination_identity,
  CASE
    WHEN command ~* 'cron.*secret|x-cron' THEN 'Cron shared-secret header'
    WHEN command ~* 'authorization' AND command ~* 'bearer'
      THEN 'Bearer authorization header'
    WHEN command ~* 'apikey|api-key|x-api-key' THEN 'API key header'
    ELSE 'none/undetermined'
  END AS authentication_mechanism,
  command ~* '(service_role|service-role|bearer|apikey|api-key|authorization|secret|token)'
    AS contains_credential_marker,
  command ~ E'''[^'']{80,}''' AS contains_long_quoted_literal,
  command ~* 'gyndziiuizpgwhqwyrvn|bluladder|dfw|dallas|fort worth'
    AS contains_project_or_dfw_marker,
  command ~* 'organization|tenant' AS contains_tenant_marker,
  md5(command) AS command_fingerprint
FROM cron.job
ORDER BY jobid;

SELECT
  table_name,
  index_name,
  index_definition,
  is_unique_constraint
FROM (
  SELECT
    table_relation.relname AS table_name,
    index_relation.relname AS index_name,
    pg_get_indexdef(index_metadata.indexrelid) AS index_definition,
    EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_metadata
      WHERE constraint_metadata.conindid = index_metadata.indexrelid
        AND constraint_metadata.contype = 'u'
    ) AS is_unique_constraint
  FROM pg_index AS index_metadata
  JOIN pg_class AS table_relation
    ON table_relation.oid = index_metadata.indrelid
  JOIN pg_namespace AS namespace_metadata
    ON namespace_metadata.oid = table_relation.relnamespace
  JOIN pg_class AS index_relation
    ON index_relation.oid = index_metadata.indexrelid
  WHERE namespace_metadata.nspname = 'public'
    AND index_metadata.indisunique
    AND NOT index_metadata.indisprimary
) AS unique_indexes
ORDER BY table_name, index_name;

ROLLBACK;
