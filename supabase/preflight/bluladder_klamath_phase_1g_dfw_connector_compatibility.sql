BEGIN TRANSACTION READ ONLY;

SELECT
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
      AND slug = 'bluladder-dfw'
      AND status = 'active'
      AND is_legacy_default = true) AS exact_dfw_count,
  (SELECT count(*) FROM public.organizations
    WHERE is_legacy_default = true
      AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid)
    AS unexpected_legacy_default_count,
  (SELECT count(*) FROM public.organization_messaging_connectors)
    AS connector_count,
  (SELECT count(*) FROM public.sms_messages) AS sms_message_count,
  (SELECT count(*) FROM public.sms_messages
    WHERE organization_id IS DISTINCT FROM
      'b1addf00-0000-4000-8000-000000000001'::uuid)
    AS wrong_sms_organization_count,
  (SELECT count(*) FROM public.sms_messages
    WHERE messaging_connector_id IS NOT NULL) AS connector_bound_count,
  (SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath'
      AND status = 'provisioning'
      AND is_legacy_default = false) AS klamath_provisioning_count,
  (SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath' AND status = 'active')
    AS klamath_active_count,
  (SELECT count(*) FROM public.organization_resolution_keys key
    JOIN public.organizations organization ON organization.id = key.organization_id
    WHERE organization.slug = 'bluladder-klamath'
      AND key.key_type IN (
        'jobber_account', 'callrail_number', 'email_address',
        'vapi_assistant', 'vapi_phone_number'
      )) AS klamath_provider_identity_count;

ROLLBACK;
