-- BluLadder Klamath Phase 1H: organization-scoped communication consent.
--
-- Hosted preflight proved that all seven historical consent rows are from the
-- reviewed DFW-only era, have no conflicting/orphan parents, and project to no
-- organization-scoped identity collision. This migration makes that bounded
-- compatibility decision explicit. It creates no customer, consent decision,
-- message, connector, credential, or provider resource and keeps Klamath in
-- provisioning state.

BEGIN;

LOCK TABLE
  public.organizations,
  public.organization_memberships,
  public.organization_resolution_keys,
  public.customers,
  public.chat_conversations,
  public.bookings,
  public.communication_consent,
  public.communication_consent_events
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
    'bookings',
    'communication_consent',
    'communication_consent_events'
  ]) AS required_tables(required_table)
  WHERE to_regclass('public.' || required_table) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1H prerequisite tables missing: %', missing;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'communication_consent', 'communication_consent_events'
      )
      AND column_name = 'organization_id'
  ) OR to_regprocedure(
    'public.record_organization_consent(uuid,public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)'
  ) IS NOT NULL OR to_regprocedure(
    'public.consent_allows_for_organization(uuid,public.consent_channel,public.consent_type,text,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1H organization consent lineage already exists';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true) <> 1
    OR (SELECT count(*) FROM public.organizations
        WHERE is_legacy_default = true
          AND id <> 'b1addf00-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'Phase 1H DFW authority mismatch';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000003'
        AND slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false) <> 1 THEN
    RAISE EXCEPTION 'Phase 1H requires one provisioning Klamath organization';
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
    RAISE EXCEPTION 'Phase 1H requires zero Klamath customer traffic';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_resolution_keys key
    WHERE key.organization_id = 'b1addf00-0000-4000-8000-000000000003'
      AND key.key_type IN (
        'jobber_account', 'callrail_number', 'email_address',
        'vapi_assistant', 'vapi_phone_number'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 1H requires zero Klamath provider identities';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.communication_consent consent
    LEFT JOIN public.customers customer ON customer.id = consent.customer_id
    LEFT JOIN public.chat_conversations conversation
      ON conversation.id = consent.conversation_id
    LEFT JOIN public.bookings booking ON booking.id = consent.booking_id
    WHERE (consent.customer_id IS NOT NULL AND customer.id IS NULL)
       OR (consent.conversation_id IS NOT NULL AND conversation.id IS NULL)
       OR (consent.booking_id IS NOT NULL AND booking.id IS NULL)
       OR (
         customer.organization_id IS NOT NULL
         AND conversation.organization_id IS NOT NULL
         AND customer.organization_id <> conversation.organization_id
       )
       OR (
         customer.organization_id IS NOT NULL
         AND booking.organization_id IS NOT NULL
         AND customer.organization_id <> booking.organization_id
       )
       OR (
         conversation.organization_id IS NOT NULL
         AND booking.organization_id IS NOT NULL
         AND conversation.organization_id <> booking.organization_id
       )
       OR coalesce(
         customer.organization_id,
         conversation.organization_id,
         booking.organization_id,
         'b1addf00-0000-4000-8000-000000000001'::uuid
       ) <> 'b1addf00-0000-4000-8000-000000000001'::uuid
  ) THEN
    RAISE EXCEPTION 'Phase 1H consent parent authority requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        coalesce(
          customer.organization_id,
          conversation.organization_id,
          booking.organization_id,
          'b1addf00-0000-4000-8000-000000000001'::uuid
        ) AS organization_id,
        consent.channel,
        consent.consent_type,
        CASE WHEN consent.channel = 'sms'
          THEN nullif(trim(consent.phone), '')
          ELSE lower(nullif(trim(consent.email), ''))
        END AS normalized_identity
      FROM public.communication_consent consent
      LEFT JOIN public.customers customer ON customer.id = consent.customer_id
      LEFT JOIN public.chat_conversations conversation
        ON conversation.id = consent.conversation_id
      LEFT JOIN public.bookings booking ON booking.id = consent.booking_id
    ) projected
    WHERE normalized_identity IS NOT NULL
    GROUP BY organization_id, channel, consent_type, normalized_identity
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 1H organization-scoped identity collision';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.communication_consent_events event
    LEFT JOIN public.communication_consent consent ON consent.id = event.consent_id
    WHERE consent.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Phase 1H orphan consent event requires reconciliation';
  END IF;
