-- Read-only precheck for the separately authorized Stage 7D cron window.
BEGIN TRANSACTION READ ONLY;

SELECT extversion,
       extversion = '1.6.4' AS expected_version,
       to_regprocedure(
         'cron.alter_job(bigint,text,text,text,text,boolean)'
       ) IS NOT NULL AS alter_job_available,
       has_function_privilege(
         current_user,
         'cron.alter_job(bigint,text,text,text,text,boolean)',
         'EXECUTE'
       ) AS operator_can_execute
FROM pg_extension
WHERE extname = 'pg_cron';

SELECT jobid, schedule, active, md5(command) AS command_fingerprint
FROM cron.job
WHERE jobid IN (3, 5, 6)
ORDER BY jobid;

SELECT jobid, runid, status, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (3, 5, 6)
  AND lower(status) IN ('starting', 'running')
  AND end_time IS NULL
ORDER BY jobid, runid;

ROLLBACK;
