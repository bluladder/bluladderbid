-- Stage 7C hosted preflight: core catalog queries.
-- READ ONLY. Run with ON_ERROR_STOP and a transaction declared READ ONLY.

SELECT version, name, statements
FROM supabase_migrations.schema_migrations
ORDER BY version;

SELECT
  c.oid::regclass AS relation,
  c.relkind,
  c.relrowsecurity,
  c.relforcerowsecurity,
  obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'big_job_settings', 'eligibility_rules', 'schedule_blocks',
    'customers', 'properties', 'quotes', 'bookings',
    'organizations', 'organization_memberships',
    'organization_resolution_keys'
  )
ORDER BY c.relname;

SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'big_job_settings', 'eligibility_rules', 'schedule_blocks',
    'customers', 'properties', 'quotes', 'bookings'
  )
ORDER BY table_name, ordinal_position;

SELECT
  'customers' AS table_name, count(*) AS row_count FROM public.customers
UNION ALL
SELECT 'properties', count(*) FROM public.properties
UNION ALL
SELECT 'quotes', count(*) FROM public.quotes
UNION ALL
SELECT 'bookings', count(*) FROM public.bookings
ORDER BY table_name;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  pg_get_userbyid(p.proowner) AS owner,
  p.proconfig AS settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, arguments;

SELECT
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
ORDER BY event_object_table, trigger_name, event_manipulation;

SELECT
  conrelid::regclass AS table_name,
  conname,
  contype,
  convalidated,
  pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN (
    'customers', 'properties', 'quotes', 'bookings',
    'big_job_settings', 'eligibility_rules', 'schedule_blocks'
  )
ORDER BY table_name, conname;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'customers', 'properties', 'quotes', 'bookings',
    'big_job_settings', 'eligibility_rules', 'schedule_blocks'
  )
ORDER BY tablename, indexname;

SELECT
  ur.role::text AS platform_role,
  count(*) AS user_count
FROM public.user_roles ur
GROUP BY ur.role::text
ORDER BY platform_role;

SELECT
  to_regclass('cron.job') AS cron_job_catalog,
  to_regclass('storage.buckets') AS storage_bucket_catalog,
  to_regclass('storage.objects') AS storage_object_catalog;
