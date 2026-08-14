-- BluLadder Klamath Phase 1I: dormant CRM connector and idempotency lineage.
--
-- This additive migration creates no connector, credential, webhook, provider
-- event, operation attempt, customer record, or activation state. It stores
-- only opaque secret references and SHA-256 fingerprints; raw provider IDs,
-- secrets, request bodies, response bodies, and customer payloads are outside
-- this schema.

BEGIN;

LOCK TABLE
  public.organizations,
  public.organization_memberships,
  public.organization_resolution_keys,
  public.customers,
  public.chat_conversations,
  public.bookings
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(required_table ORDER BY required_table)
  INTO missing
  FROM unnest(ARRAY[
    'organizations',
    'organization_memberships',
    'organization_resolution_keys',
    'customers',
    'chat_conversations',
    'bookings'
  ]) AS required_tables(required_table)
  WHERE to_regclass('public.' || required_table) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1I prerequisite tables missing: %', missing;
  END IF;

  IF to_regclass('public.organization_crm_connectors') IS NOT NULL
    OR to_regclass('public.organization_connector_operation_attempts')
      IS NOT NULL
    OR to_regclass('public.organization_connector_webhook_receipts')
      IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1I target tables already exist';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true) <> 1
    OR (SELECT count(*) FROM public.organizations
        WHERE is_legacy_default = true
          AND id <> 'b1addf00-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'Phase 1I DFW authority mismatch';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000003'
        AND slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false) <> 1 THEN
    RAISE EXCEPTION 'Phase 1I requires one provisioning Klamath organization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
    UNION ALL
    SELECT 1 FROM public.chat_conversations
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
    UNION ALL
    SELECT 1 FROM public.bookings
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'Phase 1I requires zero Klamath customer traffic';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_resolution_keys resolution_key
    WHERE resolution_key.organization_id =
      'b1addf00-0000-4000-8000-000000000003'
      AND resolution_key.key_type IN (
        'jobber_account', 'jobtread_account', 'google_calendar',
        'callrail_number', 'twilio_number', 'vapi_assistant',
        'vapi_phone_number'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 1I requires zero Klamath provider identities';
  END IF;
END
$$;

CREATE TABLE public.organization_crm_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  provider text NOT NULL CHECK (
    provider IN ('jobber', 'jobtread', 'google_calendar', 'manual')
  ),
  status text NOT NULL DEFAULT 'inactive' CHECK (
    status IN ('active', 'inactive', 'degraded')
  ),
  priority integer NOT NULL DEFAULT 0 CHECK (
    priority BETWEEN -1000 AND 1000
  ),
  capabilities text[] NOT NULL DEFAULT '{}'::text[] CHECK (
    capabilities <@ ARRAY[
      'customer_sync', 'quote_sync', 'availability_read',
      'booking_create', 'booking_update', 'booking_cancel',
      'invoice_handoff', 'communications_handoff', 'health'
    ]::text[]
  ),
  credential_reference text,
  webhook_secret_reference text,
  provider_organization_fingerprint text,
  configuration_version integer NOT NULL DEFAULT 1 CHECK (
    configuration_version > 0
  ),
  runtime_enabled boolean NOT NULL DEFAULT false,
  webhook_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_crm_connectors_credential_reference_check CHECK (
    credential_reference IS NULL OR btrim(credential_reference) <> ''
  ),
  CONSTRAINT organization_crm_connectors_webhook_reference_check CHECK (
    webhook_secret_reference IS NULL OR btrim(webhook_secret_reference) <> ''
  ),
  CONSTRAINT organization_crm_connectors_provider_fingerprint_check CHECK (
    provider_organization_fingerprint IS NULL
    OR provider_organization_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT organization_crm_connectors_runtime_gate_check CHECK (
    NOT runtime_enabled OR (
      status = 'active'
      AND cardinality(capabilities) > 0
      AND (
        provider = 'manual'
        OR (
          credential_reference IS NOT NULL
          AND provider_organization_fingerprint IS NOT NULL
        )
      )
    )
  ),
  CONSTRAINT organization_crm_connectors_webhook_gate_check CHECK (
    NOT webhook_enabled OR (
      runtime_enabled
      AND provider <> 'manual'
      AND webhook_secret_reference IS NOT NULL
    )
  ),
  CONSTRAINT organization_crm_connectors_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT organization_crm_connectors_organization_provider_key
    UNIQUE (organization_id, provider)
);

CREATE INDEX organization_crm_connectors_selection_idx
  ON public.organization_crm_connectors (
    organization_id, status, priority DESC
  )
  WHERE runtime_enabled;

CREATE TABLE public.organization_connector_operation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  connector_id uuid NOT NULL,
  operation text NOT NULL CHECK (
    operation IN (
      'customer_sync', 'quote_sync', 'availability_read',
      'booking_create', 'booking_update', 'booking_cancel',
      'invoice_handoff', 'communications_handoff', 'health'
    )
  ),
  idempotency_key_hash text NOT NULL CHECK (
    idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  request_fingerprint text NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  attempt_number smallint NOT NULL DEFAULT 1 CHECK (
    attempt_number BETWEEN 1 AND 10
  ),
  status text NOT NULL DEFAULT 'started' CHECK (
    status IN ('started', 'succeeded', 'manual_review')
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'connector_missing', 'connector_ambiguous', 'connector_inactive',
      'capability_unsupported', 'credential_reference_missing',
      'organization_lineage_mismatch', 'idempotency_key_missing',
      'provider_unavailable', 'provider_rejected', 'retry_exhausted'
    )
  ),
  outcome_uncertain boolean NOT NULL DEFAULT false,
  provider_reference_hash text CHECK (
    provider_reference_hash IS NULL
    OR provider_reference_hash ~ '^[0-9a-f]{64}$'
  ),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT organization_connector_operation_attempts_connector_fkey
    FOREIGN KEY (organization_id, connector_id)
    REFERENCES public.organization_crm_connectors (organization_id, id),
  CONSTRAINT organization_connector_operation_attempts_status_check CHECK (
    (status = 'started' AND completed_at IS NULL AND failure_code IS NULL)
    OR (
      status = 'succeeded'
      AND completed_at IS NOT NULL
      AND failure_code IS NULL
      AND outcome_uncertain = false
    )
    OR (
      status = 'manual_review'
      AND completed_at IS NOT NULL
      AND failure_code IS NOT NULL
    )
  ),
  CONSTRAINT organization_connector_operation_attempts_uncertain_check CHECK (
    NOT outcome_uncertain
    OR (
      status = 'manual_review'
      AND failure_code IN ('provider_unavailable', 'retry_exhausted')
    )
  ),
  CONSTRAINT organization_connector_operation_attempts_idempotency_key
    UNIQUE (
      connector_id, operation, idempotency_key_hash, attempt_number
    )
);

