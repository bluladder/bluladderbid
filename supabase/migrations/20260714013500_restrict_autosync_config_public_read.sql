-- ============================================================================
-- Security fix: remove anonymous/public read access to internal Jobber sync
-- state. The `autosync_config` table exposes lock-holder IDs, scheduling state
-- and error details. It is only read in the frontend by the admin-only
-- AutosyncStatus panel (an authenticated admin) and by edge functions using the
-- service role (which bypasses RLS). The existing "Admins can manage" policy
-- (FOR ALL USING is_admin()) already covers admin SELECTs, so the public
-- read policy is redundant and is the exposure. Drop it.
-- ============================================================================
DROP POLICY IF EXISTS "Public can read autosync config" ON public.autosync_config;

-- Ensure an explicit admin SELECT policy exists (idempotent safety net in case
-- the FOR ALL policy is ever narrowed). Admins only; no anon, no authenticated.
DROP POLICY IF EXISTS "Admins can read autosync config" ON public.autosync_config;
CREATE POLICY "Admins can read autosync config"
  ON public.autosync_config
  FOR SELECT
  USING (public.is_admin());
