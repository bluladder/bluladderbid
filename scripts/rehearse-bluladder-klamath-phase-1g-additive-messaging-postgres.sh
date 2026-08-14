#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1G_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1G_DATABASE_URL}"

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1G_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

psql "${psql_args[@]}" <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  ) THEN
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
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  customer_id uuid REFERENCES public.customers(id)
);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  customer_id uuid REFERENCES public.customers(id)
);
CREATE TABLE public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id),
  quote_id uuid REFERENCES public.quotes(id),
  customer_id uuid REFERENCES public.customers(id),
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'email')),
  status text NOT NULL DEFAULT 'pending',
  send_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.organizations (id, slug, status, is_legacy_default) VALUES
  ('b1addf00-0000-4000-8000-000000000001', 'bluladder-dfw', 'active', true),
  ('b1addf00-0000-4000-8000-000000000003', 'bluladder-klamath', 'provisioning', false);
INSERT INTO public.customers (id, organization_id) VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000001'
);
INSERT INTO public.quotes (id, organization_id, customer_id) VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001'
);
INSERT INTO public.bookings (id, organization_id, customer_id) VALUES (
  'f0000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001'
);
INSERT INTO public.sms_messages (quote_id) VALUES (
  'e0000000-0000-4000-8000-000000000001'
);
INSERT INTO public.sms_messages DEFAULT VALUES;
SQL

psql "${psql_args[@]}" --file \
  supabase/preflight/bluladder_klamath_phase_1g_additive_messaging_lineage.sql

psql "${psql_args[@]}" --file \
  supabase/migrations/20260814070000_bluladder_klamath_phase_1g_additive_messaging_lineage.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.organization_messaging_connectors') IS NULL THEN
    RAISE EXCEPTION 'connector table missing after rehearsal';
  END IF;
  IF (SELECT count(*) FROM public.organization_messaging_connectors) <> 0 THEN
    RAISE EXCEPTION 'migration created a connector';
  END IF;
  IF (SELECT count(*) FROM public.sms_messages WHERE organization_id IS NULL) <> 0
    OR (SELECT count(*) FROM public.sms_messages
        WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'historical SMS lineage backfill drifted';
  END IF;
  IF (SELECT count(*) FROM pg_policy
      WHERE polrelid = 'public.organization_messaging_connectors'::regclass) <> 2
    OR NOT (SELECT relrowsecurity FROM pg_class
            WHERE oid = 'public.organization_messaging_connectors'::regclass) THEN
    RAISE EXCEPTION 'connector RLS or policy contract drifted';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'organization_messaging_connectors'
        AND policyname IN (
          'Tenant members view messaging connectors',
          'Tenant operators manage messaging connectors'
        )) <> 2 THEN
    RAISE EXCEPTION 'connector policy identity drifted';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'organization_messaging_connectors'
        AND grantee = 'anon') <> 0 THEN
    RAISE EXCEPTION 'anon connector privilege unexpectedly present';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'organization_messaging_connectors'
        AND grantee = 'authenticated'
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) <> 4 THEN
    RAISE EXCEPTION 'authenticated connector grants drifted';
  END IF;
  IF NOT has_table_privilege(
    'service_role', 'public.organization_messaging_connectors', 'SELECT'
  ) OR NOT has_table_privilege(
    'service_role', 'public.organization_messaging_connectors', 'INSERT'
  ) OR NOT has_table_privilege(
    'service_role', 'public.organization_messaging_connectors', 'UPDATE'
  ) OR NOT has_table_privilege(
    'service_role', 'public.organization_messaging_connectors', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'service-role connector grants drifted';
  END IF;
  IF has_function_privilege(
    'anon', 'public.enforce_sms_message_organization_lineage()', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.enforce_sms_message_organization_lineage()', 'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.enforce_sms_message_organization_lineage()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'lineage trigger function is directly executable';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sms_messages'
        AND column_name IN ('organization_id', 'messaging_connector_id')
        AND is_nullable = 'YES') <> 2 THEN
    RAISE EXCEPTION 'staged nullable lineage contract drifted';
  END IF;
END
$$;

BEGIN;
INSERT INTO public.organization_messaging_connectors (
  id, organization_id, channel, provider, status,
  credential_reference, sender_identity_reference
) VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000001',
  'sms', 'callrail', 'active', 'credential-ref', 'sender-ref'
);

INSERT INTO public.sms_messages (booking_id, messaging_connector_id)
VALUES (
  'f0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sms_messages
    WHERE booking_id = 'f0000000-0000-4000-8000-000000000001'
      AND organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND messaging_connector_id = 'd0000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'server-parent lineage derivation failed';
  END IF;

  BEGIN
    INSERT INTO public.sms_messages (organization_id, booking_id)
    VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      'f0000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-organization parent lineage was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-organization parent lineage was accepted' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO public.sms_messages (
      organization_id, channel, messaging_connector_id
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000001',
      'email',
      'd0000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-channel connector lineage was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-channel connector lineage was accepted' THEN
      RAISE;
    END IF;
  END;
END
$$;
ROLLBACK;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_phase_1g_additive_messaging_lineage.sql

echo "BluLadder Klamath Phase 1G additive messaging lineage rehearsal passed."
