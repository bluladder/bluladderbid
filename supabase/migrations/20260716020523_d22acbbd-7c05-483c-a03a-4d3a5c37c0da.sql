-- Stage A: lock big_job_settings to admins/service-role only.
-- Previously "Public can view big job settings" USING (true) exposed pricing
-- thresholds and crew multipliers to anyone. Only admins and service-role
-- server code need to read this table.
DROP POLICY IF EXISTS "Public can view big job settings" ON public.big_job_settings;

REVOKE SELECT ON public.big_job_settings FROM anon;
REVOKE SELECT ON public.big_job_settings FROM authenticated;
-- Admin RLS policy already grants access via public.is_admin(); no separate GRANT needed
-- for the authenticated role beyond the ALL grant that RLS enforces.
GRANT SELECT ON public.big_job_settings TO authenticated;
GRANT ALL ON public.big_job_settings TO service_role;

-- Ensure RLS is on (it already is, but reassert for safety).
ALTER TABLE public.big_job_settings ENABLE ROW LEVEL SECURITY;
