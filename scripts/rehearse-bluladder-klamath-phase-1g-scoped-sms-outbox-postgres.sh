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

# The additive-lineage rehearsal intentionally models only the columns needed
# by that migration. Extend its disposable sms_messages fixture to the exact
# outbox surface used by the scoped claim before applying this later wave.
psql "${psql_args[@]}" <<'SQL'
DO $$ BEGIN
  CREATE TYPE public.sms_status AS ENUM (
    'pending', 'sent', 'failed', 'cancelled', 'processing', 'accepted', 'inbound'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.sms_messages
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.sms_status USING status::public.sms_status,
  ALTER COLUMN status SET DEFAULT 'pending'::public.sms_status,
  ADD COLUMN to_number text,
  ADD COLUMN body text,
  ADD COLUMN message_kind text NOT NULL DEFAULT 'transactional',
  ADD COLUMN outbound_idempotency_key text,
  ADD COLUMN outbox_state text,
  ADD COLUMN send_claim_token uuid,
  ADD COLUMN send_claim_at timestamptz,
  ADD COLUMN provider_message_id text,
  ADD COLUMN provider_conversation_id text,
  ADD COLUMN provider_status text,
  ADD COLUMN provider_response_kind text,
  ADD COLUMN provider_accepted_at timestamptz,
  ADD COLUMN provider_dispatched_at timestamptz,
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN send_error_code text,
  ADD COLUMN send_error_at timestamptz,
  ADD COLUMN error text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX uq_sms_messages_outbound_idempotency_key
  ON public.sms_messages(outbound_idempotency_key)
  WHERE outbound_idempotency_key IS NOT NULL;
SQL

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
