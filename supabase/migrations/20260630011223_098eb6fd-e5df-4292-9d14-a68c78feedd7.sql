-- Allow logging inbound replies in the message log
ALTER TYPE sms_status ADD VALUE IF NOT EXISTS 'inbound';

CREATE TABLE public.sms_opt_outs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  opted_out boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'customer_reply',
  reason text,
  last_inbound_body text,
  opted_out_at timestamptz,
  opted_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_opt_outs TO authenticated;
GRANT ALL ON public.sms_opt_outs TO service_role;

ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view opt-outs"
  ON public.sms_opt_outs FOR SELECT
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE POLICY "Admins can manage opt-outs"
  ON public.sms_opt_outs FOR ALL
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE TRIGGER update_sms_opt_outs_updated_at
  BEFORE UPDATE ON public.sms_opt_outs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_sms_opt_outs_phone ON public.sms_opt_outs (phone);