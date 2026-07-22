
CREATE TABLE public.service_preparation_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.service_preparation_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.service_preparation_config TO authenticated;
GRANT ALL ON public.service_preparation_config TO service_role;

ALTER TABLE public.service_preparation_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active prep config"
  ON public.service_preparation_config FOR SELECT
  USING (is_active OR public.is_admin());

CREATE POLICY "Admins manage prep config"
  ON public.service_preparation_config FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER update_service_preparation_config_updated_at
  BEFORE UPDATE ON public.service_preparation_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS prep_email_sent_at TIMESTAMPTZ;

INSERT INTO public.service_preparation_config (service_key, display_name, sort_order, instructions) VALUES
  ('window_cleaning', 'Window Cleaning', 10, '[
    "Provide access to windows we will clean (unlock gates, clear window sills).",
    "Move fragile items and electronics away from interior windows if we are cleaning inside.",
    "Screens: if you booked the $99 exterior special, please remove screens before we arrive; standard service includes screen cleaning.",
    "Secure pets away from work areas."
  ]'::jsonb),
  ('house_wash', 'House Wash / Soft Wash', 20, '[
    "Close all windows and exterior doors before we arrive.",
    "Move sensitive outdoor items (patio cushions, grill covers, décor) away from the walls.",
    "Let us know about any known leaks, damaged seals, or open weep holes.",
    "Secure pets indoors during service."
  ]'::jsonb),
  ('pressure_washing', 'Pressure Washing', 30, '[
    "Clear movable items from the areas we will clean (planters, furniture, toys).",
    "Keep pets and children inside the work zone until service is complete.",
    "Point out any fragile surfaces or drainage concerns you would like us to avoid."
  ]'::jsonb),
  ('driveway_cleaning', 'Driveway / Flatwork Cleaning', 40, '[
    "Move vehicles off the driveway and any flatwork we will clean.",
    "Clear planters, doormats, and portable items from the surface.",
    "Let us know about any cracked or spalling concrete you want us to be gentle around."
  ]'::jsonb),
  ('gutter_cleaning', 'Gutter Cleaning', 50, '[
    "Confirm side-yard / roof access is unlocked.",
    "Move any patio items directly beneath downspouts (we may briefly detach them).",
    "Tell us about known gutter, fascia, or roof concerns."
  ]'::jsonb),
  ('roof_cleaning', 'Roof Cleaning', 60, '[
    "Close all windows and exterior doors.",
    "Move sensitive plants and outdoor items away from the roofline where practical.",
    "Secure pets indoors."
  ]'::jsonb)
ON CONFLICT (service_key) DO NOTHING;
