-- BluLadder Klamath Phase 1C: inactive hosted-foundation candidate.
-- Repository migration only. Do not apply without a separate exact-migration
-- authorization and a clean hosted preflight. This migration provisions no
-- user, contact destination, credential, provider resource, customer traffic,
-- or active runtime capability.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Serialize the bounded identity checks with any concurrent tenant-routing
-- administration. No external calls or long-running data backfill occurs in
-- this transaction.
LOCK TABLE
  public.organizations,
  public.organization_memberships,
  public.organization_settings,
  public.organization_contacts,
  public.organization_territories,
  public.organization_services,
  public.organization_resolution_keys
IN SHARE ROW EXCLUSIVE MODE;

DO $phase1c_preflight$
DECLARE
  required_table text;
  current_privileges text[];
  expected_crud_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'SELECT', 'UPDATE'
  ];
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'organizations',
    'organization_memberships',
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services',
    'organization_resolution_keys'
  ]
  LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Phase 1C prerequisite table is missing: %',
        required_table;
    END IF;
  END LOOP;

  FOREACH required_table IN ARRAY ARRAY[
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  ]
  LOOP
    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = required_table
      AND grantee = 'authenticated';

    IF current_privileges <> expected_crud_privileges THEN
      RAISE EXCEPTION
        'Stage 8A authenticated grant repair prerequisite is not exact on %',
        required_table;
    END IF;
  END LOOP;

  IF to_regclass('public.organization_customer_sites') IS NOT NULL
     OR to_regclass('public.organization_pricing_profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1C target tables already exist; inspect before retry';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000003'
       OR lower(slug) = 'bluladder-klamath'
  ) THEN
    RAISE EXCEPTION 'BluLadder Klamath organization identity already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_resolution_keys
    WHERE id = 'b1addf00-0000-4000-8000-000000005001'
       OR (
         key_type = 'hostname'
         AND key_hash =
           '0ef6fcf28e127279570a272e667e488bbda76191b99d204e78f4d936343a4c77'
       )
  ) THEN
    RAISE EXCEPTION 'BluLadder Klamath hostname identity already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_territories
    WHERE id IN (
      'b1addf00-0000-4000-8000-000000003001',
      'b1addf00-0000-4000-8000-000000003002'
    )
  ) THEN
    RAISE EXCEPTION 'BluLadder Klamath territory identity already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_services
    WHERE id IN (
      'b1addf00-0000-4000-8000-000000004001',
      'b1addf00-0000-4000-8000-000000004002',
      'b1addf00-0000-4000-8000-000000004003',
      'b1addf00-0000-4000-8000-000000004004',
      'b1addf00-0000-4000-8000-000000004005',
      'b1addf00-0000-4000-8000-000000004006'
    )
  ) THEN
    RAISE EXCEPTION 'BluLadder Klamath service identity already exists';
  END IF;
END
$phase1c_preflight$;

CREATE TABLE public.organization_customer_sites (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  tenant_key text NOT NULL UNIQUE,
  canonical_hostname text NOT NULL UNIQUE,
  mapping_status text NOT NULL DEFAULT 'provisioning'
    CHECK (mapping_status IN ('provisioning', 'active', 'disabled')),
  runtime_routing_enabled boolean NOT NULL DEFAULT false,
  site_published boolean NOT NULL DEFAULT false,
  customer_traffic_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id),
  CONSTRAINT organization_customer_sites_hostname_shape_check CHECK (
    canonical_hostname = lower(btrim(canonical_hostname))
    AND length(canonical_hostname) BETWEEN 4 AND 253
    AND canonical_hostname ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    AND canonical_hostname NOT LIKE '%..%'
    AND canonical_hostname NOT LIKE '%.lovable.app'
  ),
  CONSTRAINT organization_customer_sites_activation_check CHECK (
    mapping_status = 'active'
    OR (
      runtime_routing_enabled = false
      AND site_published = false
      AND customer_traffic_allowed = false
    )
  ),
  CONSTRAINT organization_customer_sites_traffic_check CHECK (
    customer_traffic_allowed = false
    OR (
      mapping_status = 'active'
      AND runtime_routing_enabled = true
      AND site_published = true
    )
  )
);

CREATE INDEX organization_customer_sites_organization_idx
  ON public.organization_customer_sites (organization_id, mapping_status);

CREATE TABLE public.organization_pricing_profiles (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  profile_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'retired')),
  runtime_enabled boolean NOT NULL DEFAULT false,
  currency_code text NOT NULL DEFAULT 'USD',
  tax_policy text NOT NULL,
  config_snapshot jsonb NOT NULL,
  copied_from text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, profile_key, version),
  CONSTRAINT organization_pricing_profiles_snapshot_check CHECK (
    jsonb_typeof(config_snapshot) = 'object'
  ),
  CONSTRAINT organization_pricing_profiles_runtime_check CHECK (
    runtime_enabled = false OR status = 'approved'
  )
);

