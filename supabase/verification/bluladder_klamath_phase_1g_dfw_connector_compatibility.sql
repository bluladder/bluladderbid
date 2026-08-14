BEGIN TRANSACTION READ ONLY;

SELECT
  (SELECT count(*) FROM public.organization_messaging_connectors
    WHERE id = 'b1addf10-0000-4000-8000-000000000001'::uuid
      AND organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
      AND channel = 'sms'
      AND provider = 'callrail'
      AND status = 'active'
      AND priority = 100
      AND credential_reference = 'bluladder-dfw-callrail-production-v1'
      AND sender_identity_reference = 'bluladder-dfw-callrail-sender-v1')
    AS exact_dfw_connector_count,
  (SELECT count(*) FROM public.organization_messaging_connectors
    WHERE id <> 'b1addf10-0000-4000-8000-000000000001'::uuid)
    AS unexpected_connector_count,
  (SELECT count(*) FROM public.sms_messages) AS sms_message_count,
  (SELECT count(*) FROM public.sms_messages
    WHERE channel = 'sms'
      AND messaging_connector_id IS NULL) AS unbound_sms_count,
  (SELECT count(*) FROM public.sms_messages
    WHERE channel = 'sms'
      AND (
        organization_id IS DISTINCT FROM
          'b1addf00-0000-4000-8000-000000000001'::uuid
        OR messaging_connector_id IS DISTINCT FROM
          'b1addf10-0000-4000-8000-000000000001'::uuid
      ))
    AS wrong_sms_connector_count,
  (SELECT count(*) FROM public.sms_messages
    WHERE channel IS DISTINCT FROM 'sms'
      AND messaging_connector_id IS NOT NULL) AS non_sms_bound_count,
  (SELECT count(*) FROM public.organization_messaging_connectors connector
    JOIN public.organizations organization
      ON organization.id = connector.organization_id
    WHERE organization.slug = 'bluladder-klamath') AS klamath_connector_count,
  (SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath'
      AND status = 'provisioning'
      AND is_legacy_default = false) AS klamath_provisioning_count,
  (SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath' AND status = 'active')
    AS klamath_active_count;

ROLLBACK;
