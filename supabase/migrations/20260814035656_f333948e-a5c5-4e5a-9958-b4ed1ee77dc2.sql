-- Hosted compatibility replacement for the unapplied historical Stage 8A
-- organization-routing foundation. The hosted tenant schema intentionally
-- removed public.is_organization_member(uuid, uuid); do not recreate it.
--
-- This forward migration is additive and collision-gated. It creates only the
-- four missing Stage 8A tables and the inactive Oregon test fixture. If those
-- tables already exist in a compatible rebuilt database, it validates the
-- fixture and converges only the RLS policies and grants.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  public.organizations,
  public.organization_memberships,
  public.organization_resolution_keys
IN SHARE ROW EXCLUSIVE MODE;

DO $stage8a_compat_preflight$
DECLARE
  required_table text;
  target_table_count integer;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'organizations',
    'organization_memberships',
    'organization_resolution_keys'
  ]
  LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Stage 8A compatibility prerequisite is missing: %',
        required_table;
    END IF;
  END LOOP;

  IF to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION
      'Obsolete public tenant-membership helper is present; inspect before proceeding';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'Stage 8A compatibility function prerequisite is missing';
  END IF;

  SELECT count(*)
  INTO target_table_count
  FROM unnest(ARRAY[
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  ]) AS target_table
  WHERE to_regclass('public.' || target_table) IS NOT NULL;

  IF target_table_count NOT IN (0, 4) THEN
    RAISE EXCEPTION
      'Partial Stage 8A table state detected (% of 4); inspect before proceeding',
      target_table_count;
  END IF;

  IF (
    SELECT count(*)
    FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND display_name = 'BluLadder DFW'
      AND status = 'active'
      AND is_legacy_default = true
  ) <> 1 OR (
    SELECT count(*)
    FROM public.organizations
    WHERE is_legacy_default = true
      AND id <> 'b1addf00-0000-4000-8000-000000000001'
  ) <> 0 THEN
    RAISE EXCEPTION 'DFW tenant baseline is not exact';
  END IF;

  IF target_table_count = 0 THEN
    IF EXISTS (
      SELECT 1
      FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000002'
         OR lower(slug) = 'bluladder-oregon-test'
    ) THEN
      RAISE EXCEPTION 'Oregon test fixture identity collision detected';
    END IF;
  ELSE
    EXECUTE
      'LOCK TABLE public.organization_settings, public.organization_contacts, '
      || 'public.organization_territories, public.organization_services '
      || 'IN SHARE ROW EXCLUSIVE MODE';

    IF (
      SELECT count(*)
      FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000002'
        AND slug = 'bluladder-oregon-test'
        AND display_name = 'BluLadder Oregon Test'
        AND status = 'provisioning'
        AND is_legacy_default = false
    ) <> 1 THEN
      RAISE EXCEPTION 'Existing Oregon test organization is not exact';
    END IF;

    IF (
      SELECT count(*)
      FROM public.organization_settings
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
        AND public_name = 'BluLadder DFW'
        AND timezone = 'America/Chicago'
        AND locale = 'en-US'
        AND currency_code = 'USD'
    ) <> 1 OR (
      SELECT count(*)
      FROM public.organization_settings
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
        AND public_name = 'BluLadder Oregon Test'
        AND timezone = 'America/Los_Angeles'
        AND locale = 'en-US'
        AND currency_code = 'USD'
    ) <> 1 THEN
      RAISE EXCEPTION 'Existing Stage 8A settings are not exact';
    END IF;

    IF (
      SELECT count(*)
      FROM public.organization_territories
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
        AND name = 'Oregon test fixture — inactive'
        AND country_code = 'US'
        AND state_code = 'OR'
        AND effect = 'include'
        AND priority = 100
        AND status = 'inactive'
    ) <> 1 OR (
      SELECT count(*)
      FROM public.organization_territories
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
    ) <> 1 OR EXISTS (
      SELECT 1
      FROM public.organization_contacts
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
    ) OR EXISTS (
      SELECT 1
      FROM public.organization_services
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
    ) OR EXISTS (
      SELECT 1
      FROM public.organization_memberships
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
    ) OR EXISTS (
      SELECT 1
      FROM public.organization_resolution_keys
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
    ) THEN
      RAISE EXCEPTION 'Existing Oregon test fixture is not safely inactive';
    END IF;
  END IF;
END
$stage8a_compat_preflight$;

CREATE TABLE IF NOT EXISTS public.organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  legal_name text,
  public_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  locale text NOT NULL DEFAULT 'en-US',
  currency_code text NOT NULL DEFAULT 'USD',
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_availability_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  contact_type text NOT NULL CHECK (
    contact_type IN (
      'escalation_phone', 'escalation_sms', 'escalation_email',
      'notification_email', 'manager'
    )
  ),
  label text NOT NULL,
  destination text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, contact_type, destination)
);

CREATE TABLE IF NOT EXISTS public.organization_territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  country_code text NOT NULL DEFAULT 'US',
  state_code text,
  county_name text,
  city_name text,
  postal_code text,
  effect text NOT NULL CHECK (effect IN ('include', 'exclude')),
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    state_code IS NOT NULL OR county_name IS NOT NULL OR
    city_name IS NOT NULL OR postal_code IS NOT NULL
  ),
  CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$')
);

CREATE TABLE IF NOT EXISTS public.organization_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  service_key text NOT NULL,
  availability text NOT NULL DEFAULT 'manual_review'
    CHECK (availability IN ('available', 'manual_review', 'unavailable')),
  reason text,
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service_key)
);