END
$$;

ALTER TABLE public.communication_consent
  ADD COLUMN organization_id uuid;
ALTER TABLE public.communication_consent_events
  ADD COLUMN organization_id uuid;

-- Parentless historical rows are explicitly assigned to the sole active
-- legacy organization only because the preflight proved Klamath has had no
-- customer traffic or consent state. This is not a runtime fallback.
UPDATE public.communication_consent consent
SET organization_id = coalesce(
  customer.organization_id,
  conversation.organization_id,
  booking.organization_id,
  'b1addf00-0000-4000-8000-000000000001'::uuid
)
FROM public.communication_consent source
LEFT JOIN public.customers customer ON customer.id = source.customer_id
LEFT JOIN public.chat_conversations conversation
  ON conversation.id = source.conversation_id
LEFT JOIN public.bookings booking ON booking.id = source.booking_id
WHERE source.id = consent.id;

UPDATE public.communication_consent_events event
SET organization_id = consent.organization_id
FROM public.communication_consent consent
WHERE consent.id = event.consent_id;

ALTER TABLE public.communication_consent
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT communication_consent_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id);

ALTER TABLE public.communication_consent_events
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN consent_id SET NOT NULL,
  ADD CONSTRAINT communication_consent_events_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id);

DROP INDEX public.uq_consent_sms;
DROP INDEX public.uq_consent_email;
CREATE UNIQUE INDEX uq_consent_organization_sms
  ON public.communication_consent (
    organization_id, phone, consent_type
  )
  WHERE channel = 'sms' AND phone IS NOT NULL;
CREATE UNIQUE INDEX uq_consent_organization_email
  ON public.communication_consent (
    organization_id, email, consent_type
  )
  WHERE channel = 'email' AND email IS NOT NULL;
CREATE UNIQUE INDEX communication_consent_organization_id_id_key
  ON public.communication_consent (organization_id, id);
CREATE INDEX communication_consent_organization_customer_idx
  ON public.communication_consent (organization_id, customer_id);
CREATE INDEX communication_consent_events_organization_created_idx
  ON public.communication_consent_events (organization_id, created_at DESC);

ALTER TABLE public.communication_consent_events
  DROP CONSTRAINT communication_consent_events_consent_id_fkey,
  ADD CONSTRAINT communication_consent_events_organization_consent_fkey
    FOREIGN KEY (organization_id, consent_id)
    REFERENCES public.communication_consent (organization_id, id)
    ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.enforce_communication_consent_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  parent_organization_id uuid;
  next_parent_organization_id uuid;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT customer.organization_id INTO parent_organization_id
    FROM public.customers customer WHERE customer.id = NEW.customer_id;
  END IF;
  IF NEW.conversation_id IS NOT NULL THEN
    SELECT conversation.organization_id INTO next_parent_organization_id
    FROM public.chat_conversations conversation
    WHERE conversation.id = NEW.conversation_id;
    IF parent_organization_id IS NOT NULL
      AND next_parent_organization_id IS NOT NULL
      AND parent_organization_id <> next_parent_organization_id THEN
      RAISE EXCEPTION 'consent parent organization mismatch'
        USING ERRCODE = '23514';
    END IF;
    parent_organization_id := coalesce(
      parent_organization_id, next_parent_organization_id
    );
  END IF;
  IF NEW.booking_id IS NOT NULL THEN
    SELECT booking.organization_id INTO next_parent_organization_id
    FROM public.bookings booking WHERE booking.id = NEW.booking_id;
    IF parent_organization_id IS NOT NULL
      AND next_parent_organization_id IS NOT NULL
      AND parent_organization_id <> next_parent_organization_id THEN
      RAISE EXCEPTION 'consent parent organization mismatch'
        USING ERRCODE = '23514';
    END IF;
    parent_organization_id := coalesce(
      parent_organization_id, next_parent_organization_id
    );
  END IF;

  IF NEW.organization_id IS NULL AND parent_organization_id IS NOT NULL THEN
    NEW.organization_id := parent_organization_id;
  ELSIF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'consent organization authority is required'
      USING ERRCODE = '23514';
  ELSIF parent_organization_id IS NOT NULL
    AND NEW.organization_id <> parent_organization_id THEN
    RAISE EXCEPTION 'consent organization does not match parent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_communication_consent_event_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  parent_organization_id uuid;
