-- BluLadder Klamath public contact publication authority.
--
-- This additive migration creates no contact value, organization, membership,
-- site, provider resource, credential, customer row, or activation state. A
-- separate table prevents existing internal escalation/notification contacts
-- from becoming public by inference.

BEGIN;

LOCK TABLE
  public.organizations,
  public.organization_memberships,
  public.organization_customer_sites,
  public.organization_contacts
IN SHARE ROW EXCLUSIVE MODE;

DO $public_contact_preflight$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(required_table ORDER BY required_table)
  INTO missing
  FROM unnest(ARRAY[
    'organizations',
    'organization_memberships',
    'organization_customer_sites',
    'organization_contacts'
  ]) AS required_tables(required_table)
  WHERE to_regclass('public.' || required_table) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Public contact prerequisite tables missing: %', missing;
  END IF;

  IF to_regclass('public.organization_public_contacts') IS NOT NULL THEN
    RAISE EXCEPTION 'Public contact target table already exists';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true) <> 1
    OR (SELECT count(*) FROM public.organizations
        WHERE is_legacy_default = true
          AND id <> 'b1addf00-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'Public contact DFW authority mismatch';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000003'
        AND slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false) <> 1 THEN
    RAISE EXCEPTION 'Public contact requires one provisioning Klamath organization';
  END IF;

  IF (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'provisioning'
        AND runtime_routing_enabled = false
        AND site_published = false
        AND customer_traffic_allowed = false) <> 1 THEN
    RAISE EXCEPTION 'Public contact requires the inactive Klamath site boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_contacts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'Public contact requires zero Klamath internal contacts';
  END IF;
END
$public_contact_preflight$;

CREATE TABLE public.organization_public_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('phone', 'email')),
  label text NOT NULL,
  destination text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'retired')),
  owner_approved_at timestamptz,
  owner_approval_reference_hash text,
  verified_at timestamptz,
  published_at timestamptz,
  configuration_version integer NOT NULL DEFAULT 1
    CHECK (configuration_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_public_contacts_label_check CHECK (
    label = btrim(label)
    AND length(label) BETWEEN 1 AND 80
    AND label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT organization_public_contacts_destination_check CHECK (
    destination = btrim(destination)
    AND (
      (
        channel = 'phone'
        AND destination ~ '^\+[1-9][0-9]{7,14}$'
      )
      OR (
        channel = 'email'
        AND destination = lower(destination)
        AND length(destination) <= 254
        AND destination ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    )
  ),
  CONSTRAINT organization_public_contacts_approval_hash_check CHECK (
    owner_approval_reference_hash IS NULL
    OR owner_approval_reference_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT organization_public_contacts_publication_gate_check CHECK (
    status <> 'published'
    OR (
      owner_approved_at IS NOT NULL
      AND owner_approval_reference_hash IS NOT NULL
      AND verified_at IS NOT NULL
      AND published_at IS NOT NULL
      AND published_at >= owner_approved_at
      AND published_at >= verified_at
    )
  ),
  CONSTRAINT organization_public_contacts_organization_destination_key
    UNIQUE (organization_id, channel, destination)
);

CREATE INDEX organization_public_contacts_lookup_idx
  ON public.organization_public_contacts (
    organization_id, status, channel, configuration_version DESC
  );

CREATE UNIQUE INDEX organization_public_contacts_one_published_channel_idx
  ON public.organization_public_contacts (organization_id, channel)
  WHERE status = 'published';

ALTER TABLE public.organization_public_contacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_public_contacts
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_public_contacts TO authenticated;
GRANT ALL
  ON TABLE public.organization_public_contacts TO service_role;

CREATE POLICY "Tenant operators view public contacts"
  ON public.organization_public_contacts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_public_contacts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  );

CREATE POLICY "Tenant owners manage public contacts"
  ON public.organization_public_contacts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_public_contacts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id =
          organization_public_contacts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

COMMIT;
