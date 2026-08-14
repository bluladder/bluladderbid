BEGIN TRANSACTION READ ONLY;

SELECT jsonb_build_object(
  'scoped_claim_count', (
    SELECT (
      to_regprocedure(
        'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)'
      ) IS NOT NULL
    )::int
  ),
  'anon_execute', has_function_privilege(
    'anon',
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated_execute', has_function_privilege(
    'authenticated',
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'service_role_execute', has_function_privilege(
    'service_role',
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)',
    'EXECUTE'
  ),
  'connector_count', (
    SELECT count(*) FROM public.organization_messaging_connectors
  ),
  'sms_message_count', (SELECT count(*) FROM public.sms_messages),
  'missing_organization_count', (
    SELECT count(*) FROM public.sms_messages WHERE organization_id IS NULL
  ),
  'non_dfw_count', (
    SELECT count(*) FROM public.sms_messages
    WHERE organization_id <>
      'b1addf00-0000-4000-8000-000000000001'::uuid
  ),
  'connector_bound_count', (
    SELECT count(*) FROM public.sms_messages
    WHERE messaging_connector_id IS NOT NULL
  ),
  'klamath_provisioning_count', (
    SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath'
      AND status = 'provisioning'
      AND is_legacy_default = false
  ),
  'klamath_active_count', (
    SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath' AND status = 'active'
  )
) AS phase_1g_scoped_outbox_postflight;

ROLLBACK;