BEGIN
  SELECT consent.organization_id INTO parent_organization_id
  FROM public.communication_consent consent
  WHERE consent.id = NEW.consent_id;

  IF parent_organization_id IS NULL THEN
    RAISE EXCEPTION 'consent event parent is required'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := parent_organization_id;
  ELSIF NEW.organization_id <> parent_organization_id THEN
    RAISE EXCEPTION 'consent event organization does not match consent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION
  public.enforce_communication_consent_organization_lineage()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.enforce_communication_consent_event_organization_lineage()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER enforce_communication_consent_organization_lineage
  BEFORE INSERT OR UPDATE OF
    organization_id, customer_id, conversation_id, booking_id
  ON public.communication_consent
  FOR EACH ROW EXECUTE FUNCTION
    public.enforce_communication_consent_organization_lineage();
CREATE TRIGGER enforce_communication_consent_event_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, consent_id
  ON public.communication_consent_events
  FOR EACH ROW EXECUTE FUNCTION
    public.enforce_communication_consent_event_organization_lineage();

CREATE OR REPLACE FUNCTION public.record_organization_consent(
  p_organization_id uuid,
  p_channel public.consent_channel,
  p_consent_type public.consent_type,
  p_status public.consent_status,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_language_shown text DEFAULT NULL,
  p_source text DEFAULT 'system',
  p_customer_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_id uuid;
  v_action text;
BEGIN
  IF p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active consent organization authority is required';
  END IF;
  IF p_channel = 'sms' AND v_phone IS NULL THEN
    RAISE EXCEPTION 'SMS consent requires a phone number';
  END IF;
  IF p_channel = 'email' AND v_email IS NULL THEN
    RAISE EXCEPTION 'Email consent requires an email address';
  END IF;

  IF p_channel = 'sms' THEN
    SELECT id INTO v_id FROM public.communication_consent
    WHERE organization_id = p_organization_id
      AND channel = 'sms'
      AND phone = v_phone
      AND consent_type = p_consent_type;
  ELSE
    SELECT id INTO v_id FROM public.communication_consent
    WHERE organization_id = p_organization_id
      AND channel = 'email'
      AND email = v_email
      AND consent_type = p_consent_type;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.communication_consent (
      organization_id, customer_id, conversation_id, email, phone, channel,
      consent_type, status, language_shown, source, granted_at, revoked_at,
      session_id, booking_id, metadata
    ) VALUES (
      p_organization_id, p_customer_id, p_conversation_id, v_email, v_phone,
      p_channel, p_consent_type, p_status, p_language_shown, p_source,
      CASE WHEN p_status = 'granted' THEN now() END,
      CASE WHEN p_status = 'revoked' THEN now() END,
      p_session_id, p_booking_id, coalesce(p_metadata, '{}'::jsonb)
    ) RETURNING id INTO v_id;
    v_action := 'create';
  ELSE
    UPDATE public.communication_consent SET
      status = p_status,
      language_shown = coalesce(p_language_shown, language_shown),
      source = p_source,
      customer_id = coalesce(p_customer_id, customer_id),
      conversation_id = coalesce(p_conversation_id, conversation_id),
      booking_id = coalesce(p_booking_id, booking_id),
      granted_at = CASE WHEN p_status = 'granted' THEN now() ELSE granted_at END,
      revoked_at = CASE WHEN p_status = 'revoked' THEN now() ELSE revoked_at END,
      opt_out_source = CASE
        WHEN p_status = 'revoked' THEN p_source ELSE opt_out_source
      END,
      metadata = coalesce(
        communication_consent.metadata, '{}'::jsonb
      ) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_id AND organization_id = p_organization_id;
    v_action := CASE
      WHEN p_status = 'granted' THEN 'grant'
      WHEN p_status = 'revoked' THEN 'revoke'
      ELSE 'update'
    END;
  END IF;

  INSERT INTO public.communication_consent_events (
    organization_id, consent_id, action, channel, consent_type, status,
    language_shown, source, actor_id, email, phone, metadata
  ) VALUES (
    p_organization_id, v_id, v_action, p_channel, p_consent_type, p_status,
    p_language_shown, p_source, p_actor_id, v_email, v_phone,
    coalesce(p_metadata, '{}'::jsonb)
  );
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.consent_allows_for_organization(
  p_organization_id uuid,
  p_channel public.consent_channel,
  p_required public.consent_type,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_types public.consent_type[];
BEGIN
  IF p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RETURN false;
  END IF;
  IF p_required = 'transactional' THEN
    RETURN true;
  END IF;

  IF p_channel = 'sms' THEN
    IF v_phone IS NULL THEN RETURN false; END IF;
    SELECT array_agg(consent_type) INTO v_types
    FROM public.communication_consent
    WHERE organization_id = p_organization_id
      AND channel = 'sms' AND phone = v_phone AND status = 'granted';
  ELSE
    IF v_email IS NULL THEN RETURN false; END IF;
    SELECT array_agg(consent_type) INTO v_types
    FROM public.communication_consent
    WHERE organization_id = p_organization_id
      AND channel = 'email' AND email = v_email AND status = 'granted';
  END IF;

  IF v_types IS NULL THEN RETURN false; END IF;
  IF p_required = 'marketing' THEN
    RETURN 'marketing' = ANY(v_types);
  ELSIF p_required = 'requested_follow_up' THEN
    RETURN ('requested_follow_up' = ANY(v_types))
      OR ('marketing' = ANY(v_types));
  END IF;
  RETURN false;
END
$$;

-- Existing DFW-only callers retain their signatures, but are now explicitly
-- bounded to DFW. Klamath runtime must adopt the organization-aware functions.
CREATE OR REPLACE FUNCTION public.record_consent(
  p_channel public.consent_channel,
  p_consent_type public.consent_type,
  p_status public.consent_status,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_language_shown text DEFAULT NULL,
  p_source text DEFAULT 'system',
  p_customer_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.record_organization_consent(
    'b1addf00-0000-4000-8000-000000000001'::uuid,
    p_channel, p_consent_type, p_status, p_email, p_phone,
    p_language_shown, p_source, p_customer_id, p_conversation_id,
    p_session_id, p_booking_id, p_actor_id, p_metadata
  )
$$;

CREATE OR REPLACE FUNCTION public.consent_allows(
  p_channel public.consent_channel,
  p_required public.consent_type,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.consent_allows_for_organization(
    'b1addf00-0000-4000-8000-000000000001'::uuid,
    p_channel, p_required, p_email, p_phone
  )
$$;

REVOKE ALL ON FUNCTION public.record_organization_consent(
  uuid, public.consent_channel, public.consent_type, public.consent_status,
  text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_organization_consent(
  uuid, public.consent_channel, public.consent_type, public.consent_status,
  text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION public.consent_allows_for_organization(
  uuid, public.consent_channel, public.consent_type, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consent_allows_for_organization(
  uuid, public.consent_channel, public.consent_type, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.record_consent(
  public.consent_channel, public.consent_type, public.consent_status,
  text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_consent(
  public.consent_channel, public.consent_type, public.consent_status,
  text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION public.consent_allows(
  public.consent_channel, public.consent_type, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consent_allows(
  public.consent_channel, public.consent_type, text, text
) TO service_role, authenticated;

DROP POLICY "Admins view consent" ON public.communication_consent;
DROP POLICY "Admins manage consent" ON public.communication_consent;
CREATE POLICY "Tenant members view consent"
  ON public.communication_consent FOR SELECT TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public.has_admin_level((SELECT auth.uid()), 'read_only_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = communication_consent.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );
CREATE POLICY "Tenant operators manage consent"
  ON public.communication_consent FOR ALL TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public.has_admin_level((SELECT auth.uid()), 'operations_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = communication_consent.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
        AND tenant.status = 'active'
    )
  )
  WITH CHECK (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public.has_admin_level((SELECT auth.uid()), 'operations_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = communication_consent.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin', 'operations')
        AND tenant.status = 'active'
    )
  );

DROP POLICY "Admins view consent history"
  ON public.communication_consent_events;
CREATE POLICY "Tenant members view consent history"
  ON public.communication_consent_events FOR SELECT TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public.has_admin_level((SELECT auth.uid()), 'read_only_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = communication_consent_events.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.communication_consent
    WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM public.communication_consent_events
    WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Phase 1H historical lineage escaped DFW';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.communication_consent_events event
    JOIN public.communication_consent consent ON consent.id = event.consent_id
    WHERE event.organization_id <> consent.organization_id
  ) THEN
    RAISE EXCEPTION 'Phase 1H consent event lineage mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'communication_consent') <> 2
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'communication_consent_events') <> 1 THEN
    RAISE EXCEPTION 'Phase 1H RLS policy count drifted';
  END IF;
END
$$;

COMMIT;
