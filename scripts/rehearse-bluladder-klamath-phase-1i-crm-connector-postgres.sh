#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1I_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1I_DATABASE_URL}"

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1I_DATABASE_URL}"
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
CREATE INDEX organization_memberships_org_user_idx
  ON public.organization_memberships (organization_id, user_id, status);
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

INSERT INTO public.organizations (id, slug, status, is_legacy_default) VALUES
  ('b1addf00-0000-4000-8000-000000000001', 'bluladder-dfw', 'active', true),
  ('b1addf00-0000-4000-8000-000000000003', 'bluladder-klamath', 'provisioning', false);
SQL

psql "${psql_args[@]}" --file \
  supabase/preflight/bluladder_klamath_phase_1i_crm_connector_lineage.sql

psql "${psql_args[@]}" --file \
  supabase/migrations/20260814113000_bluladder_klamath_phase_1i_crm_connector_lineage.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_crm_connectors) <> 0
    OR (SELECT count(*)
        FROM public.organization_connector_operation_attempts) <> 0
    OR (SELECT count(*)
        FROM public.organization_connector_webhook_receipts) <> 0 THEN
    RAISE EXCEPTION 'Phase 1I migration created runtime data';
  END IF;

  IF (SELECT count(*) FROM pg_class relation
      WHERE relation.oid IN (
        'public.organization_crm_connectors'::regclass,
        'public.organization_connector_operation_attempts'::regclass,
        'public.organization_connector_webhook_receipts'::regclass
      ) AND relation.relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'Phase 1I RLS contract drifted';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'organization_crm_connectors') <> 2
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_connector_operation_attempts') <> 1
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_connector_webhook_receipts') <> 1 THEN
    RAISE EXCEPTION 'Phase 1I policy count drifted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (
        'organization_crm_connectors',
        'organization_connector_operation_attempts',
        'organization_connector_webhook_receipts'
      )
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'Phase 1I anon privilege unexpectedly present';
  END IF;

  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'organization_crm_connectors'
        AND grantee = 'authenticated'
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) <> 4
    OR (SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name IN (
            'organization_connector_operation_attempts',
            'organization_connector_webhook_receipts'
          )
          AND grantee = 'authenticated'
          AND privilege_type = 'SELECT') <> 2 THEN
    RAISE EXCEPTION 'Phase 1I authenticated grants drifted';
  END IF;
END
$$;

BEGIN;

INSERT INTO public.organization_crm_connectors (
  id, organization_id, provider, status, priority, capabilities
) VALUES (
  '91000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000003',
  'jobtread', 'inactive', 100, '{}'::text[]
);

DO $$
BEGIN
  BEGIN
    UPDATE public.organization_crm_connectors
    SET status = 'active',
        runtime_enabled = true,
        capabilities = ARRAY['health']::text[]
    WHERE id = '91000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'connector activated without protected references';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

UPDATE public.organization_crm_connectors
SET status = 'active',
    runtime_enabled = true,
    capabilities = ARRAY['health']::text[],
    credential_reference = 'protected-reference',
    provider_organization_fingerprint = repeat('a', 64)
WHERE id = '91000000-0000-4000-8000-000000000001';

INSERT INTO public.organization_connector_operation_attempts (
  id, organization_id, connector_id, operation,
  idempotency_key_hash, request_fingerprint
) VALUES (
  '92000000-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000003',
  '91000000-0000-4000-8000-000000000001',
  'health', repeat('b', 64), repeat('c', 64)
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_connector_operation_attempts (
      organization_id, connector_id, operation,
      idempotency_key_hash, request_fingerprint
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001',
      'health', repeat('b', 64), repeat('d', 64)
    );
    RAISE EXCEPTION 'duplicate operation idempotency was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.organization_connector_operation_attempts (
      organization_id, connector_id, operation,
      idempotency_key_hash, request_fingerprint
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      'health', repeat('e', 64), repeat('f', 64)
    );
    RAISE EXCEPTION 'cross-organization connector lineage was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.organization_connector_webhook_receipts (
      organization_id, connector_id, provider_event_hash, event_type,
      payload_fingerprint, source_authenticated
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001',
      repeat('1', 64), 'job.updated', repeat('2', 64), false
    );
    RAISE EXCEPTION 'unauthenticated webhook receipt was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

INSERT INTO public.organization_connector_webhook_receipts (
  organization_id, connector_id, provider_event_hash, event_type,
  payload_fingerprint, source_authenticated
) VALUES (
  'b1addf00-0000-4000-8000-000000000003',
  '91000000-0000-4000-8000-000000000001',
  repeat('1', 64), 'job.updated', repeat('2', 64), true
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_connector_webhook_receipts (
      organization_id, connector_id, provider_event_hash, event_type,
      payload_fingerprint, source_authenticated
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001',
      repeat('1', 64), 'job.updated', repeat('3', 64), true
    );
    RAISE EXCEPTION 'duplicate webhook event was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

ROLLBACK;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_crm_connectors) <> 0
    OR (SELECT count(*)
        FROM public.organization_connector_operation_attempts) <> 0
    OR (SELECT count(*)
        FROM public.organization_connector_webhook_receipts) <> 0 THEN
    RAISE EXCEPTION 'Phase 1I negative tests leaked data';
  END IF;
END
$$;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_phase_1i_crm_connector_lineage.sql

echo "BluLadder Klamath Phase 1I CRM connector lineage rehearsal passed."
