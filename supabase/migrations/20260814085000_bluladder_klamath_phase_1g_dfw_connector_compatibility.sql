-- BluLadder Klamath Phase 1G DFW messaging-connector compatibility.
--
-- This wave records the already-live DFW CallRail boundary as one exact
-- organization-owned connector before the tenant-aware outbox runtime can be
-- deployed. It creates no Klamath connector, provider resource, credential,
-- sender, customer traffic, or message.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  public.organizations,
  public.organization_messaging_connectors,
  public.sms_messages
IN SHARE ROW EXCLUSIVE MODE;

DO $phase1g_dfw_preflight$
DECLARE
  dfw_count integer;
  unexpected_default_count integer;
  connector_count integer;
  wrong_sms_organization_count integer;
  connector_bound_count integer;
  klamath_provisioning_count integer;
  klamath_active_count integer;
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_messaging_connectors') IS NULL
     OR to_regclass('public.sms_messages') IS NULL THEN
    RAISE EXCEPTION 'Phase 1G DFW connector prerequisite table missing';
  END IF;
  IF to_regprocedure(
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 1G scoped SMS outbox prerequisite missing';
  END IF;

  SELECT count(*) INTO dfw_count
  FROM public.organizations
  WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
    AND slug = 'bluladder-dfw'
    AND status = 'active'
    AND is_legacy_default = true;
  SELECT count(*) INTO unexpected_default_count
  FROM public.organizations
  WHERE is_legacy_default = true
    AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid;
  IF dfw_count <> 1 OR unexpected_default_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G DFW organization authority mismatch';
  END IF;

  SELECT count(*) INTO connector_count
  FROM public.organization_messaging_connectors;
  IF connector_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G messaging connector state is not empty';
  END IF;

  SELECT count(*) INTO wrong_sms_organization_count
  FROM public.sms_messages
  WHERE organization_id IS DISTINCT FROM
    'b1addf00-0000-4000-8000-000000000001'::uuid;
  SELECT count(*) INTO connector_bound_count
  FROM public.sms_messages
  WHERE messaging_connector_id IS NOT NULL;
  IF wrong_sms_organization_count <> 0 OR connector_bound_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G historical SMS connector baseline mismatch';
  END IF;

  SELECT count(*) INTO klamath_provisioning_count
  FROM public.organizations
  WHERE slug = 'bluladder-klamath'
    AND status = 'provisioning'
    AND is_legacy_default = false;
  SELECT count(*) INTO klamath_active_count
  FROM public.organizations
  WHERE slug = 'bluladder-klamath'
    AND status = 'active';
  IF klamath_provisioning_count <> 1 OR klamath_active_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G Klamath inactive boundary mismatch';
  END IF;
END
$phase1g_dfw_preflight$;

INSERT INTO public.organization_messaging_connectors (
  id,
  organization_id,
  channel,
  provider,
  status,
  priority,
  credential_reference,
  sender_identity_reference
) VALUES (
  'b1addf10-0000-4000-8000-000000000001'::uuid,
  'b1addf00-0000-4000-8000-000000000001'::uuid,
  'sms',
  'callrail',
  'active',
  100,
  'bluladder-dfw-callrail-production-v1',
  'bluladder-dfw-callrail-sender-v1'
);

UPDATE public.sms_messages
SET messaging_connector_id =
  'b1addf10-0000-4000-8000-000000000001'::uuid
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
  AND messaging_connector_id IS NULL;

DO $phase1g_dfw_postflight$
DECLARE
  exact_connector_count integer;
  unexpected_connector_count integer;
  unbound_sms_count integer;
  wrong_sms_connector_count integer;
  klamath_connector_count integer;
  klamath_active_count integer;
BEGIN
  SELECT count(*) INTO exact_connector_count
  FROM public.organization_messaging_connectors
  WHERE id = 'b1addf10-0000-4000-8000-000000000001'::uuid
    AND organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
    AND channel = 'sms'
    AND provider = 'callrail'
    AND status = 'active'
    AND priority = 100
    AND credential_reference = 'bluladder-dfw-callrail-production-v1'
    AND sender_identity_reference = 'bluladder-dfw-callrail-sender-v1';
  SELECT count(*) INTO unexpected_connector_count
  FROM public.organization_messaging_connectors
  WHERE id <> 'b1addf10-0000-4000-8000-000000000001'::uuid;
  IF exact_connector_count <> 1 OR unexpected_connector_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G exact DFW connector postflight failed';
  END IF;

  SELECT count(*) INTO unbound_sms_count
  FROM public.sms_messages
  WHERE messaging_connector_id IS NULL;
  SELECT count(*) INTO wrong_sms_connector_count
  FROM public.sms_messages
  WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'::uuid
     OR messaging_connector_id <>
       'b1addf10-0000-4000-8000-000000000001'::uuid;
  IF unbound_sms_count <> 0 OR wrong_sms_connector_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G DFW historical connector lineage failed';
  END IF;

  SELECT count(*) INTO klamath_connector_count
  FROM public.organization_messaging_connectors connector
  JOIN public.organizations organization
    ON organization.id = connector.organization_id
  WHERE organization.slug = 'bluladder-klamath';
  SELECT count(*) INTO klamath_active_count
  FROM public.organizations
  WHERE slug = 'bluladder-klamath'
    AND status = 'active';
  IF klamath_connector_count <> 0 OR klamath_active_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G migration activated Klamath messaging';
  END IF;
END
$phase1g_dfw_postflight$;

COMMIT;
