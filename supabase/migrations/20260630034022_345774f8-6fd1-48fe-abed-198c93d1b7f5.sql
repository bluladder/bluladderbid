CREATE TABLE public.schedule_reconciliation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  mode text NOT NULL DEFAULT 'report',
  trigger text NOT NULL DEFAULT 'manual',
  horizon_days integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'completed',
  jobber_visits integer NOT NULL DEFAULT 0,
  mirror_blocks integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0,
  orphan_count integer NOT NULL DEFAULT 0,
  mismatch_count integer NOT NULL DEFAULT 0,
  blocks_added integer NOT NULL DEFAULT 0,
  blocks_corrected integer NOT NULL DEFAULT 0,
  blocks_pruned integer NOT NULL DEFAULT 0,
  error text,
  report jsonb,
  created_by uuid
);

GRANT SELECT ON public.schedule_reconciliation_runs TO authenticated;
GRANT ALL ON public.schedule_reconciliation_runs TO service_role;

ALTER TABLE public.schedule_reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view reconciliation runs"
ON public.schedule_reconciliation_runs
FOR SELECT
TO authenticated
USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE INDEX idx_reconciliation_runs_started_at
ON public.schedule_reconciliation_runs (started_at DESC);