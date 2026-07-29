-- PROTECTED ACTION. Not authorized by repository merge.
-- Restore jobs 3, 5, and 6 after Stage 7B verification.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $stage7d$
DECLARE
  matched integer;
BEGIN
  IF to_regprocedure(
       'cron.alter_job(bigint,text,text,text,text,boolean)'
     ) IS NULL
     OR NOT has_function_privilege(
       current_user,
       'cron.alter_job(bigint,text,text,text,text,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'approved cron.alter_job interface unavailable';
  END IF;

  PERFORM j.jobid
  FROM cron.job j
  WHERE j.jobid IN (3, 5, 6)
  ORDER BY j.jobid
  FOR UPDATE;

  SELECT count(*) INTO matched
  FROM (VALUES
    (3::bigint, '* * * * *', '1a1b5b332626f37867e3521d2052f56b'),
    (5::bigint, '*/5 * * * *', '88e143e3876903e839e7551f68dd179b'),
    (6::bigint, '30 8 * * *', 'ad8c290523e2659a608e7fcb7d57bcb7')
  ) expected(jobid, schedule, fingerprint)
  JOIN cron.job j USING (jobid)
  WHERE j.schedule = expected.schedule
    AND j.active IS FALSE
    AND md5(j.command) = expected.fingerprint;

  IF matched <> 3 THEN
    RAISE EXCEPTION 'cron restore precondition failed';
  END IF;

  PERFORM cron.alter_job(3, active := true);
  PERFORM cron.alter_job(5, active := true);
  PERFORM cron.alter_job(6, active := true);

  SELECT count(*) INTO matched
  FROM (VALUES
    (3::bigint, '* * * * *', '1a1b5b332626f37867e3521d2052f56b'),
    (5::bigint, '*/5 * * * *', '88e143e3876903e839e7551f68dd179b'),
    (6::bigint, '30 8 * * *', 'ad8c290523e2659a608e7fcb7d57bcb7')
  ) expected(jobid, schedule, fingerprint)
  JOIN cron.job j USING (jobid)
  WHERE j.schedule = expected.schedule
    AND j.active IS TRUE
    AND md5(j.command) = expected.fingerprint;

  IF matched <> 3 THEN
    RAISE EXCEPTION 'cron restore postcondition failed';
  END IF;
END $stage7d$;

SELECT jobid, schedule, active, md5(command) AS command_fingerprint
FROM cron.job
WHERE jobid IN (3, 5, 6)
ORDER BY jobid;

COMMIT;
