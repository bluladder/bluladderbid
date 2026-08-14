#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL}"

export BLULADDER_KLAMATH_PHASE1G_DATABASE_URL="${BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL}"
bash scripts/rehearse-bluladder-klamath-phase-1g-additive-messaging-postgres.sh

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

# Reproduce the exact Lovable-hosted grant hydration observed after the
# canonical Phase 1G table creation. No row or policy is changed.
psql "${psql_args[@]}" <<'SQL'
INSERT INTO public.sms_messages (organization_id)
SELECT 'b1addf00-0000-4000-8000-000000000001'::uuid
FROM generate_series(1, 132);

GRANT REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.organization_messaging_connectors
  TO authenticated;
SQL

psql "${psql_args[@]}" --file \
  supabase/preflight/bluladder_klamath_phase_1g_authenticated_grants.sql

psql "${psql_args[@]}" --file \
  supabase/migrations/20260814071600_bluladder_klamath_phase_1g_authenticated_grants.sql

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
    AND table_name = 'organization_messaging_connectors'
    AND grantee = 'authenticated';
  IF current_privileges <> ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'] THEN
    RAISE EXCEPTION 'authenticated connector grants were not repaired';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_messaging_connectors
  ) OR (SELECT count(*) FROM public.sms_messages) <> 134 OR EXISTS (
    SELECT 1 FROM public.sms_messages
    WHERE organization_id IS NULL
       OR organization_id <>
         'b1addf00-0000-4000-8000-000000000001'::uuid
       OR messaging_connector_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'grant repair changed rehearsal data';
  END IF;
END
$$;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_phase_1g_authenticated_grants.sql

echo "BluLadder Klamath Phase 1G authenticated-grant repair rehearsal passed."
