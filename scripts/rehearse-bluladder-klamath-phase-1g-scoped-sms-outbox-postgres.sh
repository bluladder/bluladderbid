#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1G_SCOPED_OUTBOX_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1G_SCOPED_OUTBOX_DATABASE_URL}"

export BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL="${BLULADDER_KLAMATH_PHASE1G_SCOPED_OUTBOX_DATABASE_URL}"
bash scripts/rehearse-bluladder-klamath-phase-1g-authenticated-grants-postgres.sh

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1G_SCOPED_OUTBOX_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

psql "${psql_args[@]}" --file supabase/preflight/bluladder_klamath_phase_1g_scoped_sms_outbox.sql

psql "${psql_args[@]}" --file supabase/migrations/20260814074000_bluladder_klamath_phase_1g_scoped_sms_outbox.sql

psql "${psql_args[@]}" --file supabase/verification/bluladder_klamath_phase_1g_scoped_sms_outbox.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
DECLARE
  dfw_connector_id uuid;
  second_connector_id uuid;
  klamath_connector_id uuid;
  first_claim jsonb;
  replay_claim jsonb;
  conflict_claim jsonb;
  inactive_claim jsonb;
BEGIN
  INSERT INTO public.organization_messaging_connectors (
    organization_id, channel, provider, status, priority,
    credential_reference, sender_identity_reference
  ) VALUES (
    'b1addf00-0000-4000-8000-000000000001'::uuid,
    'sms', 'callrail', 'active', 100,
    'reviewed-dfw-credential', 'reviewed-dfw-sender'
  ) RETURNING id INTO dfw_connector_id;

  first_claim := public.claim_organization_sms_outbox_send(
    'b1addf00-0000-4000-8000-000000000001'::uuid,
    dfw_connector_id,
    'phase1g:scoped-outbox:one',
    gen_random_uuid(),
    '+15555550100',
    'rehearsal',
    'transactional',
    NULL,
    120
  );
  IF first_claim->>'ok' <> 'true'
     OR first_claim->>'may_dispatch' <> 'true'
     OR first_claim->>'is_new' <> 'true' THEN
    RAISE EXCEPTION 'scoped outbox did not create one dispatchable claim';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sms_messages
    WHERE id = (first_claim->>'id')::uuid
      AND organization_id =
        'b1addf00-0000-4000-8000-000000000001'::uuid
      AND messaging_connector_id = dfw_connector_id
      AND channel = 'sms'
  ) THEN
    RAISE EXCEPTION 'scoped outbox omitted durable authority';
  END IF;

  replay_claim := public.claim_organization_sms_outbox_send(
    'b1addf00-0000-4000-8000-000000000001'::uuid,
    dfw_connector_id,
    'phase1g:scoped-outbox:one',
    gen_random_uuid(),
    '+15555550100',
    'rehearsal',
    'transactional',
    NULL,
    120
  );
  IF replay_claim->>'ok' <> 'true'
     OR replay_claim->>'in_progress' <> 'true'
     OR replay_claim->>'may_dispatch' <> 'false' THEN
    RAISE EXCEPTION 'scoped outbox idempotent in-progress state failed';
  END IF;

  INSERT INTO public.organization_messaging_connectors (
    organization_id, channel, provider, status, priority,
    credential_reference, sender_identity_reference
  ) VALUES (
    'b1addf00-0000-4000-8000-000000000001'::uuid,
    'sms', 'callrail', 'active', 90,
    'reviewed-dfw-credential-2', 'reviewed-dfw-sender-2'
  ) RETURNING id INTO second_connector_id;
  conflict_claim := public.claim_organization_sms_outbox_send(
    'b1addf00-0000-4000-8000-000000000001'::uuid,
    second_connector_id,
    'phase1g:scoped-outbox:one',
    gen_random_uuid(),
    '+15555550100',
    'rehearsal',
    'transactional',
    NULL,
    120
  );
  IF conflict_claim->>'ok' <> 'false'
     OR conflict_claim->>'reason' <> 'organization_lineage_mismatch' THEN
    RAISE EXCEPTION 'cross-connector replay did not fail closed';
  END IF;

  INSERT INTO public.organization_messaging_connectors (
    organization_id, channel, provider, status, priority,
    credential_reference, sender_identity_reference
  )
  SELECT id, 'sms', 'twilio', 'active', 100,
    'reviewed-klamath-credential', 'reviewed-klamath-sender'
  FROM public.organizations
  WHERE slug = 'bluladder-klamath'
  RETURNING id INTO klamath_connector_id;
  inactive_claim := public.claim_organization_sms_outbox_send(
    (SELECT id FROM public.organizations WHERE slug = 'bluladder-klamath'),
    klamath_connector_id,
    'phase1g:scoped-outbox:inactive',
    gen_random_uuid(),
    '+15555550101',
    'rehearsal',
    'transactional',
    NULL,
    120
  );
  IF inactive_claim->>'ok' <> 'false'
     OR inactive_claim->>'reason' <> 'organization_inactive' THEN
    RAISE EXCEPTION 'inactive organization was allowed to claim dispatch';
  END IF;
  IF (SELECT count(*) FROM public.sms_messages) <> 135 THEN
    RAISE EXCEPTION 'scoped outbox rehearsal created an unexpected message';
  END IF;
END
$$;
SQL

echo "BluLadder Klamath Phase 1G scoped SMS outbox rehearsal passed."
