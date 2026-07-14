CREATE TABLE public.booking_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  created_by uuid,
  phase text NOT NULL DEFAULT 'prepare',
  status text NOT NULL DEFAULT 'running',
  conversation_id uuid,
  slot_id text,
  slot_start timestamptz,
  idempotency_key text,
  auth_key text,
  booking_id uuid,
  jobber_job_id text,
  jobber_visit_id text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkpoint text,
  last_error text,
  last_error_step text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_test_runs_created_by ON public.booking_test_runs(created_by);
CREATE INDEX idx_booking_test_runs_created_at ON public.booking_test_runs(created_at DESC);
CREATE UNIQUE INDEX idx_booking_test_runs_correlation ON public.booking_test_runs(correlation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_test_runs TO authenticated;
GRANT ALL ON public.booking_test_runs TO service_role;

ALTER TABLE public.booking_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operations admins manage booking test runs"
ON public.booking_test_runs FOR ALL
TO authenticated
USING (public.has_admin_level(auth.uid(), 'operations_admin'))
WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE TRIGGER update_booking_test_runs_updated_at
BEFORE UPDATE ON public.booking_test_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();