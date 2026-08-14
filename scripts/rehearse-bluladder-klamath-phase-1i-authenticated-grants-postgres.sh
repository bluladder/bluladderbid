#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1I_GRANTS_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1I_GRANTS_DATABASE_URL}"

export BLULADDER_KLAMATH_PHASE1I_DATABASE_URL="${BLULADDER_KLAMATH_PHASE1I_GRANTS_DATABASE_URL}"
bash scripts/rehearse-bluladder-klamath-phase-1i-crm-connector-postgres.sh

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1I_GRANTS_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

# Reproduce the exact Lovable-hosted privilege hydration observed after the
# canonical Phase 1I migration. No row or policy is changed.
psql "${psql_args[@]}" <<'SQL'
GRANT ALL PRIVILEGES
  ON TABLE public.organization_crm_connectors,
           public.organization_connector_operation_attempts,
           public.organization_connector_webhook_receipts
  TO authenticated;
SQL

psql "${psql_args[@]}" --file \
  supabase/preflight/bluladder_klamath_phase_1i_authenticated_grants.sql

psql "${psql_args[@]}" --file \
  supabase/migrations/20260814114500_bluladder_klamath_phase_1i_authenticated_grants.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
DECLARE
  current_privileges text[];
BEGIN
  SELECT coalesce(
    array_agg(privilege_type::text ORDER BY privilege_type::text),
    ARRAY[]::text[]
  ) INTO current_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'organization_crm_connectors'
    AND grantee = 'authenticated';
  IF current_privileges <> ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'] THEN
    RAISE EXCEPTION 'authenticated connector grants were not repaired';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (
        'organization_connector_operation_attempts',
        'organization_connector_webhook_receipts'
      )
      AND grantee = 'authenticated'
      AND privilege_type <> 'SELECT'
  ) OR (
    SELECT count(*)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (
        'organization_connector_operation_attempts',
        'organization_connector_webhook_receipts'
      )
      AND grantee = 'authenticated'
      AND privilege_type = 'SELECT'
  ) <> 2 THEN
    RAISE EXCEPTION 'authenticated audit grants were not narrowed to SELECT';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_crm_connectors)
    OR EXISTS (SELECT 1 FROM public.organization_connector_operation_attempts)
    OR EXISTS (SELECT 1 FROM public.organization_connector_webhook_receipts) THEN
    RAISE EXCEPTION 'grant repair changed rehearsal data';
  END IF;
END
$$;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_phase_1i_authenticated_grants.sql

echo "BluLadder Klamath Phase 1I authenticated-grant repair rehearsal passed."
