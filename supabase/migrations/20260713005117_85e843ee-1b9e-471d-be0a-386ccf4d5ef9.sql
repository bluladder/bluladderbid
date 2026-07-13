
-- ============================================================================
-- ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.consent_channel AS ENUM ('sms','email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.consent_type AS ENUM ('transactional','requested_follow_up','marketing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.consent_status AS ENUM ('granted','revoked','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- CANONICAL CONSENT
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.communication_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  email text,                         -- normalized lowercase
  phone text,                         -- normalized E.164
  channel public.consent_channel NOT NULL,
  consent_type public.consent_type NOT NULL,
  status public.consent_status NOT NULL DEFAULT 'unknown',
  language_shown text,                -- exact language presented to the user
  source text NOT NULL DEFAULT 'system',
  granted_at timestamptz,
  revoked_at timestamptz,
  opt_out_source text,
  session_id text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  campaign_event_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One canonical record per identity+channel+type. Identity is the phone for
-- SMS consent and the email for email consent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_sms
  ON public.communication_consent(phone, consent_type)
  WHERE channel = 'sms' AND phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_email
  ON public.communication_consent(email, consent_type)
  WHERE channel = 'email' AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_customer ON public.communication_consent(customer_id);
CREATE INDEX IF NOT EXISTS idx_consent_conversation ON public.communication_consent(conversation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_consent TO authenticated;
GRANT ALL ON public.communication_consent TO service_role;
ALTER TABLE public.communication_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view consent" ON public.communication_consent
  FOR SELECT TO authenticated USING (public.has_admin_level(auth.uid(),'read_only_admin'));
CREATE POLICY "Admins manage consent" ON public.communication_consent
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(),'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(),'operations_admin'));

CREATE TRIGGER trg_consent_updated BEFORE UPDATE ON public.communication_consent
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- CONSENT AUDIT HISTORY
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.communication_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id uuid REFERENCES public.communication_consent(id) ON DELETE CASCADE,
  action text NOT NULL,               -- 'create' | 'grant' | 'revoke' | 'update'
  channel public.consent_channel,
  consent_type public.consent_type,
  status public.consent_status,
  language_shown text,
  source text,
  actor_id uuid,
  email text,
  phone text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_events_consent ON public.communication_consent_events(consent_id);
CREATE INDEX IF NOT EXISTS idx_consent_events_created ON public.communication_consent_events(created_at DESC);

GRANT SELECT, INSERT ON public.communication_consent_events TO authenticated;
GRANT ALL ON public.communication_consent_events TO service_role;
ALTER TABLE public.communication_consent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view consent history" ON public.communication_consent_events
  FOR SELECT TO authenticated USING (public.has_admin_level(auth.uid(),'read_only_admin'));

-- ============================================================================
-- ALLOWLISTED CAMPAIGN EVENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  email text,
  phone text,
  source text NOT NULL DEFAULT 'system',
  subject text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  enrollments_created integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_events_name_chk CHECK (event_name IN (
    'chat_lead_created','quote_calculated','manual_quote_requested','callback_requested',
    'quote_abandoned','booking_completed','appointment_rescheduled','appointment_cancelled',
    'customer_replied','consent_granted','consent_revoked','manual_staff_takeover'
  ))
);
CREATE INDEX IF NOT EXISTS idx_campaign_events_name ON public.campaign_events(event_name);
CREATE INDEX IF NOT EXISTS idx_campaign_events_created ON public.campaign_events(created_at DESC);

GRANT SELECT ON public.campaign_events TO authenticated;
GRANT ALL ON public.campaign_events TO service_role;
ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view campaign events" ON public.campaign_events
  FOR SELECT TO authenticated USING (public.has_admin_level(auth.uid(),'read_only_admin'));

-- ============================================================================
-- CAMPAIGN CONFIG EXTENSIONS
-- ============================================================================
ALTER TABLE public.sms_campaigns
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS audience_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS required_consent public.consent_type,
  ADD COLUMN IF NOT EXISTS reentry_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reentry_cooldown_hours integer,
  ADD COLUMN IF NOT EXISTS stop_conditions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================================
-- ENROLLMENT EXTENSIONS
-- ============================================================================
ALTER TABLE public.campaign_enrollments
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.campaign_enrollments
  ADD COLUMN IF NOT EXISTS campaign_event_id uuid REFERENCES public.campaign_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_version integer,
  ADD COLUMN IF NOT EXISTS campaign_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS stopped_reason text,
  ADD COLUMN IF NOT EXISTS stopped_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppressed_reason text;

-- Widen the allowed status set.
ALTER TABLE public.campaign_enrollments DROP CONSTRAINT IF EXISTS campaign_enrollments_status_chk;
ALTER TABLE public.campaign_enrollments ADD CONSTRAINT campaign_enrollments_status_chk
  CHECK (status IN ('active','paused','stopped','completed','superseded','suppressed','skipped'));

-- One active enrollment per campaign + identity + qualifying event (idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_active
  ON public.campaign_enrollments(
    campaign_id,
    COALESCE(customer_id::text, email, phone, ''),
    COALESCE(event_name, '')
  )
  WHERE status = 'active';

-- ============================================================================
-- CONSENT HELPER FUNCTIONS
-- ============================================================================

-- Record (upsert) a consent decision and append an audit event. Runs with
-- definer rights so backend functions and admins share one canonical path.
CREATE OR REPLACE FUNCTION public.record_consent(
  p_channel public.consent_channel,
  p_consent_type public.consent_type,
  p_status public.consent_status,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_language_shown text DEFAULT NULL,
  p_source text DEFAULT 'system',
  p_customer_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := NULLIF(lower(trim(coalesce(p_email,''))),'');
  v_phone text := NULLIF(trim(coalesce(p_phone,'')),'');
  v_id uuid;
  v_action text;
BEGIN
  IF p_channel = 'sms' AND v_phone IS NULL THEN
    RAISE EXCEPTION 'SMS consent requires a phone number';
  END IF;
  IF p_channel = 'email' AND v_email IS NULL THEN
    RAISE EXCEPTION 'Email consent requires an email address';
  END IF;

  IF p_channel = 'sms' THEN
    SELECT id INTO v_id FROM public.communication_consent
      WHERE channel = 'sms' AND phone = v_phone AND consent_type = p_consent_type;
  ELSE
    SELECT id INTO v_id FROM public.communication_consent
      WHERE channel = 'email' AND email = v_email AND consent_type = p_consent_type;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.communication_consent(
      customer_id, conversation_id, email, phone, channel, consent_type, status,
      language_shown, source, granted_at, revoked_at, session_id, booking_id, metadata)
    VALUES (
      p_customer_id, p_conversation_id, v_email, v_phone, p_channel, p_consent_type, p_status,
      p_language_shown, p_source,
      CASE WHEN p_status='granted' THEN now() END,
      CASE WHEN p_status='revoked' THEN now() END,
      p_session_id, p_booking_id, coalesce(p_metadata,'{}'::jsonb))
    RETURNING id INTO v_id;
    v_action := 'create';
  ELSE
    UPDATE public.communication_consent SET
      status = p_status,
      language_shown = COALESCE(p_language_shown, language_shown),
      source = p_source,
      customer_id = COALESCE(p_customer_id, customer_id),
      conversation_id = COALESCE(p_conversation_id, conversation_id),
      granted_at = CASE WHEN p_status='granted' THEN now() ELSE granted_at END,
      revoked_at = CASE WHEN p_status='revoked' THEN now() ELSE revoked_at END,
      opt_out_source = CASE WHEN p_status='revoked' THEN p_source ELSE opt_out_source END,
      metadata = coalesce(communication_consent.metadata,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb),
      updated_at = now()
    WHERE id = v_id;
    v_action := CASE WHEN p_status='granted' THEN 'grant' WHEN p_status='revoked' THEN 'revoke' ELSE 'update' END;
  END IF;

  INSERT INTO public.communication_consent_events(
    consent_id, action, channel, consent_type, status, language_shown, source,
    actor_id, email, phone, metadata)
  VALUES (v_id, v_action, p_channel, p_consent_type, p_status, p_language_shown, p_source,
    p_actor_id, v_email, v_phone, coalesce(p_metadata,'{}'::jsonb));

  RETURN v_id;
END $$;

-- Returns true when existing consent permits a message of the required type on
-- the given channel. Transactional is always permitted (opt-out is enforced
-- separately); requested_follow_up is satisfied by follow-up OR marketing
-- consent; marketing requires an un-revoked marketing grant.
CREATE OR REPLACE FUNCTION public.consent_allows(
  p_channel public.consent_channel,
  p_required public.consent_type,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := NULLIF(lower(trim(coalesce(p_email,''))),'');
  v_phone text := NULLIF(trim(coalesce(p_phone,'')),'');
  v_types public.consent_type[];
BEGIN
  IF p_required = 'transactional' THEN
    RETURN true;
  END IF;

  IF p_channel = 'sms' THEN
    IF v_phone IS NULL THEN RETURN false; END IF;
    SELECT array_agg(consent_type) INTO v_types FROM public.communication_consent
      WHERE channel='sms' AND phone=v_phone AND status='granted';
  ELSE
    IF v_email IS NULL THEN RETURN false; END IF;
    SELECT array_agg(consent_type) INTO v_types FROM public.communication_consent
      WHERE channel='email' AND email=v_email AND status='granted';
  END IF;

  IF v_types IS NULL THEN RETURN false; END IF;

  IF p_required = 'marketing' THEN
    RETURN 'marketing' = ANY(v_types);
  ELSIF p_required = 'requested_follow_up' THEN
    RETURN ('requested_follow_up' = ANY(v_types)) OR ('marketing' = ANY(v_types));
  END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.record_consent(public.consent_channel, public.consent_type, public.consent_status, text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.consent_allows(public.consent_channel, public.consent_type, text, text) TO service_role, authenticated;
