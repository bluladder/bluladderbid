#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL:?Set BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL to a disposable PostgreSQL database}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration="$repo_root/supabase/migrations/20260814022314_bluladder_klamath_stage_8a_hosted_compatibility.sql"
historical_stage8a="$repo_root/supabase/migrations/20260728070000_organization_routing_stage_8a.sql"
verification="$repo_root/supabase/verification/bluladder_klamath_stage_8a_hosted_compatibility.sql"
admin_url="${BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL%/*}/postgres"

install_core_fixture() {
  database_url=$1
  psql "$database_url" -X --set=ON_ERROR_STOP=1 <<'SQL'
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

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('provisioning', 'active', 'suspended', 'archived')
  ),
  is_legacy_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (
    role IN ('owner', 'admin', 'operations', 'read_only')
  ),
  status text NOT NULL CHECK (
    status IN ('invited', 'active', 'suspended', 'revoked')
  ),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE public.organization_resolution_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  key_type text NOT NULL,
  key_hash text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key_type, key_hash)
);

GRANT SELECT ON public.organizations, public.organization_memberships
  TO authenticated;
GRANT ALL ON public.organizations, public.organization_memberships,
  public.organization_resolution_keys TO service_role;

INSERT INTO public.organizations (
  id, slug, display_name, status, is_legacy_default
) VALUES (
  'b1addf00-0000-4000-8000-000000000001',
  'bluladder-dfw',
  'BluLadder DFW',
  'active',
  true
);
SQL
}

install_core_fixture "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL"

dfw_before=$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT md5(row_to_json(o)::text) FROM public.organizations o WHERE id='b1addf00-0000-4000-8000-000000000001'")

psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X \
  --set=ON_ERROR_STOP=1 --file="$migration"
psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X \
  --set=ON_ERROR_STOP=1 --file="$verification"

test "$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organization_settings','organization_contacts','organization_territories','organization_services')")" = "4"
test "$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organizations WHERE slug='bluladder-oregon-test' AND status='provisioning' AND NOT is_legacy_default")" = "1"
test "$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organization_territories WHERE organization_id='b1addf00-0000-4000-8000-000000000002' AND status='inactive'")" = "1"
test "$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT to_regprocedure('public.is_organization_member(uuid,uuid)') IS NULL")" = "t"

dfw_after=$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT md5(row_to_json(o)::text) FROM public.organizations o WHERE id='b1addf00-0000-4000-8000-000000000001'")
test "$dfw_before" = "$dfw_after"

# An authenticated DFW member sees DFW settings only; the provisioning Oregon
# fixture remains invisible and anonymous receives no table privilege.
psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X \
  --set=ON_ERROR_STOP=1 -c \
  "INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ('b1addf00-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','read_only','active')"
visible=$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 <<'SQL'
SET ROLE authenticated;
SET request.jwt.claim.sub = '80000000-0000-4000-8000-000000000001';
SELECT count(*) FROM public.organization_settings;
SELECT count(*) FROM public.organization_settings
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002';
SQL
)
test "$(printf '%s\n' "$visible" | tail -2 | head -1)" = "1"
test "$(printf '%s\n' "$visible" | tail -1)" = "0"
test "$(psql "$BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT has_table_privilege('anon','public.organization_settings','SELECT')")" = "f"

# A pre-existing Oregon identity is a hard collision and creates no Stage 8A
# table. No Klamath object is involved.
collision_db=bluladder_klamath_stage8a_compat_collision
psql "$admin_url" -X --set=ON_ERROR_STOP=1 -c "CREATE DATABASE $collision_db"
collision_url="${BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL%/*}/$collision_db"
install_core_fixture "$collision_url"
psql "$collision_url" -X --set=ON_ERROR_STOP=1 -c \
  "INSERT INTO public.organizations(id,slug,display_name,status,is_legacy_default) VALUES ('90000000-0000-4000-8000-000000000002','bluladder-oregon-test','Collision','provisioning',false)"
if psql "$collision_url" -X --set=ON_ERROR_STOP=1 --file="$migration"; then
  echo "Oregon identity collision unexpectedly passed" >&2
  exit 1
