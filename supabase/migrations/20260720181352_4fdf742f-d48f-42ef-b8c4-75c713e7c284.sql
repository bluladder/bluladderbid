
CREATE TABLE IF NOT EXISTS public.callrail_inbound_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'inbound_sms',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_phone TEXT,
  to_phone TEXT,
  payload_safe JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processing','processed','retry_pending','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error_category TEXT,
  last_error_detail TEXT,
  last_attempted_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  sms_message_id UUID,
  conversation_id UUID,
  customer_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT callrail_inbound_events_provider_message_id_key UNIQUE (provider_message_id)
);

GRANT SELECT ON public.callrail_inbound_events TO authenticated;
GRANT ALL ON public.callrail_inbound_events TO service_role;

ALTER TABLE public.callrail_inbound_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view callrail inbound events"
  ON public.callrail_inbound_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS callrail_inbound_events_status_idx
  ON public.callrail_inbound_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS callrail_inbound_events_received_idx
  ON public.callrail_inbound_events(received_at DESC);
CREATE INDEX IF NOT EXISTS callrail_inbound_events_from_phone_idx
  ON public.callrail_inbound_events(from_phone);

CREATE TRIGGER update_callrail_inbound_events_updated_at
  BEFORE UPDATE ON public.callrail_inbound_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
