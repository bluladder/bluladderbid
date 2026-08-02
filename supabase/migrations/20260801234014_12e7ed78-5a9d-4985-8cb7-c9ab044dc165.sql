-- 1. business_knowledge: remove anonymous/public read access (internal_policy,
-- sales_guidance, owner_notes were exposed). Admins only; server-side functions
-- use the service role / SECURITY DEFINER search RPC.
DROP POLICY IF EXISTS "Anyone can read active business knowledge" ON public.business_knowledge;

CREATE POLICY "Admins can read business knowledge"
ON public.business_knowledge
FOR SELECT
TO authenticated
USING (public.is_admin());

REVOKE SELECT ON public.business_knowledge FROM anon;

-- 2. pricing_config: only customer-facing sections are publicly readable.
ALTER TABLE public.pricing_config
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

UPDATE public.pricing_config
SET is_public = true
WHERE config_key IN (
  'window_cleaning',
  'window_addons',
  'house_wash',
  'gutter_cleaning',
  'roof_cleaning',
  'driveway_cleaning',
  'pressure_washing',
  'solar_panel_cleaning',
  'screen_repair',
  'bundle_config',
  'window_promo_99'
);

UPDATE public.pricing_config
SET is_public = false
WHERE config_key IN ('bundle_rules', 'booking_settings', 'business_hours', 'schedule_compaction');

DROP POLICY IF EXISTS "Public can read pricing config" ON public.pricing_config;

CREATE POLICY "Public can read public pricing config"
ON public.pricing_config
FOR SELECT
TO anon, authenticated
USING (is_public = true);