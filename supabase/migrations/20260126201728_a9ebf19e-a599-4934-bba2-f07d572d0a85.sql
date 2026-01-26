-- Create booking step events table for funnel analytics
CREATE TABLE public.booking_step_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  step text NOT NULL CHECK (step IN ('calendar', 'time', 'info', 'confirm')),
  services_json jsonb,
  selected_slot_json jsonb,
  used_suggested_day boolean DEFAULT false,
  used_recommended_slot boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast analytics queries
CREATE INDEX idx_booking_step_events_created ON public.booking_step_events (created_at);
CREATE INDEX idx_booking_step_events_session ON public.booking_step_events (session_id);
CREATE INDEX idx_booking_step_events_step ON public.booking_step_events (step);

-- Enable RLS
ALTER TABLE public.booking_step_events ENABLE ROW LEVEL SECURITY;

-- Allow public inserts (anonymous tracking)
CREATE POLICY "Anyone can create step events"
  ON public.booking_step_events FOR INSERT
  WITH CHECK (session_id IS NOT NULL AND step IS NOT NULL);

-- Admins can read all events
CREATE POLICY "Admins can view step events"
  ON public.booking_step_events FOR SELECT
  USING (is_admin());