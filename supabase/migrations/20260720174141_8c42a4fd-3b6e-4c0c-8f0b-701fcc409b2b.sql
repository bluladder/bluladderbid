CREATE TABLE public.campaign_launch_controls (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enrollment_paused BOOLEAN NOT NULL DEFAULT false,
  delivery_paused BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_launch_controls_singleton CHECK (id = 1)
);

INSERT INTO public.campaign_launch_controls (id) VALUES (1);

GRANT SELECT ON public.campaign_launch_controls TO authenticated;
GRANT ALL ON public.campaign_launch_controls TO service_role;

ALTER TABLE public.campaign_launch_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read launch controls"
  ON public.campaign_launch_controls FOR SELECT
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE POLICY "Admins can update launch controls"
  ON public.campaign_launch_controls FOR UPDATE
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));