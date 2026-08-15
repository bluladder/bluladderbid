-- BluLadder Klamath split public call and text contact channels.
--
-- The original public-contact authority represented one generic phone action.
-- Owner approval requires separate destinations for customer calls and texts.
-- This forward-only migration adds an explicit `sms` channel without creating
-- a contact row, publishing a site, enabling traffic, or changing tenant RLS.

BEGIN;

LOCK TABLE public.organization_public_contacts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.organizations, public.organization_customer_sites IN SHARE MODE;

DO $split_public_contact_preflight$
DECLARE
  channel_definition text;
  destination_definition text;
BEGIN
  IF to_regclass('public.organization_public_contacts') IS NULL THEN
    RAISE EXCEPTION 'Split public contact requires organization_public_contacts';
  END IF;

  IF (SELECT count(*) FROM public.organization_public_contacts) <> 0 THEN
    RAISE EXCEPTION
      'Split public contact requires the reviewed empty public-contact table';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO channel_definition
  FROM pg_constraint
  WHERE conrelid = 'public.organization_public_contacts'::regclass
    AND conname = 'organization_public_contacts_channel_check'
    AND contype = 'c'
    AND convalidated = true;

  SELECT pg_get_constraintdef(oid)
  INTO destination_definition
  FROM pg_constraint
  WHERE conrelid = 'public.organization_public_contacts'::regclass
    AND conname = 'organization_public_contacts_destination_check'
    AND contype = 'c'
    AND convalidated = true;

  IF channel_definition IS NULL
    OR position('phone' IN channel_definition) = 0
    OR position('email' IN channel_definition) = 0
    OR position('sms' IN channel_definition) > 0 THEN
    RAISE EXCEPTION 'Unexpected public-contact channel constraint';
  END IF;

  IF destination_definition IS NULL
    OR position('phone' IN destination_definition) = 0
    OR position('email' IN destination_definition) = 0
    OR position('sms' IN destination_definition) > 0 THEN
    RAISE EXCEPTION 'Unexpected public-contact destination constraint';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true) <> 1
    OR (SELECT count(*) FROM public.organizations
        WHERE is_legacy_default = true
          AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid) <> 0 THEN
    RAISE EXCEPTION 'Split public contact DFW authority mismatch';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
        WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
          AND tenant_key = 'bluladder-klamath'
          AND canonical_hostname = 'klamath.bluladder.com'
          AND mapping_status = 'provisioning'
          AND runtime_routing_enabled = false
          AND site_published = false
          AND customer_traffic_allowed = false) <> 1 THEN
    RAISE EXCEPTION 'Split public contact Klamath inactive boundary mismatch';
  END IF;
END
$split_public_contact_preflight$;

ALTER TABLE public.organization_public_contacts
  DROP CONSTRAINT organization_public_contacts_channel_check,
  DROP CONSTRAINT organization_public_contacts_destination_check;

ALTER TABLE public.organization_public_contacts
  ADD CONSTRAINT organization_public_contacts_channel_check CHECK (
    channel IN ('phone', 'sms', 'email')
  ),
  ADD CONSTRAINT organization_public_contacts_destination_check CHECK (
    destination = btrim(destination)
    AND (
      (
        channel IN ('phone', 'sms')
        AND destination ~ '^\+[1-9][0-9]{7,14}$'
      )
      OR (
        channel = 'email'
        AND destination = lower(destination)
        AND length(destination) <= 254
        AND destination ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    )
  );

COMMIT;