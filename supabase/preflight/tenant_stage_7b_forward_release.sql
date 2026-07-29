-- Stage 7B immutable release preflight. Read-only by construction.
-- Capture the complete output and stop unless it matches release.json.
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('server_version') AS server_version;

SELECT count(*)::int AS ledger_count,
       min(version) AS first_version,
       max(version) AS last_version,
       md5(string_agg(version || ':' || coalesce(name, ''), E'\n'
           ORDER BY version)) AS version_name_fingerprint,
       count(*) FILTER (WHERE version = '20260728060000')::int
         AS stage_7b_ledger_rows
FROM supabase_migrations.schema_migrations;

SELECT table_name, row_count, null_organization_ids
FROM (
  SELECT 'customers' AS table_name, count(*)::int AS row_count,
         count(*) FILTER (
           WHERE to_jsonb(c) ? 'organization_id'
             AND to_jsonb(c)->>'organization_id' IS NULL
         )::int AS null_organization_ids
  FROM public.customers c
  UNION ALL
  SELECT 'properties', count(*)::int,
         count(*) FILTER (
           WHERE to_jsonb(p) ? 'organization_id'
             AND to_jsonb(p)->>'organization_id' IS NULL
         )::int
  FROM public.properties p
  UNION ALL
  SELECT 'quotes', count(*)::int,
         count(*) FILTER (
           WHERE to_jsonb(q) ? 'organization_id'
             AND to_jsonb(q)->>'organization_id' IS NULL
         )::int
  FROM public.quotes q
  UNION ALL
  SELECT 'bookings', count(*)::int,
         count(*) FILTER (
           WHERE to_jsonb(b) ? 'organization_id'
             AND to_jsonb(b)->>'organization_id' IS NULL
         )::int
  FROM public.bookings b
) counts
ORDER BY table_name;

SELECT count(*)::int AS platform_role_rows,
       count(DISTINCT user_id)::int AS platform_role_users,
       array_agg(DISTINCT role::text ORDER BY role::text) AS role_values
FROM public.user_roles;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'organizations',
    'organization_memberships',
    'organization_resolution_keys'
  )
ORDER BY table_name;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('customers', 'properties', 'quotes', 'bookings')
  AND column_name = 'organization_id'
ORDER BY table_name;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('customers', 'properties', 'quotes', 'bookings')
ORDER BY c.relname;

-- If any Stage 7B table or organization_id column query above returns rows,
-- stop and use a separately reviewed partial-state preflight. Canonical ID/slug
-- collision checks are meaningful only after proving the table already exists;
-- this pre-Stage-7B script intentionally does not reference an absent relation.

ROLLBACK;
