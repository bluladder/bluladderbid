-- ============================================================
-- PRICING CENTRALIZATION: versioning, snapshots, public read fix
-- ============================================================

-- 1) Allow public/customer read of pricing_config (non-sensitive: rates only,
--    no costs/margins). Fixes the live bug where anonymous customers fell back
--    to hard-coded DEFAULT_PRICING because RLS SELECT was admin-only.
GRANT SELECT ON public.pricing_config TO anon, authenticated;
CREATE POLICY "Public can read pricing config"
  ON public.pricing_config FOR SELECT
  TO anon, authenticated
  USING (true);

-- 2) Immutable published pricing snapshots (versioning)
CREATE TABLE public.pricing_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version integer NOT NULL,
  config_snapshot jsonb NOT NULL,
  note text,
  published_by uuid REFERENCES auth.users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version)
);

GRANT SELECT ON public.pricing_versions TO authenticated;
GRANT ALL ON public.pricing_versions TO service_role;

ALTER TABLE public.pricing_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pricing versions"
  ON public.pricing_versions FOR SELECT
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE POLICY "Operations admins can publish pricing versions"
  ON public.pricing_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

-- Seed version 1 from the CURRENT live config (authoritative production values)
INSERT INTO public.pricing_versions (version, config_snapshot, note)
SELECT 1,
       jsonb_object_agg(config_key, config_value),
       'Initial snapshot of live production pricing at centralization'
FROM public.pricing_config;

-- 3) Publish helper: snapshots current config as a new version (admin only)
CREATE OR REPLACE FUNCTION public.publish_pricing_version(p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
  v_snapshot jsonb;
BEGIN
  IF NOT public.has_admin_level(auth.uid(), 'operations_admin') THEN
    RAISE EXCEPTION 'Admin access required to publish pricing';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next FROM public.pricing_versions;
  SELECT jsonb_object_agg(config_key, config_value) INTO v_snapshot FROM public.pricing_config;

  INSERT INTO public.pricing_versions (version, config_snapshot, note, published_by)
  VALUES (v_next, v_snapshot, p_note, auth.uid());

  RETURN v_next;
END;
$$;

-- 4) Read current pricing rule version (used by the engine to stamp quotes)
CREATE OR REPLACE FUNCTION public.current_pricing_version()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(MAX(version), 1) FROM public.pricing_versions
$$;

-- 5) Quote/booking snapshot columns (Phase 6). Never retroactively recomputed.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS pricing_engine_version text,
  ADD COLUMN IF NOT EXISTS pricing_rule_version integer,
  ADD COLUMN IF NOT EXISTS input_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS line_item_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS discount_snapshot jsonb;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pricing_engine_version text,
  ADD COLUMN IF NOT EXISTS pricing_rule_version integer,
  ADD COLUMN IF NOT EXISTS input_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS line_item_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS discount_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS pricing_override_reason text,
  ADD COLUMN IF NOT EXISTS pricing_override_by uuid REFERENCES auth.users(id);