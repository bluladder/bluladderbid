-- Stage 7C hosted preflight: Supabase optional schemas.
-- READ ONLY. Run only after core preflight confirms these relations exist.

SELECT
  jobid,
  schedule,
  command,
  nodename,
  database,
  username,
  active
FROM cron.job
ORDER BY jobid;

SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at,
  updated_at
FROM storage.buckets
ORDER BY id;

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
WHERE schemaname = 'storage'
ORDER BY tablename, policyname;
