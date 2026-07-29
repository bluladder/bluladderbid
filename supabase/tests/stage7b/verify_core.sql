\set ON_ERROR_STOP on

DO $$
DECLARE
  total_rows integer;
  null_rows integer;
  mismatch_rows integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.customers) +
    (SELECT count(*) FROM public.properties) +
    (SELECT count(*) FROM public.quotes) +
    (SELECT count(*) FROM public.bookings)
  INTO total_rows;
  IF total_rows <> 30 THEN
    RAISE EXCEPTION 'expected 30 first-wave rows, found %', total_rows;
  END IF;

  SELECT
    (SELECT count(*) FROM public.customers WHERE organization_id IS NULL) +
    (SELECT count(*) FROM public.properties WHERE organization_id IS NULL) +
    (SELECT count(*) FROM public.quotes WHERE organization_id IS NULL) +
    (SELECT count(*) FROM public.bookings WHERE organization_id IS NULL)
  INTO null_rows;
  IF null_rows <> 0 THEN
    RAISE EXCEPTION 'expected zero first-wave nulls, found %', null_rows;
  END IF;

  SELECT count(*) INTO mismatch_rows
  FROM (
    SELECT b.id
    FROM public.bookings b
    JOIN public.customers c ON c.id = b.customer_id
    WHERE b.organization_id IS DISTINCT FROM c.organization_id
    UNION ALL
    SELECT q.id
    FROM public.quotes q
    JOIN public.customers c ON c.id = q.customer_id
    WHERE q.organization_id IS DISTINCT FROM c.organization_id
  ) mismatches;
  IF mismatch_rows <> 0 THEN
    RAISE EXCEPTION 'expected zero lineage mismatches, found %', mismatch_rows;
  END IF;

  IF (
    SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND status = 'active'
      AND is_legacy_default
  ) <> 1 THEN
    RAISE EXCEPTION 'canonical DFW organization invariant failed';
  END IF;

  IF (
    SELECT count(*) FROM public.organizations
    WHERE slug ILIKE '%oregon%' AND status = 'active'
  ) <> 0 THEN
    RAISE EXCEPTION 'Oregon was activated';
  END IF;

  IF (
    SELECT count(*) FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      AND role = 'admin' AND status = 'active'
  ) <> 1 THEN
    RAISE EXCEPTION 'expected one DFW administrator membership';
  END IF;

  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conname IN (
      'customers_organization_id_fkey',
      'properties_organization_id_fkey',
      'quotes_organization_id_fkey',
      'bookings_organization_id_fkey'
    ) AND convalidated
  ) <> 4 THEN
    RAISE EXCEPTION 'expected four validated first-wave foreign keys';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND (
        (event_object_table = 'bookings'
          AND trigger_name = 'enforce_bookings_organization_lineage')
        OR
        (event_object_table = 'quotes'
          AND trigger_name = 'enforce_quotes_organization_lineage')
      )
  ) <> 4 THEN
    -- information_schema reports one row per trigger event. Each trigger covers
    -- INSERT and UPDATE, so the two triggers produce four rows.
    RAISE EXCEPTION 'expected both first-wave lineage triggers';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN (
        'Members can view active organizations',
        'Members can view memberships in their organizations',
        'Organization admins manage memberships',
        'Organization admins manage resolution keys',
        'Tenant boundary customers',
        'Tenant boundary properties',
        'Tenant boundary quotes',
        'Tenant boundary bookings'
      )
  ) <> 8 THEN
    RAISE EXCEPTION 'expected eight Stage 7B policies';
  END IF;
END $$;

BEGIN;
INSERT INTO public.organizations (
  id, slug, display_name, status, is_legacy_default
) VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'rehearsal-other',
  'Rehearsal Other',
  'provisioning',
  false
);
UPDATE public.customers
SET organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
WHERE id = '10000000-0000-4000-8000-000000000016';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.quotes(id, customer_id, organization_id)
    VALUES (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '10000000-0000-4000-8000-000000000016',
      'b1addf00-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-organization quote unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END $$;
ROLLBACK;
