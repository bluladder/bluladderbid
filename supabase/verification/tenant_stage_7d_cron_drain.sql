-- Secret-safe drain probe. Poll every five seconds and require no rows
-- continuously for at least 65 seconds after the pause transaction commits.
BEGIN TRANSACTION READ ONLY;

SELECT jobid, runid, status, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (3, 5, 6)
  AND lower(status) IN ('starting', 'running')
  AND end_time IS NULL
ORDER BY jobid, runid;

ROLLBACK;
