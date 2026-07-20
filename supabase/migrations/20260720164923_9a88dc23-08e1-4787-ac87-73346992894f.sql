
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('bounced','complained','unsubscribed','invalid','manual')),
  source text NOT NULL DEFAULT 'resend',
  provider_event_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_email_lower_key
  ON public.email_suppressions (lower(email));
CREATE INDEX IF NOT EXISTS email_suppressions_reason_idx
  ON public.email_suppressions (reason, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_suppressions TO authenticated;
GRANT ALL ON public.email_suppressions TO service_role;

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read email suppressions"
  ON public.email_suppressions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can write email suppressions"
  ON public.email_suppressions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.email_suppressions_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_email_suppressions_updated_at ON public.email_suppressions;
CREATE TRIGGER trg_email_suppressions_updated_at
BEFORE UPDATE ON public.email_suppressions
FOR EACH ROW EXECUTE FUNCTION public.email_suppressions_touch_updated_at();