CREATE INDEX organization_connector_operation_attempts_org_status_idx
  ON public.organization_connector_operation_attempts (
    organization_id, status, started_at DESC
  );
CREATE INDEX organization_connector_operation_attempts_connector_idx
  ON public.organization_connector_operation_attempts (connector_id);

CREATE TABLE public.organization_connector_webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  connector_id uuid NOT NULL,
  provider_event_hash text NOT NULL CHECK (
    provider_event_hash ~ '^[0-9a-f]{64}$'
  ),
  event_type text NOT NULL CHECK (
    btrim(event_type) <> '' AND length(event_type) <= 128
  ),
  payload_fingerprint text NOT NULL CHECK (
    payload_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  source_authenticated boolean NOT NULL CHECK (source_authenticated),
  status text NOT NULL DEFAULT 'accepted' CHECK (
    status IN ('accepted', 'processed', 'ignored', 'manual_review')
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'organization_lineage_mismatch', 'provider_unavailable',
      'provider_rejected', 'capability_unsupported'
    )
  ),
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT organization_connector_webhook_receipts_connector_fkey
    FOREIGN KEY (organization_id, connector_id)
    REFERENCES public.organization_crm_connectors (organization_id, id),
  CONSTRAINT organization_connector_webhook_receipts_status_check CHECK (
    (status = 'accepted' AND processed_at IS NULL AND failure_code IS NULL)
    OR (
      status IN ('processed', 'ignored')
      AND processed_at IS NOT NULL
      AND failure_code IS NULL
    )
    OR (
      status = 'manual_review'
      AND processed_at IS NOT NULL
      AND failure_code IS NOT NULL
    )
  ),
  CONSTRAINT organization_connector_webhook_receipts_idempotency_key
    UNIQUE (connector_id, provider_event_hash)
);

CREATE INDEX organization_connector_webhook_receipts_org_status_idx
  ON public.organization_connector_webhook_receipts (
    organization_id, status, received_at DESC
  );
CREATE INDEX organization_connector_webhook_receipts_connector_idx
  ON public.organization_connector_webhook_receipts (connector_id);

ALTER TABLE public.organization_crm_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_connector_operation_attempts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_connector_webhook_receipts
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.organization_crm_connectors,
  public.organization_connector_operation_attempts,
  public.organization_connector_webhook_receipts
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_crm_connectors TO authenticated;
GRANT SELECT
  ON TABLE public.organization_connector_operation_attempts,
  public.organization_connector_webhook_receipts
  TO authenticated;
GRANT ALL ON TABLE
  public.organization_crm_connectors,
  public.organization_connector_operation_attempts,
  public.organization_connector_webhook_receipts
  TO service_role;

CREATE POLICY "Tenant operators view CRM connectors"
  ON public.organization_crm_connectors FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_crm_connectors.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  );

CREATE POLICY "Tenant operators manage CRM connectors"
  ON public.organization_crm_connectors FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_crm_connectors.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_crm_connectors.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  );

CREATE POLICY "Tenant operators view CRM operation attempts"
  ON public.organization_connector_operation_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_connector_operation_attempts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  );

CREATE POLICY "Tenant operators view CRM webhook receipts"
  ON public.organization_connector_webhook_receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_connector_webhook_receipts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  );

COMMIT;