CREATE INDEX IF NOT EXISTS organization_contacts_lookup_idx
  ON public.organization_contacts (
    organization_id, contact_type, status, priority
  );
CREATE INDEX IF NOT EXISTS organization_territories_organization_idx
  ON public.organization_territories (organization_id);
CREATE INDEX IF NOT EXISTS organization_territories_match_idx
  ON public.organization_territories (
    status, country_code, state_code, county_name, city_name, postal_code,
    priority DESC
  );

INSERT INTO public.organization_settings (
  organization_id, public_name, timezone, locale, currency_code
)
SELECT
  'b1addf00-0000-4000-8000-000000000001',
  'BluLadder DFW',
  'America/Chicago',
  'en-US',
  'USD'
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_settings
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
);

INSERT INTO public.organizations (
  id, slug, display_name, status, is_legacy_default
)
SELECT
  'b1addf00-0000-4000-8000-000000000002',
  'bluladder-oregon-test',
  'BluLadder Oregon Test',
  'provisioning',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations
  WHERE id = 'b1addf00-0000-4000-8000-000000000002'
);

INSERT INTO public.organization_settings (
  organization_id, public_name, timezone, locale, currency_code
)
SELECT
  'b1addf00-0000-4000-8000-000000000002',
  'BluLadder Oregon Test',
  'America/Los_Angeles',
  'en-US',
  'USD'
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_settings
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
);

INSERT INTO public.organization_territories (
  organization_id, name, state_code, effect, priority, status
)
SELECT
  'b1addf00-0000-4000-8000-000000000002',
  'Oregon test fixture — inactive',
  'OR',
  'include',
  100,
  'inactive'
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_territories
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
);

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read organization settings"
  ON public.organization_settings;
CREATE POLICY "Members read organization settings"
  ON public.organization_settings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = organization_settings.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins manage organization settings"
  ON public.organization_settings;
CREATE POLICY "Admins manage organization settings"
  ON public.organization_settings FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_settings.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_settings.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Members read organization contacts"
  ON public.organization_contacts;
CREATE POLICY "Members read organization contacts"
  ON public.organization_contacts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = organization_contacts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins manage organization contacts"
  ON public.organization_contacts;
CREATE POLICY "Admins manage organization contacts"
  ON public.organization_contacts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_contacts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_contacts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Members read organization territories"
  ON public.organization_territories;
CREATE POLICY "Members read organization territories"
  ON public.organization_territories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = organization_territories.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins manage organization territories"
  ON public.organization_territories;
CREATE POLICY "Admins manage organization territories"
  ON public.organization_territories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_territories.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_territories.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Members read organization services"
  ON public.organization_services;
CREATE POLICY "Members read organization services"
  ON public.organization_services FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = organization_services.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins manage organization services"
  ON public.organization_services;
CREATE POLICY "Admins manage organization services"
  ON public.organization_services FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_services.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_services.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

REVOKE ALL
  ON public.organization_settings,
     public.organization_contacts,
     public.organization_territories,
     public.organization_services
  FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.organization_settings,
     public.organization_contacts,
     public.organization_territories,
     public.organization_services
  TO authenticated;
GRANT ALL
  ON public.organization_settings,
     public.organization_contacts,
     public.organization_territories,
     public.organization_services
  TO service_role;

DO $stage8a_compat_postflight$
BEGIN
  IF to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Obsolete public tenant-membership helper was introduced';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'organization_settings',
        'organization_contacts',
        'organization_territories',
        'organization_services'
      )
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
  ) <> 4 THEN
    RAISE EXCEPTION 'Stage 8A table/RLS state is incomplete';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'organization_settings',
        'organization_contacts',
        'organization_territories',
        'organization_services'
      )
  ) <> 8 THEN
    RAISE EXCEPTION 'Stage 8A policy count is not exact';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'organization_settings',
        'organization_contacts',
        'organization_territories',
        'organization_services'
      )
      AND (qual ILIKE '%is_organization_member%'
        OR with_check ILIKE '%is_organization_member%')
  ) THEN
    RAISE EXCEPTION 'Stage 8A policy still references the obsolete helper';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organization_settings
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public_name = 'BluLadder DFW'
      AND timezone = 'America/Chicago'
      AND locale = 'en-US'
      AND currency_code = 'USD'
  ) <> 1 THEN
    RAISE EXCEPTION 'DFW settings baseline is not exact';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000002'
      AND slug = 'bluladder-oregon-test'
      AND display_name = 'BluLadder Oregon Test'
      AND status = 'provisioning'
      AND is_legacy_default = false
  ) <> 1 OR (
    SELECT count(*)
    FROM public.organization_settings
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
      AND public_name = 'BluLadder Oregon Test'
      AND timezone = 'America/Los_Angeles'
      AND locale = 'en-US'
      AND currency_code = 'USD'
  ) <> 1 OR (
    SELECT count(*)
    FROM public.organization_territories
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
      AND name = 'Oregon test fixture — inactive'
      AND state_code = 'OR'
      AND effect = 'include'
      AND priority = 100
      AND status = 'inactive'
  ) <> 1 OR (
    SELECT count(*)
    FROM public.organization_territories
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) <> 1 THEN
    RAISE EXCEPTION 'Oregon test fixture is not exact';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_contacts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_services
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_resolution_keys
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Oregon test fixture gained an activation surface';
  END IF;
END
$stage8a_compat_postflight$;

COMMIT;