CREATE INDEX organization_pricing_profiles_organization_idx
  ON public.organization_pricing_profiles (
    organization_id, status, version DESC
  );
CREATE UNIQUE INDEX organization_pricing_profiles_one_runtime_idx
  ON public.organization_pricing_profiles (organization_id)
  WHERE runtime_enabled;

ALTER TABLE public.organization_customer_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_pricing_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read organization customer sites"
  ON public.organization_customer_sites FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = organization_customer_sites.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

CREATE POLICY "Admins manage organization customer sites"
  ON public.organization_customer_sites FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_customer_sites.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_customer_sites.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Members read organization pricing profiles"
  ON public.organization_pricing_profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = organization_pricing_profiles.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

CREATE POLICY "Admins manage organization pricing profiles"
  ON public.organization_pricing_profiles FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_pricing_profiles.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_pricing_profiles.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

REVOKE ALL
  ON public.organization_customer_sites,
     public.organization_pricing_profiles
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.organization_customer_sites,
     public.organization_pricing_profiles
  TO authenticated;
GRANT ALL
  ON public.organization_customer_sites,
     public.organization_pricing_profiles
  TO service_role;

INSERT INTO public.organizations (
  id,
  slug,
  display_name,
  status,
  is_legacy_default
) VALUES (
  'b1addf00-0000-4000-8000-000000000003',
  'bluladder-klamath',
  'BluLadder Klamath',
  'provisioning',
  false
);

INSERT INTO public.organization_settings (
  organization_id,
  public_name,
  timezone,
  locale,
  currency_code,
  business_hours,
  branding,
  tax_settings,
  service_availability_message
) VALUES (
  'b1addf00-0000-4000-8000-000000000003',
  'BluLadder Klamath',
  'America/Los_Angeles',
  'en-US',
  'USD',
  jsonb_build_object(
    'timezone', 'America/Los_Angeles',
    'local_open', '09:00',
    'local_close', '17:00',
    'active_days', jsonb_build_array(),
    'status', 'owner_confirmation_required',
    'instant_confirmation_enabled', false
  ),
  jsonb_build_object(
    'public_name', 'BluLadder Klamath',
    'tagline', 'Next Level Clean',
    'primary_color', '#1B5FAC',
    'accent_color', '#00CFFF',
    'heading_font', 'Montserrat Extra Bold'
  ),
  jsonb_build_object(
    'policy', 'oregon_no_general_sales_tax',
    'rate', 0,
    'status', 'draft'
  ),
  'Service availability is not active while BluLadder Klamath is provisioning.'
);

INSERT INTO public.organization_customer_sites (
  id,
  organization_id,
  tenant_key,
  canonical_hostname,
  mapping_status,
  runtime_routing_enabled,
  site_published,
  customer_traffic_allowed
) VALUES (
  'b1addf00-0000-4000-8000-000000001003',
  'b1addf00-0000-4000-8000-000000000003',
  'bluladder-klamath',
  'klamath.bluladder.com',
  'provisioning',
  false,
  false,
  false
);

-- The hostname is normalized and hashed exactly as the server authority
-- boundary does. It remains disabled until a separate activation release.
INSERT INTO public.organization_resolution_keys (
  id,
  organization_id,
  key_type,
  key_hash,
  status
) VALUES (
  'b1addf00-0000-4000-8000-000000005001',
  'b1addf00-0000-4000-8000-000000000003',
  'hostname',
  '0ef6fcf28e127279570a272e667e488bbda76191b99d204e78f4d936343a4c77',
  'disabled'
);

INSERT INTO public.organization_territories (
  id,
  organization_id,
  name,
  country_code,
  state_code,
  county_name,
  effect,
  priority,
  status
) VALUES
  (
    'b1addf00-0000-4000-8000-000000003001',
    'b1addf00-0000-4000-8000-000000000003',
    'Klamath County',
    'US',
    'OR',
    'Klamath',
    'include',
    100,
    'inactive'
  ),
  (
    'b1addf00-0000-4000-8000-000000003002',
    'b1addf00-0000-4000-8000-000000000003',
    'Lake County',
    'US',
    'OR',
    'Lake',
    'include',
    100,
    'inactive'
  );

