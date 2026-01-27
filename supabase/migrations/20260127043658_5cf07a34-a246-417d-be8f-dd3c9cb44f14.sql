-- ============================================
-- JOBBER SCHEDULE MIRROR TABLES
-- ============================================

-- Table: jobber_busy_blocks - mirrors scheduled visits from Jobber
CREATE TABLE public.jobber_busy_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  jobber_visit_id text UNIQUE,
  jobber_job_id text,
  status text DEFAULT 'scheduled',
  source text NOT NULL DEFAULT 'jobber',
  client_name text,
  client_address text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient availability queries
CREATE INDEX idx_busy_blocks_crew_start ON public.jobber_busy_blocks (crew_id, start_at);
CREATE INDEX idx_busy_blocks_time_range ON public.jobber_busy_blocks (start_at, end_at);
CREATE INDEX idx_busy_blocks_status ON public.jobber_busy_blocks (status) WHERE status = 'scheduled';

-- Enable RLS
ALTER TABLE public.jobber_busy_blocks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Public can read busy blocks for availability"
  ON public.jobber_busy_blocks FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage busy blocks"
  ON public.jobber_busy_blocks FOR ALL
  USING (is_admin());

-- ============================================
-- Table: jobber_webhook_events - for deduplication and debugging
CREATE TABLE public.jobber_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text UNIQUE NOT NULL,
  topic text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  payload jsonb NOT NULL,
  processing_error text
);

-- Index for recent events lookup
CREATE INDEX idx_webhook_events_received ON public.jobber_webhook_events (received_at DESC);
CREATE INDEX idx_webhook_events_topic ON public.jobber_webhook_events (topic);

-- Enable RLS
ALTER TABLE public.jobber_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies (admin only)
CREATE POLICY "Admins can manage webhook events"
  ON public.jobber_webhook_events FOR ALL
  USING (is_admin());

-- ============================================
-- Table: jobber_sync_state - tracks backfill status
CREATE TABLE public.jobber_sync_state (
  id text PRIMARY KEY DEFAULT 'default',
  last_backfill_at timestamptz,
  backfill_horizon_days int NOT NULL DEFAULT 60,
  backfill_in_progress boolean NOT NULL DEFAULT false,
  backfill_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default row
INSERT INTO public.jobber_sync_state (id) VALUES ('default');

-- Enable RLS
ALTER TABLE public.jobber_sync_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Public can read sync state"
  ON public.jobber_sync_state FOR SELECT
  USING (true);

CREATE POLICY "Admins can update sync state"
  ON public.jobber_sync_state FOR UPDATE
  USING (is_admin());

-- ============================================
-- Trigger to update updated_at
CREATE TRIGGER update_busy_blocks_updated_at
  BEFORE UPDATE ON public.jobber_busy_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sync_state_updated_at
  BEFORE UPDATE ON public.jobber_sync_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();