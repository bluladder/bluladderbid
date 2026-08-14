#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1G_DFW_CONNECTOR_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1G_DFW_CONNECTOR_DATABASE_URL}"

export BLULADDER_KLAMATH_PHASE1G_SCOPED_OUTBOX_DATABASE_URL="${BLULADDER_KLAMATH_PHASE1G_DFW_CONNECTOR_DATABASE_URL}"
bash scripts/rehearse-bluladder-klamath-phase-1g-scoped-sms-outbox-postgres.sh

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1G_DFW_CONNECTOR_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

# The scoped-outbox rehearsal creates temporary connector fixtures after its
# own migration verification. Remove only those disposable fixtures before
# exercising the exact zero-connector compatibility baseline.
psql "${psql_args[@]}" <<'SQL'
DELETE FROM public.sms_messages
WHERE outbound_idempotency_key = 'phase1g:scoped-outbox:one';
DELETE FROM public.organization_messaging_connectors;
SQL

psql "${psql_args[@]}" \
  --file supabase/preflight/bluladder_klamath_phase_1g_dfw_connector_compatibility.sql

psql "${psql_args[@]}" \
  --file supabase/migrations/20260814085000_bluladder_klamath_phase_1g_dfw_connector_compatibility.sql

psql "${psql_args[@]}" \
  --file supabase/verification/bluladder_klamath_phase_1g_dfw_connector_compatibility.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_messaging_connectors) <> 1 THEN
    RAISE EXCEPTION 'DFW connector rehearsal produced an unexpected connector count';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organization_messaging_connectors
    WHERE credential_reference <> 'bluladder-dfw-callrail-production-v1'
       OR sender_identity_reference <> 'bluladder-dfw-callrail-sender-v1'
  ) THEN
    RAISE EXCEPTION 'DFW connector rehearsal changed the reviewed references';
  END IF;
  IF (SELECT count(*) FROM public.sms_messages) <> 134
     OR EXISTS (
       SELECT 1 FROM public.sms_messages
       WHERE messaging_connector_id IS NULL
     ) THEN
    RAISE EXCEPTION 'DFW connector rehearsal left historical lineage incomplete';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organization_messaging_connectors connector
    JOIN public.organizations organization
      ON organization.id = connector.organization_id
    WHERE organization.slug = 'bluladder-klamath'
  ) THEN
    RAISE EXCEPTION 'DFW connector rehearsal created a Klamath connector';
  END IF;
END
$$;
SQL

echo "BluLadder Klamath Phase 1G DFW connector compatibility rehearsal passed."
