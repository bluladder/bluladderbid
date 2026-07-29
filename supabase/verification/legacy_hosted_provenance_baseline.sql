-- Read-only audited provenance baseline for three hosted-only legacy tables.
-- This script never creates or alters an object and never reads business rows.
BEGIN TRANSACTION READ ONLY;

WITH columns AS (
  SELECT table_name, ordinal_position, column_name, data_type, udt_name,
         is_nullable, coalesce(column_default, '') AS column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'big_job_settings',
      'eligibility_rules',
      'schedule_blocks'
    )
), definitions AS (
  SELECT table_name,
         string_agg(
           ordinal_position || ':' || column_name || ':' || data_type || ':' ||
           udt_name || ':' || is_nullable || ':' || column_default,
           E'\n' ORDER BY ordinal_position
         ) AS definition
  FROM columns
  GROUP BY table_name
)
SELECT c.table_name,
       count(*)::int AS column_count,
       md5(d.definition) AS columns_fingerprint,
       string_agg(
         c.column_name || ':' || c.data_type || ':' || c.is_nullable,
         ', ' ORDER BY c.ordinal_position
       ) AS safe_shape
FROM columns c
JOIN definitions d USING (table_name)
GROUP BY c.table_name, d.definition
ORDER BY c.table_name;

WITH targets AS (
  SELECT unnest(ARRAY[
    'big_job_settings',
    'eligibility_rules',
    'schedule_blocks'
  ]) AS table_name
), indexes AS (
  SELECT tablename AS table_name, count(*)::int AS index_count,
         md5(string_agg(indexname || ':' || indexdef, E'\n'
             ORDER BY indexname)) AS index_fingerprint
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN (SELECT table_name FROM targets)
  GROUP BY tablename
), policies AS (
  SELECT tablename AS table_name, count(*)::int AS policy_count,
         md5(string_agg(
           policyname || ':' || permissive || ':' || roles::text || ':' ||
           cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
           E'\n' ORDER BY policyname
         )) AS policy_fingerprint
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (SELECT table_name FROM targets)
  GROUP BY tablename
), triggers AS (
  SELECT event_object_table AS table_name, count(*)::int AS trigger_count,
         md5(string_agg(
           trigger_name || ':' || action_timing || ':' ||
           event_manipulation || ':' || action_statement,
           E'\n' ORDER BY trigger_name, event_manipulation
         )) AS trigger_fingerprint
  FROM information_schema.triggers
  WHERE event_object_schema = 'public'
    AND event_object_table IN (SELECT table_name FROM targets)
  GROUP BY event_object_table
), constraints AS (
  SELECT c.relname AS table_name, count(*)::int AS constraint_count,
         md5(string_agg(
           x.conname || ':' || pg_get_constraintdef(x.oid),
           E'\n' ORDER BY x.conname
         )) AS constraint_fingerprint
  FROM pg_constraint x
  JOIN pg_class c ON c.oid = x.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (SELECT table_name FROM targets)
  GROUP BY c.relname
)
SELECT t.table_name,
       coalesce(i.index_count, 0) AS index_count, i.index_fingerprint,
       coalesce(p.policy_count, 0) AS policy_count, p.policy_fingerprint,
       coalesce(g.trigger_count, 0) AS trigger_count, g.trigger_fingerprint,
       coalesce(c.constraint_count, 0) AS constraint_count,
       c.constraint_fingerprint
FROM targets t
LEFT JOIN indexes i USING (table_name)
LEFT JOIN policies p USING (table_name)
LEFT JOIN triggers g USING (table_name)
LEFT JOIN constraints c USING (table_name)
ORDER BY t.table_name;

SELECT version, name, cardinality(statements)::int AS statement_count,
       md5(array_to_string(statements, E'\n')) AS statements_fingerprint,
       position(
         'big_job_settings' IN lower(array_to_string(statements, E'\n'))
       ) > 0 AS mentions_big_job_settings,
       position(
         'eligibility_rules' IN lower(array_to_string(statements, E'\n'))
       ) > 0 AS mentions_eligibility_rules,
       position(
         'schedule_blocks' IN lower(array_to_string(statements, E'\n'))
       ) > 0 AS mentions_schedule_blocks
FROM supabase_migrations.schema_migrations
WHERE version = '20260128005316';

ROLLBACK;