INSERT INTO public.organization_services (
  id,
  organization_id,
  service_key,
  availability,
  reason,
  status
) VALUES
  (
    'b1addf00-0000-4000-8000-000000004001',
    'b1addf00-0000-4000-8000-000000000003',
    'window_cleaning',
    'manual_review',
    'Inactive until Klamath pricing and activation are separately approved.',
    'inactive'
  ),
  (
    'b1addf00-0000-4000-8000-000000004002',
    'b1addf00-0000-4000-8000-000000000003',
    'gutter_cleaning',
    'manual_review',
    'Inactive until Klamath pricing and activation are separately approved.',
    'inactive'
  ),
  (
    'b1addf00-0000-4000-8000-000000004003',
    'b1addf00-0000-4000-8000-000000000003',
    'house_wash',
    'manual_review',
    'Inactive until Klamath pricing and activation are separately approved.',
    'inactive'
  ),
  (
    'b1addf00-0000-4000-8000-000000004004',
    'b1addf00-0000-4000-8000-000000000003',
    'pressure_washing',
    'manual_review',
    'Inactive until Klamath pricing and activation are separately approved.',
    'inactive'
  ),
  (
    'b1addf00-0000-4000-8000-000000004005',
    'b1addf00-0000-4000-8000-000000000003',
    'commercial_exterior_cleaning',
    'manual_review',
    'Commercial work requires manual review.',
    'inactive'
  ),
  (
    'b1addf00-0000-4000-8000-000000004006',
    'b1addf00-0000-4000-8000-000000000003',
    'storefront_window_cleaning',
    'manual_review',
    'Storefront work requires manual review.',
    'inactive'
  );

INSERT INTO public.organization_pricing_profiles (
  id,
  organization_id,
  profile_key,
  version,
  status,
  runtime_enabled,
  currency_code,
  tax_policy,
  config_snapshot,
  copied_from
) VALUES (
  'b1addf00-0000-4000-8000-000000002003',
  'b1addf00-0000-4000-8000-000000000003',
  'bluladder-klamath-pricing-draft',
  1,
  'draft',
  false,
  'USD',
  'oregon_no_general_sales_tax',
  $klamath_pricing${"window_cleaning":{"exteriorPerSqFt":0.08,"interiorPerSqFt":0.075,"insideAndOutsidePerSqFt":0.15,"minimumPrice":185,"modifiers":{"stories":{"1":0,"2":12,"3":18},"condition":{"heavy":15,"maintenance":0},"hardWater":10,"frenchPanes":40,"solarScreens":20}},"window_addons":{"ladderWork":{"1-3":25,"4-8":50,"9+":75},"sunroom":{"none":0,"small":125,"medium":175,"large":225}},"house_wash":{"perSqFt":0.25,"minimumPrice":396,"modifiers":{"stories":{"1":0,"2":10,"3":15}},"rustStainSurcharge":15},"gutter_cleaning":{"perSqFt":0.08,"minimumPrice":200,"modifiers":{"stories":{"1":0,"2":10,"3":12}},"gutterGuardsPerLinearFoot":8},"roof_cleaning":{"perSqFt":0.3,"minimumPrice":500,"modifiers":{"stories":{"1":0,"2":10,"3":15},"roofType":{"flat":0,"tile":10,"metal":0,"asphalt":0},"severity":{"heavy":10,"light":0,"moderate":5}}},"driveway_cleaning":{"perSqFt":0.2,"minimumPrice":200,"surfaceMultipliers":{"concrete":1,"stamped":1,"pavers":1.25,"exposed_aggregate":1,"brick":1,"stone":1,"asphalt":1,"tile":1}},"pressure_washing":{"perSqFt":0.25,"minimumPrice":75,"surfaceMultipliers":{"concrete":1,"stamped":1.15,"pavers":1.25,"exposed_aggregate":1.15,"brick":1.2,"stone":1.3,"asphalt":1,"tile":1.35}},"solar_panel_cleaning":{"perPanel":10,"minimumPrice":0},"screen_repair":{"perScreen":35,"minimumPrice":0},"tax_policy":{"version":"oregon-no-general-sales-tax-2026-08-13","rate":0,"exemptLineItemKeys":[],"customerLabel":"Tax"},"duration_policy":{"version":"klamath-draft-dfw-productivity-copy-2026-08-13","setupMinutes":15,"roundingIncrementMinutes":15,"hourlyRevenueTargets":{"windowsAndScreens":120,"gutterWork":150,"exteriorCleaning":175}},"window_promo_99":{"active":false,"promoId":"PROMO_99_WINDOWS","version":1,"flatPrice":99,"maxWindows":10,"effectiveStart":null,"effectiveEnd":null,"prepInstructions":"Customer must remove all window screens before BluLadder arrives. Screen removal and screen cleaning are not included. Interior window cleaning is not included. Tracks and sills are not included.","stackingPolicy":"none","serviceLabel":"$99 Exterior Window Cleaning (up to 10 windows)","terms":"Residential exterior window cleaning only. Covers up to 10 standard exterior windows."},"bundle_config":{"good":{"name":"Good","label":"Core Exterior Care","description":"Essential exterior window cleaning to keep your home looking great","addonDiscount":0.05,"bundleDiscount":0,"includedServices":[],"exteriorWindowFrequency":4,"interiorWindowFrequency":0,"additionalServicesFrequency":1},"better":{"name":"Better","label":"Consistent Window Care","description":"Complete window care with interior cleaning included","addonDiscount":0.1,"bundleDiscount":0.05,"includedServices":["gutter_cleaning"],"exteriorWindowFrequency":4,"interiorWindowFrequency":1,"additionalServicesFrequency":1},"best":{"name":"Best","label":"Total Window & Home Care","description":"Maximum coverage with frequent interior cleaning and premium perks","addonDiscount":0.15,"bundleDiscount":0.1,"includedServices":["gutter_cleaning","house_wash"],"exteriorWindowFrequency":4,"interiorWindowFrequency":2,"additionalServicesFrequency":2}},"bundle_rules":{"minimumTierBuffer":25,"tierOrder":["good","better","best"],"planDownPaymentPercent":20,"planMonthlyInstallments":11,"roofBaseIncludedTiers":["best"],"alwaysAddonServices":["driveway_cleaning","pressure_washing"]}}$klamath_pricing$::jsonb,
  'dfw-canonical-pricing-snapshot@9fd53d4458996f352e99dd6fbc679c435ee83793'
);

