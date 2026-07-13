-- 1) Widen ai_escalations.alert_status to the explicit delivery-state vocabulary.
ALTER TABLE public.ai_escalations DROP CONSTRAINT IF EXISTS ai_escalations_alert_status_check;
ALTER TABLE public.ai_escalations ALTER COLUMN alert_status SET DEFAULT 'created';
UPDATE public.ai_escalations SET alert_status = 'created' WHERE alert_status = 'pending';
UPDATE public.ai_escalations SET alert_status = 'no_recipient_configured' WHERE alert_status = 'no_recipient';
ALTER TABLE public.ai_escalations
  ADD CONSTRAINT ai_escalations_alert_status_check
  CHECK (alert_status IN (
    'created','queued','sms_sent','email_sent',
    'partially_delivered','delivery_failed','suppressed','no_recipient_configured',
    'pending','sent','no_recipient'
  ));

ALTER TABLE public.ai_escalations ADD COLUMN IF NOT EXISTS sms_alert_status text;
ALTER TABLE public.ai_escalations ADD COLUMN IF NOT EXISTS sms_provider_response text;
ALTER TABLE public.ai_escalations ADD COLUMN IF NOT EXISTS email_provider_response text;
ALTER TABLE public.ai_escalations ADD COLUMN IF NOT EXISTS alert_last_attempt_at timestamptz;

-- 2) Single-use staff-reply test-suppression authorization.
CREATE TABLE IF NOT EXISTS public.staff_reply_test_authorizations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','email')),
  authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at timestamptz,
  consumed_message_id uuid
);
CREATE INDEX IF NOT EXISTS idx_staff_reply_test_auth_lookup
  ON public.staff_reply_test_authorizations(conversation_id, channel, consumed_at, expires_at);

GRANT SELECT, INSERT, UPDATE ON public.staff_reply_test_authorizations TO authenticated;
GRANT ALL ON public.staff_reply_test_authorizations TO service_role;
ALTER TABLE public.staff_reply_test_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage staff reply test auth"
  ON public.staff_reply_test_authorizations FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.authorize_staff_test_reply(
  p_conversation_id uuid,
  p_channel text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_admin_level(auth.uid(), 'operations_admin') THEN
    RAISE EXCEPTION 'operations_admin required';
  END IF;
  IF p_channel NOT IN ('sms','email') THEN
    RAISE EXCEPTION 'invalid channel';
  END IF;
  INSERT INTO public.staff_reply_test_authorizations (conversation_id, channel, authorized_by)
  VALUES (p_conversation_id, p_channel, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorize_staff_test_reply(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_staff_test_reply_auth(
  p_conversation_id uuid,
  p_channel text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.staff_reply_test_authorizations
  SET consumed_at = now()
  WHERE id = (
    SELECT id FROM public.staff_reply_test_authorizations
    WHERE conversation_id = p_conversation_id
      AND channel = p_channel
      AND consumed_at IS NULL
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_staff_test_reply_auth(uuid, text) TO service_role;