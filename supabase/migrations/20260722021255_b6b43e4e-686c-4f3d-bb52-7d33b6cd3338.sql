
-- Slice B: weather status
CREATE TABLE public.weather_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','monitoring','delayed','paused')),
  advisory_message text,
  internal_note text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_status_singleton_unique UNIQUE (singleton)
);

GRANT SELECT ON public.weather_status TO authenticated;
GRANT ALL ON public.weather_status TO service_role;

ALTER TABLE public.weather_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read weather status"
  ON public.weather_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins can insert weather status"
  ON public.weather_status FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "admins can update weather status"
  ON public.weather_status FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admins can delete weather status"
  ON public.weather_status FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE TRIGGER trg_weather_status_updated_at
  BEFORE UPDATE ON public.weather_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.weather_status (singleton, status) VALUES (true, 'normal')
  ON CONFLICT (singleton) DO NOTHING;

-- Slice C: post-service education content
CREATE TABLE public.service_education_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key text NOT NULL,
  display_name text NOT NULL,
  send_after_days integer NOT NULL DEFAULT 7 CHECK (send_after_days >= 0 AND send_after_days <= 365),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  subject text,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_education_content_key_channel_unique UNIQUE (service_key, channel)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_education_content TO authenticated;
GRANT ALL ON public.service_education_content TO service_role;

ALTER TABLE public.service_education_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage service education content"
  ON public.service_education_content FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TRIGGER trg_service_education_content_updated_at
  BEFORE UPDATE ON public.service_education_content
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.service_education_content (service_key, display_name, send_after_days, channel, subject, body, sort_order)
VALUES
  ('window_cleaning','Window Cleaning',7,'email','Keeping your windows spotless','A few quick tips from BluLadder to keep your glass looking great between visits — plus a reminder about our 10-day rain guarantee.',10),
  ('house_wash','House Wash',10,'email','Caring for your freshly washed exterior','Simple things you can do to protect your siding and trim after a soft wash.',20),
  ('gutter_cleaning','Gutter Cleaning',14,'email','Your gutters after cleaning','What to watch for during the next few storms, and when to schedule the next clean.',30),
  ('driveway_cleaning','Driveway Cleaning',14,'email','Keeping your driveway looking new','Sealer timing, stain prevention, and simple upkeep between deep cleanings.',40),
  ('pressure_washing','Pressure Washing',14,'email','After your pressure washing service','How to protect the results and when to book the next round.',50),
  ('roof_cleaning','Roof Cleaning',30,'email','Extending the life of your roof','What our soft wash accomplishes and how to preserve it between visits.',60)
ON CONFLICT (service_key, channel) DO NOTHING;

-- Slice C: maintenance / rebooking intervals
CREATE TABLE public.service_maintenance_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  interval_days integer NOT NULL CHECK (interval_days > 0 AND interval_days <= 3650),
  advisory text,
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_maintenance_intervals TO authenticated;
GRANT ALL ON public.service_maintenance_intervals TO service_role;

ALTER TABLE public.service_maintenance_intervals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage maintenance intervals"
  ON public.service_maintenance_intervals FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TRIGGER trg_service_maintenance_intervals_updated_at
  BEFORE UPDATE ON public.service_maintenance_intervals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.service_maintenance_intervals (service_key, display_name, interval_days, advisory, sort_order)
VALUES
  ('window_cleaning','Window Cleaning',120,'Quarterly windows keep glass at its best.',10),
  ('house_wash','House Wash',365,'Annual soft wash prevents mildew build-up.',20),
  ('gutter_cleaning','Gutter Cleaning',180,'Twice-a-year gutters are the standard rhythm.',30),
  ('driveway_cleaning','Driveway Cleaning',365,'Yearly driveway keeps oil and organics from settling in.',40),
  ('pressure_washing','Pressure Washing',365,'Annual flatwork refresh.',50),
  ('roof_cleaning','Roof Cleaning',730,'Roof soft wash every 2 years for most homes.',60)
ON CONFLICT (service_key) DO NOTHING;

-- Slice C: booking lifecycle columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS maintenance_last_notified_at timestamptz;
