
-- Status enum for SMS messages
DO $$ BEGIN
  CREATE TYPE public.sms_status AS ENUM ('pending', 'sent', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Trigger event enum for campaigns
DO $$ BEGIN
  CREATE TYPE public.sms_trigger_event AS ENUM ('quote_created', 'appointment_scheduled', 'appointment_rescheduled', 'appointment_cancelled', 'appointment_completed', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Campaigns
CREATE TABLE public.sms_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  trigger_event public.sms_trigger_event NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_campaigns TO authenticated;
GRANT ALL ON public.sms_campaigns TO service_role;
ALTER TABLE public.sms_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view campaigns" ON public.sms_campaigns
  FOR SELECT TO authenticated USING (public.has_admin_level(auth.uid(), 'read_only_admin'));
CREATE POLICY "Admins can manage campaigns" ON public.sms_campaigns
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

-- Campaign steps
CREATE TABLE public.sms_campaign_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sms_campaigns(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 0,
  delay_hours numeric NOT NULL DEFAULT 0,
  body_template text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_campaign_steps TO authenticated;
GRANT ALL ON public.sms_campaign_steps TO service_role;
ALTER TABLE public.sms_campaign_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view campaign steps" ON public.sms_campaign_steps
  FOR SELECT TO authenticated USING (public.has_admin_level(auth.uid(), 'read_only_admin'));
CREATE POLICY "Admins can manage campaign steps" ON public.sms_campaign_steps
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

-- Messages (log + queue)
CREATE TABLE public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_number text NOT NULL,
  body text NOT NULL,
  status public.sms_status NOT NULL DEFAULT 'pending',
  message_kind text NOT NULL DEFAULT 'transactional',
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.sms_campaigns(id) ON DELETE SET NULL,
  campaign_step_id uuid REFERENCES public.sms_campaign_steps(id) ON DELETE SET NULL,
  send_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  callrail_message_id text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sms messages" ON public.sms_messages
  FOR SELECT TO authenticated USING (public.has_admin_level(auth.uid(), 'read_only_admin'));
CREATE POLICY "Admins can manage sms messages" ON public.sms_messages
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE INDEX idx_sms_messages_queue ON public.sms_messages (status, send_at) WHERE status = 'pending';
CREATE INDEX idx_sms_messages_booking ON public.sms_messages (booking_id);
CREATE INDEX idx_sms_messages_quote ON public.sms_messages (quote_id);
CREATE INDEX idx_sms_campaign_steps_campaign ON public.sms_campaign_steps (campaign_id, step_order);

-- updated_at triggers
CREATE TRIGGER update_sms_campaigns_updated_at BEFORE UPDATE ON public.sms_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sms_campaign_steps_updated_at BEFORE UPDATE ON public.sms_campaign_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sms_messages_updated_at BEFORE UPDATE ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
