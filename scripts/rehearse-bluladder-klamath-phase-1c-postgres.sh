#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1C_DATABASE_URL:?Set BLULADDER_KLAMATH_PHASE1C_DATABASE_URL to a disposable PostgreSQL database}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration="$repo_root/supabase/migrations/20260813223348_bluladder_klamath_phase_1c_inactive_foundation.sql"
verification="$repo_root/supabase/verification/bluladder_klamath_phase_1c.sql"
admin_url="${BLULADDER_KLAMATH_PHASE1C_DATABASE_URL%/*}/postgres"

install_fixture() {
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
RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL,
  is_legacy_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.organization_resolution_keys (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  key_type text NOT NULL,
  key_hash text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key_type, key_hash)
);

-- Match the tenant-foundation grants already present in hosted schema history.
-- The Phase 1C RLS policies evaluate organization_memberships for authenticated
-- callers, so omitting this established grant would make the disposable fixture
-- less capable than the real prerequisite schema.
GRANT SELECT ON public.organizations, public.organization_memberships
  TO authenticated;
GRANT ALL ON public.organizations, public.organization_memberships,
  public.organization_resolution_keys TO service_role;

CREATE TABLE public.organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  legal_name text,
  public_name text NOT NULL,
  timezone text NOT NULL,
  locale text NOT NULL,
  currency_code text NOT NULL,
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_availability_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_contacts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  contact_type text NOT NULL,
  label text NOT NULL,
  destination text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_territories (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  country_code text NOT NULL,
  state_code text,
  county_name text,
  city_name text,
  postal_code text,
  effect text NOT NULL,
  priority integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_services (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  service_key text NOT NULL,
  availability text NOT NULL,
  reason text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service_key)
);

CREATE OR REPLACE FUNCTION public.is_organization_member(
  _organization_id uuid,
  _user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.is_organization_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid, uuid)
  TO authenticated, service_role;

INSERT INTO public.organizations (
  id, slug, display_name, status, is_legacy_default
) VALUES
  (
    'b1addf00-0000-4000-8000-000000000001',
    'bluladder-dfw',
    'BluLadder DFW',
    'active',
    true
  ),
  (
    'b1addf00-0000-4000-8000-000000000002',
    'bluladder-oregon-test',
    'BluLadder Oregon Test',
    'provisioning',
    false
  );

INSERT INTO public.organization_settings (
  organization_id, public_name, timezone, locale, currency_code
) VALUES
  (
    'b1addf00-0000-4000-8000-000000000001',
    'BluLadder DFW',
    'America/Chicago',
    'en-US',
    'USD'
  ),
  (
    'b1addf00-0000-4000-8000-000000000002',
    'BluLadder Oregon Test',
    'America/Los_Angeles',
    'en-US',
    'USD'
  );
SQL
}

install_fixture "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL"

dfw_before=$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT md5(row_to_json(o)::text) FROM public.organizations o WHERE id='b1addf00-0000-4000-8000-000000000001'")

psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X \
  --set=ON_ERROR_STOP=1 --file="$migration"
psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X \
  --set=ON_ERROR_STOP=1 --file="$verification"

test "$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organizations WHERE slug='bluladder-klamath' AND status='provisioning' AND NOT is_legacy_default")" = "1"
test "$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organization_customer_sites WHERE tenant_key='bluladder-klamath' AND mapping_status='provisioning' AND NOT runtime_routing_enabled AND NOT site_published AND NOT customer_traffic_allowed")" = "1"
test "$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organization_pricing_profiles WHERE status='draft' AND NOT runtime_enabled")" = "1"
test "$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organization_contacts WHERE organization_id='b1addf00-0000-4000-8000-000000000003'")" = "0"
test "$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organization_memberships WHERE organization_id='b1addf00-0000-4000-8000-000000000003'")" = "0"

dfw_after=$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 -c \
  "SELECT md5(row_to_json(o)::text) FROM public.organizations o WHERE id='b1addf00-0000-4000-8000-000000000001'")
test "$dfw_before" = "$dfw_after"

# A provisioning site cannot be opened piecemeal.
if psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X \
  --set=ON_ERROR_STOP=1 -c \
  "UPDATE public.organization_customer_sites SET customer_traffic_allowed = true WHERE tenant_key='bluladder-klamath'"; then
  echo "provisioning site unexpectedly accepted customer traffic" >&2
  exit 1
fi

# A draft profile cannot become runtime pricing.
if psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X \
  --set=ON_ERROR_STOP=1 -c \
  "UPDATE public.organization_pricing_profiles SET runtime_enabled = true WHERE profile_key='bluladder-klamath-pricing-draft'"; then
  echo "draft pricing unexpectedly became runtime-enabled" >&2
  exit 1
fi

# With no active Klamath membership, authenticated callers see no new rows.
visible=$(psql "$BLULADDER_KLAMATH_PHASE1C_DATABASE_URL" -X -At \
  --set=ON_ERROR_STOP=1 <<'SQL'
SET ROLE authenticated;
SELECT count(*) FROM public.organization_customer_sites;
SELECT count(*) FROM public.organization_pricing_profiles;
SQL
)
test "$(printf '%s\n' "$visible" | tail -2 | head -1)" = "0"
test "$(printf '%s\n' "$visible" | tail -1)" = "0"

# A pre-existing Klamath identity is a hard collision and leaves the new
# foundation absent. This proves the collision rollback boundary.
collision_db=bluladder_klamath_phase1c_collision
psql "$admin_url" -X --set=ON_ERROR_STOP=1 -c "CREATE DATABASE $collision_db"
collision_url="${BLULADDER_KLAMATH_PHASE1C_DATABASE_URL%/*}/$collision_db"
install_fixture "$collision_url"
psql "$collision_url" -X --set=ON_ERROR_STOP=1 -c \
  "INSERT INTO public.organizations(id,slug,display_name,status,is_legacy_default) VALUES ('90000000-0000-4000-8000-000000000003','bluladder-klamath','Conflicting Klamath','provisioning',false)"
if psql "$collision_url" -X --set=ON_ERROR_STOP=1 --file="$migration"; then
  echo "Klamath identity collision unexpectedly passed" >&2
  exit 1
fi
test "$(psql "$collision_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organization_customer_sites','organization_pricing_profiles')")" = "0"

# An injected failure immediately before commit rolls back every Phase 1C row
# and table in a fresh disposable database.
rollback_db=bluladder_klamath_phase1c_rollback
psql "$admin_url" -X --set=ON_ERROR_STOP=1 -c "CREATE DATABASE $rollback_db"
rollback_url="${BLULADDER_KLAMATH_PHASE1C_DATABASE_URL%/*}/$rollback_db"
install_fixture "$rollback_url"
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
  echo "injected Phase 1C failure unexpectedly committed" >&2
  exit 1
fi
test "$(psql "$rollback_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM public.organizations WHERE slug='bluladder-klamath'")" = "0"
test "$(psql "$rollback_url" -X -At --set=ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organization_customer_sites','organization_pricing_profiles')")" = "0"

echo "BluLadder Klamath Phase 1C PostgreSQL rehearsal passed: exact inactive seed, DFW preservation, RLS denial, activation constraints, collision rollback, and atomic failure rollback."
