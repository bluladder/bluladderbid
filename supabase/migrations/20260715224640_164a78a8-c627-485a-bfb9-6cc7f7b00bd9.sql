
-- 1. Extend technicians with role/crew-leader fields
ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'junior_technician'
    CHECK (role IN ('crew_leader','junior_technician','inactive')),
  ADD COLUMN IF NOT EXISTS customer_bookable_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_company_vehicle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_crew_size integer
    CHECK (max_crew_size IS NULL OR (max_crew_size BETWEEN 1 AND 5)),
  ADD COLUMN IF NOT EXISTS eligible_leader_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS public_display_name text,
  ADD COLUMN IF NOT EXISTS role_effective_at timestamptz;

-- Seed the four active team members per approved plan
UPDATE public.technicians
  SET role = 'crew_leader', customer_bookable_lead = true,
      has_company_vehicle = true, max_crew_size = 3
  WHERE name = 'Benjamin Millen';

UPDATE public.technicians
  SET role = 'crew_leader', customer_bookable_lead = true,
      has_company_vehicle = true, max_crew_size = 2
  WHERE name = 'Bryan Hightower';

UPDATE public.technicians
  SET role = 'junior_technician', customer_bookable_lead = false,
      has_company_vehicle = false
  WHERE name IN ('Samuel Burden','Michael Self');

-- 2. crew_config (single-row global settings)
CREATE TABLE IF NOT EXISTS public.crew_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  hide_technician_names boolean NOT NULL DEFAULT true,
  default_public_crew_label text NOT NULL DEFAULT 'BluLadder Service Team',
  productivity_multipliers jsonb NOT NULL DEFAULT
    '{"1":1.0,"2":1.8,"3":2.5,"4":3.1,"5":3.6}'::jsonb,
  crew_size_min integer NOT NULL DEFAULT 1 CHECK (crew_size_min >= 1),
  crew_size_max integer NOT NULL DEFAULT 5 CHECK (crew_size_max BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_config TO authenticated;
GRANT ALL ON public.crew_config TO service_role;
ALTER TABLE public.crew_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read crew_config" ON public.crew_config
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'operations_admin'::app_role)
  );
CREATE POLICY "Admins can write crew_config" ON public.crew_config
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role)
  ) WITH CHECK (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role)
  );

INSERT INTO public.crew_config (singleton) VALUES (true)
  ON CONFLICT (singleton) DO NOTHING;

-- 3. service_staffing_requirements (empty by default)
CREATE TABLE IF NOT EXISTS public.service_staffing_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key text NOT NULL UNIQUE,
  min_technicians integer NOT NULL DEFAULT 1 CHECK (min_technicians BETWEEN 1 AND 5),
  preferred_technicians integer CHECK (preferred_technicians IS NULL OR preferred_technicians BETWEEN 1 AND 5),
  max_technicians integer CHECK (max_technicians IS NULL OR max_technicians BETWEEN 1 AND 5),
  lead_vehicle_required boolean NOT NULL DEFAULT false,
  solo_allowed boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_staffing_requirements TO authenticated;
GRANT ALL ON public.service_staffing_requirements TO service_role;
ALTER TABLE public.service_staffing_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read staffing reqs" ON public.service_staffing_requirements
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'operations_admin'::app_role)
  );
CREATE POLICY "Admins write staffing reqs" ON public.service_staffing_requirements
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role)
  ) WITH CHECK (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role)
  );

-- 4. booking_crew_assignments
CREATE TABLE IF NOT EXISTS public.booking_crew_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  leader_technician_id uuid NOT NULL REFERENCES public.technicians(id),
  supporting_technician_ids uuid[] NOT NULL DEFAULT '{}',
  staffing_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_crew_label text,
  calculated_duration_minutes integer,
  requires_admin_review boolean NOT NULL DEFAULT false,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);
CREATE INDEX IF NOT EXISTS idx_bca_leader ON public.booking_crew_assignments(leader_technician_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_crew_assignments TO authenticated;
GRANT ALL ON public.booking_crew_assignments TO service_role;
ALTER TABLE public.booking_crew_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read crew assignments" ON public.booking_crew_assignments
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'operations_admin'::app_role)
  );
CREATE POLICY "Admins write crew assignments" ON public.booking_crew_assignments
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role)
  ) WITH CHECK (
    public.has_role(auth.uid(), 'owner_admin'::app_role) OR
    public.has_role(auth.uid(), 'admin'::app_role)
  );

-- updated_at triggers
CREATE TRIGGER update_crew_config_updated_at BEFORE UPDATE ON public.crew_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_service_staffing_reqs_updated_at BEFORE UPDATE ON public.service_staffing_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_booking_crew_assignments_updated_at BEFORE UPDATE ON public.booking_crew_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