fi
test "$(psql "$collision_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organization_settings','organization_contacts','organization_territories','organization_services')")" = "0"

# Any partial target-table state fails closed before the migration adds data or
# additional tables.
partial_db=bluladder_klamath_stage8a_compat_partial
psql "$admin_url" -X --set=ON_ERROR_STOP=1 -c "CREATE DATABASE $partial_db"
partial_url="${BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL%/*}/$partial_db"
install_core_fixture "$partial_url"
psql "$partial_url" -X --set=ON_ERROR_STOP=1 -c \
  "CREATE TABLE public.organization_settings(organization_id uuid PRIMARY KEY REFERENCES public.organizations(id), public_name text NOT NULL)"
if psql "$partial_url" -X --set=ON_ERROR_STOP=1 --file="$migration"; then
  echo "partial Stage 8A table state unexpectedly passed" >&2
  exit 1
fi
test "$(psql "$partial_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organization_settings','organization_contacts','organization_territories','organization_services')")" = "1"
test "$(psql "$partial_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organizations WHERE slug='bluladder-oregon-test'")" = "0"

# A compatible all-present state converges after the obsolete helper and its
# dependent read policies have been retired; no fixture row is duplicated.
convergence_db=bluladder_klamath_stage8a_compat_convergence
psql "$admin_url" -X --set=ON_ERROR_STOP=1 -c "CREATE DATABASE $convergence_db"
convergence_url="${BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL%/*}/$convergence_db"
install_core_fixture "$convergence_url"
psql "$convergence_url" -X --set=ON_ERROR_STOP=1 <<'SQL'
CREATE OR REPLACE FUNCTION public.is_organization_member(
  _organization_id uuid,
  _user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT false $$;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid, uuid)
  TO authenticated, service_role;
SQL
psql "$convergence_url" -X --set=ON_ERROR_STOP=1 --file="$historical_stage8a"
psql "$convergence_url" -X --set=ON_ERROR_STOP=1 <<'SQL'
DROP POLICY "Members read organization settings" ON public.organization_settings;
DROP POLICY "Members read organization contacts" ON public.organization_contacts;
DROP POLICY "Members read organization territories" ON public.organization_territories;
DROP POLICY "Members read organization services" ON public.organization_services;
DROP FUNCTION public.is_organization_member(uuid, uuid);
SQL
psql "$convergence_url" -X --set=ON_ERROR_STOP=1 --file="$migration"
test "$(psql "$convergence_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organizations WHERE slug='bluladder-oregon-test'")" = "1"
test "$(psql "$convergence_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organization_territories WHERE organization_id='b1addf00-0000-4000-8000-000000000002'")" = "1"
test "$(psql "$convergence_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('organization_settings','organization_contacts','organization_territories','organization_services')")" = "8"

# An injected final-statement failure rolls back every new table, fixture row,
# grant, and policy in a fresh database.
rollback_db=bluladder_klamath_stage8a_compat_rollback
psql "$admin_url" -X --set=ON_ERROR_STOP=1 -c "CREATE DATABASE $rollback_db"
rollback_url="${BLULADDER_KLAMATH_STAGE8A_COMPAT_DATABASE_URL%/*}/$rollback_db"
install_core_fixture "$rollback_url"
failed_payload=$(mktemp)
trap 'rm -f "$failed_payload"' EXIT
awk '
  /^COMMIT;$/ {
    print "SELECT 1/0;"
    print "COMMIT;"
    next
  }
  { print }
' "$migration" >"$failed_payload"
if psql "$rollback_url" -X --set=ON_ERROR_STOP=1 --file="$failed_payload"; then
  echo "injected Stage 8A compatibility failure unexpectedly committed" >&2
  exit 1
fi
test "$(psql "$rollback_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organization_settings','organization_contacts','organization_territories','organization_services')")" = "0"
test "$(psql "$rollback_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organizations WHERE slug='bluladder-oregon-test'")" = "0"

echo "BluLadder Klamath Stage 8A hosted-compatibility rehearsal passed: hosted-missing application, direct RLS isolation, DFW preservation, collision/partial stops, convergence, and atomic rollback."
