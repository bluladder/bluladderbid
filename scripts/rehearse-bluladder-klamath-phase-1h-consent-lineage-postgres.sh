#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1H_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1H_DATABASE_URL}"

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1H_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

psql "${psql_args[@]}" <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$roles$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.has_admin_level(uuid, text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TYPE public.consent_channel AS ENUM ('sms', 'email');
CREATE TYPE public.consent_type AS ENUM (
  'transactional', 'requested_follow_up', 'marketing'
);
CREATE TYPE public.consent_status AS ENUM ('granted', 'revoked', 'unknown');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  status text NOT NULL,
  is_legacy_default boolean NOT NULL DEFAULT false
);
CREATE TABLE public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  status text NOT NULL,
  role text NOT NULL
);
CREATE TABLE public.organization_resolution_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  key_type text NOT NULL,
  key_value text NOT NULL
);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id)
);

CREATE TABLE public.communication_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.chat_conversations(id)
    ON DELETE SET NULL,
  email text,
  phone text,
  channel public.consent_channel NOT NULL,
  consent_type public.consent_type NOT NULL,
  status public.consent_status NOT NULL DEFAULT 'unknown',
  language_shown text,
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
CREATE UNIQUE INDEX uq_consent_sms
  ON public.communication_consent(phone, consent_type)
  WHERE channel = 'sms' AND phone IS NOT NULL;
CREATE UNIQUE INDEX uq_consent_email
  ON public.communication_consent(email, consent_type)
  WHERE channel = 'email' AND email IS NOT NULL;
ALTER TABLE public.communication_consent ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.communication_consent TO authenticated;
GRANT ALL ON public.communication_consent TO service_role;
CREATE POLICY "Admins view consent" ON public.communication_consent
  FOR SELECT TO authenticated USING (
    public.has_admin_level(auth.uid(), 'read_only_admin')
  );
CREATE POLICY "Admins manage consent" ON public.communication_consent
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));
CREATE TRIGGER trg_consent_updated
  BEFORE UPDATE ON public.communication_consent
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.communication_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id uuid REFERENCES public.communication_consent(id) ON DELETE CASCADE,
  action text NOT NULL,
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
ALTER TABLE public.communication_consent_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.communication_consent_events TO authenticated;
GRANT ALL ON public.communication_consent_events TO service_role;
CREATE POLICY "Admins view consent history"
  ON public.communication_consent_events FOR SELECT TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE FUNCTION public.record_consent(
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
) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.consent_allows(
  p_channel public.consent_channel,
  p_required public.consent_type,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.record_consent(
  public.consent_channel, public.consent_type, public.consent_status,
  text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_consent(
  public.consent_channel, public.consent_type, public.consent_status,
  text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION public.consent_allows(
  public.consent_channel, public.consent_type, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consent_allows(
  public.consent_channel, public.consent_type, text, text
) TO service_role, authenticated;

INSERT INTO public.organizations (id, slug, status, is_legacy_default) VALUES
  ('b1addf00-0000-4000-8000-000000000001', 'bluladder-dfw', 'active', true),
  ('b1addf00-0000-4000-8000-000000000003', 'bluladder-klamath', 'provisioning', false);
INSERT INTO public.customers (id, organization_id) VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000001'
);
INSERT INTO public.chat_conversations (id, organization_id) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000001'
);
INSERT INTO public.bookings (id, organization_id) VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000001'
);
INSERT INTO public.communication_consent (
  id, phone, channel, consent_type, status, source
) VALUES (
  'f0000000-0000-4000-8000-000000000001', '+10000000001',
  'sms', 'requested_follow_up', 'granted', 'legacy'
);
INSERT INTO public.communication_consent (
  id, customer_id, conversation_id, booking_id, email,
  channel, consent_type, status, source
) VALUES (
  'f0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'dfw@example.test', 'email', 'marketing', 'granted', 'legacy'
);
INSERT INTO public.communication_consent_events (
  consent_id, action, channel, consent_type, status, source, phone
) VALUES (
  'f0000000-0000-4000-8000-000000000001', 'create', 'sms',
  'requested_follow_up', 'granted', 'legacy', '+10000000001'
);
INSERT INTO public.communication_consent_events (
  consent_id, action, channel, consent_type, status, source, email
) VALUES (
  'f0000000-0000-4000-8000-000000000002', 'create', 'email',
  'marketing', 'granted', 'legacy', 'dfw@example.test'
);
SQL

psql "${psql_args[@]}" --file \
  supabase/preflight/bluladder_klamath_phase_1h_consent_lineage.sql

psql "${psql_args[@]}" --file \
  supabase/migrations/20260814102000_bluladder_klamath_phase_1h_organization_consent_lineage.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.communication_consent) <> 2
    OR (SELECT count(*) FROM public.communication_consent_events) <> 2 THEN
    RAISE EXCEPTION 'Phase 1H migration changed historical row counts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.communication_consent
    WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM public.communication_consent_events
    WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Phase 1H explicit DFW backfill failed';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'communication_consent') <> 2
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'communication_consent_events') <> 1 THEN
    RAISE EXCEPTION 'Phase 1H tenant policy contract drifted';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.record_organization_consent(uuid,public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.consent_allows_for_organization(uuid,public.consent_channel,public.consent_type,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.record_organization_consent(uuid,public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Phase 1H organization function grants drifted';
  END IF;
END
$$;

BEGIN;
DO $$
BEGIN
  BEGIN
    PERFORM public.record_organization_consent(
      'b1addf00-0000-4000-8000-000000000003',
      'sms', 'requested_follow_up', 'granted', NULL, '+10000000001'
    );
    RAISE EXCEPTION 'provisioning organization recorded consent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'provisioning organization recorded consent' THEN RAISE; END IF;
  END;

  UPDATE public.organizations SET status = 'active'
  WHERE id = 'b1addf00-0000-4000-8000-000000000003';
  PERFORM public.record_organization_consent(
    'b1addf00-0000-4000-8000-000000000003',
    'sms', 'requested_follow_up', 'granted', NULL, '+10000000001'
  );
  IF (SELECT count(*) FROM public.communication_consent
      WHERE phone = '+10000000001') <> 2 THEN
    RAISE EXCEPTION 'organization-scoped consent identity was not isolated';
  END IF;
  IF NOT public.consent_allows_for_organization(
    'b1addf00-0000-4000-8000-000000000003',
    'sms', 'requested_follow_up', NULL, '+10000000001'
  ) THEN
    RAISE EXCEPTION 'organization-scoped consent lookup failed';
  END IF;

  BEGIN
    PERFORM public.record_organization_consent(
      'b1addf00-0000-4000-8000-000000000003',
      'email', 'marketing', 'granted', 'other@example.test', NULL,
      NULL, 'test', 'c0000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-organization parent consent was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-organization parent consent was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.record_consent(
      'email', 'marketing', 'granted', 'legacy@example.test', NULL,
      NULL, 'test', NULL, NULL, NULL,
      NULL, NULL, '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'legacy DFW wrapper failed: %', SQLERRM;
  END;
END
$$;
ROLLBACK;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_phase_1h_organization_consent_lineage.sql

echo "BluLadder Klamath Phase 1H consent-lineage rehearsal passed."
