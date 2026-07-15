
-- Add per-unit pricing config rows for the two new first-class services.
-- Solar Panel Cleaning: $10 per panel. Screen Repair: $35 per screen.
INSERT INTO public.pricing_config (config_key, config_value)
VALUES
  ('solar_panel_cleaning', '{"perPanel": 10, "minimumPrice": 0}'::jsonb),
  ('screen_repair',        '{"perScreen": 35, "minimumPrice": 0}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;
