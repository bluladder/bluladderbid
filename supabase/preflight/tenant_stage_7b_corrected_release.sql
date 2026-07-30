\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- Caller-supplied identity is evidence only after these assertions succeed.
SELECT 1 / CASE
  WHEN :'project_ref' = 'gyndziiuizpgwhqwyrvn' THEN 1 ELSE 0
END AS project_identity_ok;
SELECT 1 / CASE
  WHEN :'environment' = 'production' THEN 1 ELSE 0
END AS environment_identity_ok;

SELECT
  current_database() AS database_name,
  current_setting('server_version') AS postgres_version,
  current_setting('transaction_read_only') AS transaction_read_only;

SELECT
  count(*) AS ledger_count,
  max(version) AS ledger_tip,
  md5(string_agg(version || ':' || name, '|' ORDER BY version)) AS ledger_fingerprint
FROM supabase_migrations.schema_migrations;

SELECT 'customers' AS table_name, count(*) AS row_count FROM public.customers
UNION ALL
SELECT 'properties', count(*) FROM public.properties
UNION ALL
SELECT 'quotes', count(*) FROM public.quotes
UNION ALL
SELECT 'bookings', count(*) FROM public.bookings
ORDER BY table_name;

SELECT
  to_regclass('public.organizations') IS NULL AS organizations_absent,
  to_regclass('public.organization_memberships') IS NULL
    AS memberships_absent,
  to_regclass('public.organization_resolution_keys') IS NULL
    AS resolution_keys_absent,
  to_regclass('tenant_security.release_provenance') IS NULL
    AS provenance_absent;

SELECT
  count(*) FILTER (WHERE column_name = 'organization_id') AS first_wave_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('customers', 'properties', 'quotes', 'bookings');

SELECT role::text AS platform_role, count(*) AS role_count
FROM public.user_roles
GROUP BY role::text
ORDER BY role::text;

-- Never retain command text; MD5 is only a change detector.
SELECT
  jobid,
  schedule,
  active,
  md5(command) AS command_fingerprint
FROM cron.job
WHERE jobid IN (3, 5, 6)
ORDER BY jobid;

SELECT count(*) AS active_stage7b_cron_runs
FROM cron.job_run_details
WHERE jobid IN (3, 5, 6)
  AND status IN ('starting', 'running');

-- Fail closed when the observed baseline differs from the signed release.
SELECT 1 / CASE WHEN (
  SELECT count(*) = 145
    AND max(version) = '20260726194719'
    AND md5(string_agg(version || ':' || name, '|' ORDER BY version))
      = '73ed8522db78e51049a421e1f72b18c3'
  FROM supabase_migrations.schema_migrations
) THEN 1 ELSE 0 END AS ledger_baseline_asserted;

SELECT 1 / CASE WHEN
  (SELECT count(*) FROM public.customers) = 16
  AND (SELECT count(*) FROM public.properties) = 10
  AND (SELECT count(*) FROM public.quotes) = 2
  AND (SELECT count(*) FROM public.bookings) = 2
  THEN 1 ELSE 0 END AS first_wave_counts_asserted;

SELECT 1 / CASE WHEN
  to_regclass('public.organizations') IS NULL
  AND to_regclass('public.organization_memberships') IS NULL
  AND to_regclass('public.organization_resolution_keys') IS NULL
  AND to_regclass('tenant_security.release_provenance') IS NULL
  AND (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('customers', 'properties', 'quotes', 'bookings')
      AND column_name = 'organization_id'
  ) = 0
  THEN 1 ELSE 0 END AS stage7b_absence_asserted;

SELECT 1 / CASE WHEN
  (SELECT count(*) FROM public.user_roles) = 1
  THEN 1 ELSE 0 END AS platform_role_count_asserted;

SELECT 1 / CASE WHEN
  (SELECT count(*) FROM cron.job WHERE jobid IN (3, 5, 6)) = 3
  AND (
    SELECT bool_and(
      CASE jobid
        WHEN 3 THEN md5(command) = '1a1b5b332626f37867e3521d2052f56b'
        WHEN 5 THEN md5(command) = '88e143e3876903e839e7551f68dd179b'
        WHEN 6 THEN md5(command) = 'ad8c290523e2659a608e7fcb7d57bcb7'
        ELSE false
      END
    )
    FROM cron.job
    WHERE jobid IN (3, 5, 6)
  )
  AND (
    SELECT count(*)
    FROM cron.job_run_details
    WHERE jobid IN (3, 5, 6)
      AND status IN ('starting', 'running')
  ) = 0
  THEN 1 ELSE 0 END AS cron_baseline_asserted;

ROLLBACK;
