
-- =========================================================
-- 1) Remove overly-permissive public/authenticated read policies
-- =========================================================

-- Business office address & drive-time config: admin-only (admins keep ALL access)
DROP POLICY IF EXISTS "Public can view drive time config" ON public.drive_time_config;

-- Scheduled-job client names/addresses: admin-only
DROP POLICY IF EXISTS "Public can read busy blocks for availability" ON public.jobber_busy_blocks;

-- Internal Jobber sync state: admin-only
DROP POLICY IF EXISTS "Public can read sync state" ON public.jobber_sync_state;
CREATE POLICY "Admins can view sync state"
  ON public.jobber_sync_state FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Schedule blocks: admin-only (admin manage + read-only admin SELECT policies remain)
DROP POLICY IF EXISTS "Public can view schedule blocks" ON public.schedule_blocks;

-- Internal sync run logs: admin-only (admin manage policy remains)
DROP POLICY IF EXISTS "Public can view sync runs" ON public.schedule_sync_runs;

-- =========================================================
-- 2) Lock down internal SECURITY DEFINER functions so they are not
--    executable by anon / authenticated callers. These are only invoked
--    by cron / edge functions (service role) or internally by triggers.
-- =========================================================

REVOKE EXECUTE ON FUNCTION public.acquire_autosync_lock(p_holder_id text, p_lock_ttl_minutes integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_autosync_lock(p_holder_id text, p_lock_ttl_minutes integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_autosync_lock(p_holder_id text, p_status text, p_error text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_autosync_lock(p_holder_id text, p_status text, p_error text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_autosync_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_autosync_coverage() TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_due_sms(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_sms(p_limit integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_lifecycle_status(p_customer_id uuid, p_status lead_lifecycle_status, p_source text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_lifecycle_status(p_customer_id uuid, p_status lead_lifecycle_status, p_source text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_recompute_lifecycle() FROM PUBLIC, anon, authenticated;

-- admin_set_lifecycle is called by signed-in admins from the app (it self-guards
-- with has_admin_level) and by the system. Allow authenticated + service role,
-- but not anonymous visitors.
REVOKE EXECUTE ON FUNCTION public.admin_set_lifecycle(p_customer_id uuid, p_status lead_lifecycle_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_lifecycle(p_customer_id uuid, p_status lead_lifecycle_status) TO authenticated, service_role;
