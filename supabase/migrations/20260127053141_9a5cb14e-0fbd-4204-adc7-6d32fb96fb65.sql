-- Create table to track schedule sync runs with resume capability
CREATE TABLE public.schedule_sync_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'partial', 'failed')),
    from_date date NOT NULL,
    to_date date NOT NULL,
    chunk_days integer NOT NULL DEFAULT 7,
    current_cursor_date date,
    chunks_completed integer NOT NULL DEFAULT 0,
    total_chunks integer NOT NULL DEFAULT 0,
    visits_synced integer NOT NULL DEFAULT 0,
    blocks_inserted integer NOT NULL DEFAULT 0,
    last_error text,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone
);

-- Enable RLS
ALTER TABLE public.schedule_sync_runs ENABLE ROW LEVEL SECURITY;

-- Admins can manage sync runs
CREATE POLICY "Admins can manage sync runs"
ON public.schedule_sync_runs
FOR ALL
USING (is_admin());

-- Public can view sync run status (for UI display)
CREATE POLICY "Public can view sync runs"
ON public.schedule_sync_runs
FOR SELECT
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_schedule_sync_runs_updated_at
BEFORE UPDATE ON public.schedule_sync_runs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for finding active/recent runs
CREATE INDEX idx_schedule_sync_runs_status ON public.schedule_sync_runs(status, started_at DESC);