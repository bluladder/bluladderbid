#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PUBLIC_CONTACT_DATABASE_URL:?set BLULADDER_KLAMATH_PUBLIC_CONTACT_DATABASE_URL}"

psql_args=(
  "${BLULADDER_KLAMATH_PUBLIC_CONTACT_DATABASE_URL}"
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
CREATE TABLE public.organization_customer_sites (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  tenant_key text NOT NULL UNIQUE,
  canonical_hostname text NOT NULL UNIQUE,
  mapping_status text NOT NULL,
  runtime_routing_enabled boolean NOT NULL DEFAULT false,
  site_published boolean NOT NULL DEFAULT false,
  customer_traffic_allowed boolean NOT NULL DEFAULT false
);
CREATE TABLE public.organization_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  contact_type text NOT NULL,
  label text NOT NULL,
  destination text NOT NULL
);

INSERT INTO public.organizations (id, slug, status, is_legacy_default) VALUES
  ('b1addf00-0000-4000-8000-000000000001', 'bluladder-dfw', 'active', true),
  ('b1addf00-0000-4000-8000-000000000003', 'bluladder-klamath', 'provisioning', false);
INSERT INTO public.organization_customer_sites (
  id, organization_id, tenant_key, canonical_hostname, mapping_status,
  runtime_routing_enabled, site_published, customer_traffic_allowed
) VALUES (
  'b1addf00-0000-4000-8000-000000001003',
  'b1addf00-0000-4000-8000-000000000003',
  'bluladder-klamath', 'klamath.bluladder.com', 'provisioning',
  false, false, false
);
SQL

psql "${psql_args[@]}" --file \
  supabase/preflight/bluladder_klamath_public_contact_authority.sql

psql "${psql_args[@]}" --file \
  supabase/migrations/20260815031340_bluladder_klamath_public_contact_authority.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_public_contacts) <> 0 THEN
    RAISE EXCEPTION 'public-contact migration seeded data';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.organization_public_contacts'::regclass) THEN
    RAISE EXCEPTION 'public-contact RLS is disabled';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'organization_public_contacts') <> 2 THEN
    RAISE EXCEPTION 'public-contact policy count drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'organization_public_contacts'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'public-contact anon grant unexpectedly present';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'organization_public_contacts'
        AND grantee = 'authenticated') <> 4 THEN
    RAISE EXCEPTION 'public-contact authenticated grants drifted';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'organization_public_contacts'
        AND grantee = 'service_role') <> 7 THEN
    RAISE EXCEPTION 'public-contact service-role grants drifted';
  END IF;
END
$$;

BEGIN;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_public_contacts (
      organization_id, channel, label, destination
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      'phone', 'Invalid phone', '5415550100'
    );
    RAISE EXCEPTION 'non-E.164 public phone was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.organization_public_contacts (
      organization_id, channel, label, destination, status
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      'email', 'Email support', 'support@example.com', 'published'
    );
    RAISE EXCEPTION 'unapproved public contact was published';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

INSERT INTO public.organization_public_contacts (
  organization_id, channel, label, destination, status,
  owner_approved_at, owner_approval_reference_hash, verified_at, published_at
) VALUES (
  'b1addf00-0000-4000-8000-000000000003',
  'phone', 'Call support', '+15415550100', 'published',
  '2026-08-15T00:00:00Z', repeat('a', 64),
  '2026-08-15T00:01:00Z', '2026-08-15T00:02:00Z'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_public_contacts (
      organization_id, channel, label, destination, status,
      owner_approved_at, owner_approval_reference_hash,
      verified_at, published_at
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      'phone', 'Second phone', '+15415550101', 'published',
      '2026-08-15T00:00:00Z', repeat('b', 64),
      '2026-08-15T00:01:00Z', '2026-08-15T00:02:00Z'
    );
    RAISE EXCEPTION 'duplicate published channel was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

ROLLBACK;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_public_contacts) <> 0 THEN
    RAISE EXCEPTION 'public-contact constraint rehearsal was not rolled back';
  END IF;
END
$$;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_public_contact_authority.sql

echo "BluLadder Klamath public-contact authority rehearsal passed: empty table, exact grants/RLS, publication proof, normalized destinations, and one-published-channel uniqueness."