DO $phase1c_postflight$
BEGIN
  IF (
    SELECT count(*)
    FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000003'
      AND slug = 'bluladder-klamath'
      AND display_name = 'BluLadder Klamath'
      AND status = 'provisioning'
      AND is_legacy_default = false
  ) <> 1 THEN
    RAISE EXCEPTION 'Klamath provisioning organization is not exact';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organization_customer_sites
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
      AND tenant_key = 'bluladder-klamath'
      AND canonical_hostname = 'klamath.bluladder.com'
      AND mapping_status = 'provisioning'
      AND runtime_routing_enabled = false
      AND site_published = false
      AND customer_traffic_allowed = false
  ) <> 1 THEN
    RAISE EXCEPTION 'Klamath customer site is not safely provisioned';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organization_resolution_keys
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
      AND key_type = 'hostname'
      AND status = 'disabled'
  ) <> 1 THEN
    RAISE EXCEPTION 'Klamath hostname resolution key is not exactly disabled';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organization_territories
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
      AND status = 'inactive'
  ) <> 2 THEN
    RAISE EXCEPTION 'Klamath inactive territory count is not exact';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organization_services
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
      AND status = 'inactive'
      AND availability = 'manual_review'
  ) <> 6 THEN
    RAISE EXCEPTION 'Klamath inactive service count is not exact';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organization_pricing_profiles
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
      AND profile_key = 'bluladder-klamath-pricing-draft'
      AND version = 1
      AND status = 'draft'
      AND runtime_enabled = false
  ) <> 1 THEN
    RAISE EXCEPTION 'Klamath draft pricing profile is not exact';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_contacts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
  ) OR EXISTS (
    SELECT 1
    FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'Klamath contacts or memberships were unexpectedly provisioned';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_resolution_keys
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
      AND key_type IN (
        'jobber_account',
        'callrail_number',
        'email_address',
        'vapi_assistant',
        'vapi_phone_number'
      )
  ) THEN
    RAISE EXCEPTION 'Klamath provider identity was unexpectedly provisioned';
  END IF;
END
$phase1c_postflight$;

DO $phase1c_privilege_postflight$
DECLARE
  target_table text;
  current_privileges text[];
  expected_crud_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'SELECT', 'UPDATE'
  ];
  expected_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ];
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'organization_customer_sites',
    'organization_pricing_profiles'
  ]
  LOOP
    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'authenticated';

    IF current_privileges <> expected_crud_privileges THEN
      RAISE EXCEPTION 'Phase 1C authenticated privileges are not exact on %',
        target_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(ARRAY['REFERENCES', 'TRIGGER', 'TRUNCATE'])
        AS privileges(privilege_name)
      WHERE has_table_privilege(
        'authenticated',
        format('public.%I', target_table),
        privilege_name
      )
    ) THEN
      RAISE EXCEPTION 'Phase 1C authenticated role retains excess access on %',
        target_table;
    END IF;

    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'anon';

    IF current_privileges <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'Phase 1C anonymous access is not empty on %', target_table;
    END IF;

    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'service_role';

    IF current_privileges <> expected_all_privileges THEN
      RAISE EXCEPTION 'Phase 1C service-role access changed on %', target_table;
    END IF;
  END LOOP;
END
$phase1c_privilege_postflight$;

COMMIT;
