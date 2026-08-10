#!/usr/bin/env bash
set -euo pipefail

: "${VOICE_ESCALATION_RECIPIENT_DATABASE_URL:?Set VOICE_ESCALATION_RECIPIENT_DATABASE_URL to a disposable PostgreSQL database}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration="$repo_root/supabase/migrations/20260810150000_voice_escalation_recipients_tenant_scope.sql"

install_fixture() {
  psql "$VOICE_ESCALATION_RECIPIENT_DATABASE_URL" -X --set=ON_ERROR_STOP=1 <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  status text NOT NULL,
  is_legacy_default boolean NOT NULL DEFAULT false
);

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);

CREATE SCHEMA IF NOT EXISTS tenant_security;
CREATE OR REPLACE FUNCTION tenant_security.current_organization_role(
  p_organization_id uuid
)
RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;

CREATE TABLE public.escalation_recipients (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  role text NOT NULL DEFAULT 'primary',
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  handles_urgent boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz
);
ALTER TABLE public.escalation_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage escalation recipients"
  ON public.escalation_recipients FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

INSERT INTO public.organizations (id, slug, status, is_legacy_default)
VALUES (
  'b1addf00-0000-4000-8000-000000000001',
  'bluladder-dfw',
  'active',
  true
);
INSERT INTO public.escalation_recipients (
  id, name, phone, email, role, is_enabled, verified_at
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'DFW operator',
  '+14692150144',
  'operator@example.com',
  'primary',
  true,
  now()
);
SQL
}

install_fixture
psql "$VOICE_ESCALATION_RECIPIENT_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file="$migration"

psql "$VOICE_ESCALATION_RECIPIENT_DATABASE_URL" -X --set=ON_ERROR_STOP=1 <<'SQL'
DO $verify$
BEGIN
  IF (SELECT organization_id FROM public.escalation_recipients LIMIT 1)
      <> 'b1addf00-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'historical DFW recipient was not bound exactly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.escalation_recipients'::regclass
      AND attname = 'organization_id'
      AND attnotnull
  ) THEN
    RAISE EXCEPTION 'organization_id is not required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'escalation_recipients_organization_id_fkey'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'organization foreign key is absent or unvalidated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'escalation_recipients_one_active_primary_idx'
  ) THEN
    RAISE EXCEPTION 'one-primary index is absent';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'escalation_recipients') <> 2 THEN
    RAISE EXCEPTION 'tenant recipient RLS policy count is not exact';
  END IF;
END;
$verify$;

DO $unique_primary$
BEGIN
  BEGIN
    INSERT INTO public.escalation_recipients (
      id, organization_id, name, phone, role, is_enabled, verified_at
    ) VALUES (
      '10000000-0000-4000-8000-000000000002',
      'b1addf00-0000-4000-8000-000000000001',
      'Ambiguous operator',
      '+14695550102',
      'primary',
      true,
      now()
    );
    RAISE EXCEPTION 'a second enabled primary was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$unique_primary$;
SQL

# Exact rerun remains safe and keeps the same authoritative DFW binding.
psql "$VOICE_ESCALATION_RECIPIENT_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file="$migration"

# Rebuild only this disposable schema with a second active organization. The
# migration must abort and roll back even though its ALTER TABLE ran first.
psql "$VOICE_ESCALATION_RECIPIENT_DATABASE_URL" -X --set=ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  status text NOT NULL,
  is_legacy_default boolean NOT NULL DEFAULT false
);
CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);
CREATE SCHEMA IF NOT EXISTS tenant_security;
CREATE OR REPLACE FUNCTION tenant_security.current_organization_role(
  p_organization_id uuid
)
RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE TABLE public.escalation_recipients (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  role text NOT NULL DEFAULT 'primary',
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  handles_urgent boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz
);
ALTER TABLE public.escalation_recipients ENABLE ROW LEVEL SECURITY;
INSERT INTO public.organizations (id, slug, status, is_legacy_default) VALUES
  ('b1addf00-0000-4000-8000-000000000001', 'bluladder-dfw', 'active', true),
  ('20000000-0000-4000-8000-000000000002', 'bluladder-klamath', 'active', false);
INSERT INTO public.escalation_recipients (id, name, phone, role, is_enabled)
VALUES (
  '10000000-0000-4000-8000-000000000003',
  'Unscoped historical operator',
  '+14695550103',
  'primary',
  true
);
SQL

if psql "$VOICE_ESCALATION_RECIPIENT_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file="$migration"; then
  echo "multi-organization ambiguity unexpectedly allowed recipient backfill" >&2
  exit 1
fi

test "$(psql "$VOICE_ESCALATION_RECIPIENT_DATABASE_URL" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='escalation_recipients' AND column_name='organization_id'")" = "0"

echo "Voice escalation-recipient PostgreSQL rehearsal passed: exact DFW backfill, validated tenant FK/RLS, one-primary determinism, safe rerun, and atomic ambiguity rollback."
