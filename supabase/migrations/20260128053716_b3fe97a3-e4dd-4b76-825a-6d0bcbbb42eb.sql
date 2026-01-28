-- Add pending_confirmation to booking_status enum
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'pending_confirmation';

-- Create notification_events table for audit trail
CREATE TABLE public.notification_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- scheduled, rescheduled, cancelled, services_modified, price_changed, tech_reassigned
  triggered_by TEXT NOT NULL DEFAULT 'system', -- customer, admin, system
  triggered_by_id UUID,
  channel TEXT NOT NULL DEFAULT 'email', -- email, sms
  sent_at TIMESTAMP WITH TIME ZONE,
  suppressed BOOLEAN NOT NULL DEFAULT false,
  suppressed_reason TEXT,
  notification_content JSONB, -- subject, body preview, etc.
  customer_action TEXT, -- accepted, declined, pending, null
  customer_action_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create pending_confirmations table for customer confirmation flow
CREATE TABLE public.pending_confirmations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  change_type TEXT NOT NULL, -- reschedule, modify_services, cancel
  old_values JSONB NOT NULL,
  new_values JSONB NOT NULL,
  admin_note TEXT,
  show_price_change BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, declined, expired
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Enable RLS
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_confirmations ENABLE ROW LEVEL SECURITY;

-- RLS policies for notification_events (admin read, system write)
CREATE POLICY "Admins can view notification events"
  ON public.notification_events
  FOR SELECT
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE POLICY "Service role can manage notification events"
  ON public.notification_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS policies for pending_confirmations
CREATE POLICY "Admins can view pending confirmations"
  ON public.pending_confirmations
  FOR SELECT
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE POLICY "Service role can manage pending confirmations"
  ON public.pending_confirmations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anonymous access to pending confirmations by token (for customer confirmation page)
CREATE POLICY "Anyone can view pending confirmation by token"
  ON public.pending_confirmations
  FOR SELECT
  TO anon, authenticated
  USING (status = 'pending' AND expires_at > now());

-- Index for faster lookups
CREATE INDEX idx_notification_events_booking_id ON public.notification_events(booking_id);
CREATE INDEX idx_pending_confirmations_token ON public.pending_confirmations(token);
CREATE INDEX idx_pending_confirmations_booking_id ON public.pending_confirmations(booking_id);
CREATE INDEX idx_pending_confirmations_expires_at ON public.pending_confirmations(expires_at) WHERE status = 'pending';