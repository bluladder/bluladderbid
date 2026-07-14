DROP POLICY IF EXISTS "Public can read autosync config" ON public.autosync_config;
DROP POLICY IF EXISTS "Admins can read autosync config" ON public.autosync_config;
CREATE POLICY "Admins can read autosync config"
  ON public.autosync_config
  FOR SELECT
  USING (public.is_admin());