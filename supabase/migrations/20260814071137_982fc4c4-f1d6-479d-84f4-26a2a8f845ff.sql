-- BluLadder Klamath Phase 1G additive messaging lineage.
--
-- This wave creates no connector, credential, sender, customer, or message.
-- It adds organization authority to the existing SMS ledger without changing
-- the current provider or queue implementation. Future unparented writes may
-- remain NULL until the separately gated writer-adoption wave; Klamath stays
-- inactive until lineage is required and dispatch is connector-bound.

BEGIN;

LOCK TABLE
  public.organizations,
  public.organization_memberships,
  public.organization_resolution_keys,
  public.customers,
  public.quotes,
  public.bookings,
  public.sms_messages
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  missing text[];
  dfw_count integer;
  unexpected_default_count integer;
  klamath_count integer;
  klamath_customer_count integer;
  klamath_provider_identity_count integer;
  parent_conflict_count integer;
  non_dfw_parent_count integer;
BEGIN
  SELECT array_agg(required_table ORDER BY required_table)
  INTO missing
  FROM unnest(ARRAY[
    'organizations',
    'organization_memberships',
    'organization_resolution_keys',
    'customers',
    'quotes',
    'bookings',
    'sms_messages'
  ]) AS required_table
  WHERE to_regclass('public.' || required_table) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1G prerequisite tables missing: %', missing;
  END IF;

  IF to_regclass('public.organization_messaging_connectors') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1G connector table already exists';
  END IF;
  IF to_regprocedure(
    'public.enforce_sms_message_organization_lineage()'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1G lineage function unexpectedly exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sms_messages'
      AND column_name IN ('organization_id', 'messaging_connector_id')
  ) THEN
    RAISE EXCEPTION 'Phase 1G SMS lineage columns already exist';
  END IF;

  SELECT count(*) INTO dfw_count
  FROM public.organizations
  WHERE id = 'b1addf00-0000-4000-8000-000000000001'
    AND slug = 'bluladder-dfw'
    AND is_legacy_default = true
    AND status = 'active';
  SELECT count(*) INTO unexpected_default_count
  FROM public.organizations
  WHERE is_legacy_default = true
    AND id <> 'b1addf00-0000-4000-8000-000000000001';
  IF dfw_count <> 1 OR unexpected_default_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G DFW authority mismatch';
  END IF;

  SELECT count(*) INTO klamath_count
  FROM public.organizations
  WHERE slug = 'bluladder-klamath'
    AND status = 'provisioning'
    AND is_legacy_default = false;
  IF klamath_count <> 1 THEN
    RAISE EXCEPTION 'Phase 1G requires one provisioning Klamath organization';
  END IF;

  SELECT count(*) INTO klamath_customer_count
  FROM public.customers customer
  JOIN public.organizations organization
    ON organization.id = customer.organization_id
  WHERE organization.slug = 'bluladder-klamath';
  IF klamath_customer_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G requires zero Klamath customers';
  END IF;

  SELECT count(*) INTO klamath_provider_identity_count
  FROM public.organization_resolution_keys key
  JOIN public.organizations organization
    ON organization.id = key.organization_id
  WHERE organization.slug = 'bluladder-klamath'
    AND key.key_type IN (
      'jobber_account', 'callrail_number', 'email_address',
      'vapi_assistant', 'vapi_phone_number'
    );
  IF klamath_provider_identity_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G requires zero Klamath provider identities';
  END IF;

  SELECT count(*) INTO parent_conflict_count
  FROM public.sms_messages message
  LEFT JOIN public.bookings booking ON booking.id = message.booking_id
  LEFT JOIN public.quotes quote ON quote.id = message.quote_id
  LEFT JOIN public.customers customer ON customer.id = message.customer_id
  WHERE (booking.organization_id IS NOT NULL AND quote.organization_id IS NOT NULL
          AND booking.organization_id <> quote.organization_id)
     OR (booking.organization_id IS NOT NULL AND customer.organization_id IS NOT NULL
          AND booking.organization_id <> customer.organization_id)
     OR (quote.organization_id IS NOT NULL AND customer.organization_id IS NOT NULL
          AND quote.organization_id <> customer.organization_id);
  IF parent_conflict_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G SMS parent organization conflict';
  END IF;

  SELECT count(*) INTO non_dfw_parent_count
  FROM public.sms_messages message
  LEFT JOIN public.bookings booking ON booking.id = message.booking_id
  LEFT JOIN public.quotes quote ON quote.id = message.quote_id
  LEFT JOIN public.customers customer ON customer.id = message.customer_id
  WHERE coalesce(
    booking.organization_id,
    quote.organization_id,
    customer.organization_id
  ) IS DISTINCT FROM 'b1addf00-0000-4000-8000-000000000001'::uuid
    AND coalesce(
      booking.organization_id,
      quote.organization_id,
      customer.organization_id
    ) IS NOT NULL;
  IF non_dfw_parent_count <> 0 THEN
    RAISE EXCEPTION 'Phase 1G historical SMS parent is not DFW';
  END IF;
