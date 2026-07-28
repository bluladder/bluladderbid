-- Issue #8, Stage 8A: repository-only organization routing foundation.
-- Additive migration. Do not apply before Stage 7B is verified.

BEGIN;

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

CREATE INDEX IF NOT EXISTS organization_territories_match_idx
  ON public.organization_territories (
    status, country_code, state_code, county_name, city_name, postal_code,
    priority DESC
  );
CREATE INDEX IF NOT EXISTS organization_contacts_lookup_idx
  ON public.organization_contacts (
    organization_id, contact_type, status, priority
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

-- DFW settings preserve the current operating locale/timezone.
INSERT INTO public.organization_settings (
  organization_id, public_name, timezone, locale, currency_code
) VALUES (
  'b1addf00-0000-4000-8000-000000000001',
  'BluLadder DFW',
  'America/Chicago',
  'en-US',
  'USD'
)
ON CONFLICT (organization_id) DO NOTHING;

-- Oregon is a schema/test fixture only. It remains inactive and has no active
-- routing, contacts, or service availability.
INSERT INTO public.organizations (
  id, slug, display_name, status, is_legacy_default
) VALUES (
  'b1addf00-0000-4000-8000-000000000002',
  'bluladder-oregon-test',
  'BluLadder Oregon Test',
  'provisioning',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_settings (
  organization_id, public_name, timezone, locale, currency_code
) VALUES (
  'b1addf00-0000-4000-8000-000000000002',
  'BluLadder Oregon Test',
  'America/Los_Angeles',
  'en-US',
  'USD'
)
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO public.organization_territories (
  organization_id, name, state_code, effect, priority, status
) VALUES (
  'b1addf00-0000-4000-8000-000000000002',
  'Oregon test fixture — inactive',
  'OR',
  'include',
  100,
  'inactive'
)
ON CONFLICT DO NOTHING;

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read organization settings"
  ON public.organization_settings;
CREATE POLICY "Members read organization settings"
  ON public.organization_settings FOR SELECT TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Admins manage organization settings"
  ON public.organization_settings;
CREATE POLICY "Admins manage organization settings"
  ON public.organization_settings FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_settings.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_settings.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Members read organization contacts"
  ON public.organization_contacts;
CREATE POLICY "Members read organization contacts"
  ON public.organization_contacts FOR SELECT TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Admins manage organization contacts"
  ON public.organization_contacts;
CREATE POLICY "Admins manage organization contacts"
  ON public.organization_contacts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_contacts.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_contacts.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Members read organization territories"
  ON public.organization_territories;
CREATE POLICY "Members read organization territories"
  ON public.organization_territories FOR SELECT TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Admins manage organization territories"
  ON public.organization_territories;
CREATE POLICY "Admins manage organization territories"
  ON public.organization_territories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_territories.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_territories.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Members read organization services"
  ON public.organization_services;
CREATE POLICY "Members read organization services"
  ON public.organization_services FOR SELECT TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Admins manage organization services"
  ON public.organization_services;
CREATE POLICY "Admins manage organization services"
  ON public.organization_services FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_services.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_services.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.organization_settings, public.organization_contacts,
  public.organization_territories, public.organization_services TO authenticated;
GRANT ALL ON public.organization_settings, public.organization_contacts,
  public.organization_territories, public.organization_services TO service_role;

COMMIT;