END
$$;

CREATE TABLE public.organization_messaging_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  provider text NOT NULL CHECK (provider IN ('callrail', 'twilio', 'resend')),
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active', 'inactive', 'degraded')),
  priority integer NOT NULL DEFAULT 0,
  credential_reference text,
  sender_identity_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_messaging_connectors_reference_pair_check CHECK (
    (status = 'active' AND credential_reference IS NOT NULL
      AND btrim(credential_reference) <> ''
      AND sender_identity_reference IS NOT NULL
      AND btrim(sender_identity_reference) <> '')
    OR status <> 'active'
  ),
  UNIQUE (organization_id, channel, provider, sender_identity_reference)
);

CREATE INDEX organization_messaging_connectors_selection_idx
  ON public.organization_messaging_connectors (
    organization_id, channel, status, priority DESC
  );

ALTER TABLE public.organization_messaging_connectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_messaging_connectors FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_messaging_connectors TO authenticated;
GRANT ALL ON TABLE public.organization_messaging_connectors TO service_role;

CREATE POLICY "Tenant members view messaging connectors"
  ON public.organization_messaging_connectors FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_messaging_connectors.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
    )
  );

CREATE POLICY "Tenant operators manage messaging connectors"
  ON public.organization_messaging_connectors FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_messaging_connectors.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_messaging_connectors.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
    )
  );

ALTER TABLE public.sms_messages
  ADD COLUMN organization_id uuid,
  ADD COLUMN messaging_connector_id uuid;

UPDATE public.sms_messages
SET organization_id = 'b1addf00-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;

ALTER TABLE public.sms_messages
  ADD CONSTRAINT sms_messages_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  ADD CONSTRAINT sms_messages_messaging_connector_id_fkey
    FOREIGN KEY (messaging_connector_id)
    REFERENCES public.organization_messaging_connectors(id);

CREATE INDEX sms_messages_organization_queue_idx
  ON public.sms_messages (organization_id, status, send_at);
CREATE INDEX sms_messages_messaging_connector_idx
  ON public.sms_messages (messaging_connector_id)
  WHERE messaging_connector_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_sms_message_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_organization_id uuid;
  next_parent_organization_id uuid;
  connector_organization_id uuid;
  connector_channel text;
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    SELECT organization_id INTO parent_organization_id
    FROM public.bookings WHERE id = NEW.booking_id;
  END IF;
  IF NEW.quote_id IS NOT NULL THEN
    SELECT organization_id INTO next_parent_organization_id
    FROM public.quotes WHERE id = NEW.quote_id;
    IF parent_organization_id IS NOT NULL
      AND next_parent_organization_id IS NOT NULL
      AND parent_organization_id <> next_parent_organization_id THEN
      RAISE EXCEPTION 'sms message parent organization mismatch';
    END IF;
    parent_organization_id := coalesce(parent_organization_id, next_parent_organization_id);
  END IF;
  IF NEW.customer_id IS NOT NULL THEN
    SELECT organization_id INTO next_parent_organization_id
    FROM public.customers WHERE id = NEW.customer_id;
    IF parent_organization_id IS NOT NULL
      AND next_parent_organization_id IS NOT NULL
      AND parent_organization_id <> next_parent_organization_id THEN
      RAISE EXCEPTION 'sms message parent organization mismatch';
    END IF;
    parent_organization_id := coalesce(parent_organization_id, next_parent_organization_id);
  END IF;

  IF NEW.organization_id IS NULL AND parent_organization_id IS NOT NULL THEN
    NEW.organization_id := parent_organization_id;
  ELSIF NEW.organization_id IS NOT NULL
    AND parent_organization_id IS NOT NULL
    AND NEW.organization_id <> parent_organization_id THEN
    RAISE EXCEPTION 'sms message organization does not match parent';
  END IF;

  IF NEW.messaging_connector_id IS NOT NULL THEN
    SELECT organization_id, channel
      INTO connector_organization_id, connector_channel
    FROM public.organization_messaging_connectors
    WHERE id = NEW.messaging_connector_id;
    IF connector_organization_id IS NULL
      OR NEW.organization_id IS NULL
      OR connector_organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'sms message connector organization mismatch';
    END IF;
    IF connector_channel <> NEW.channel THEN
      RAISE EXCEPTION 'sms message connector channel mismatch';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_sms_message_organization_lineage()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER enforce_sms_message_organization_lineage
  BEFORE INSERT OR UPDATE OF
    organization_id, messaging_connector_id, channel,
    booking_id, quote_id, customer_id
  ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sms_message_organization_lineage();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organization_messaging_connectors
  ) THEN
    RAISE EXCEPTION 'Phase 1G migration unexpectedly created a connector';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sms_messages WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Phase 1G historical SMS backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sms_messages
    WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Phase 1G historical SMS escaped the DFW boundary';
  END IF;
END
$$;

COMMIT;