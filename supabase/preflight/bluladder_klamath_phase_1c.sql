-- Read-only preflight for the BluLadder Klamath Phase 1C migration.
-- Run only through an approved read-only connection. This file performs no
-- DDL, DML, credential access, provider action, or migration-ledger repair.

BEGIN TRANSACTION READ ONLY;

-- Must return seven rows, each with present=true.
SELECT required_table, to_regclass('public.' || required_table) IS NOT NULL AS present
FROM unnest(ARRAY[
  'organizations',
  'organization_memberships',
  'organization_settings',
  'organization_contacts',
  'organization_territories',
  'organization_services',
  'organization_resolution_keys'
]) AS required_tables(required_table)
ORDER BY required_table;

-- Each Stage 8A table must show exactly authenticated CRUD privileges. Any
-- REFERENCES, TRIGGER, or TRUNCATE result blocks Phase 1C.
SELECT
  table_name,
  array_agg(privilege_type::text ORDER BY privilege_type::text)
    AS authenticated_privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  )
  AND grantee = 'authenticated'
GROUP BY table_name
ORDER BY table_name;

-- Must return false. Hardened hosted RLS uses direct membership predicates and
-- intentionally does not expose the former public SECURITY DEFINER helper.
SELECT to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL
  AS obsolete_public_membership_helper_present;

-- Must return false before first application.
SELECT
  to_regclass('public.organization_customer_sites') IS NOT NULL
    AS customer_sites_table_exists,
  to_regclass('public.organization_pricing_profiles') IS NOT NULL
    AS pricing_profiles_table_exists;

-- Each count must be zero. Values are identifiers, not customer/provider data.
SELECT
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000003'
       OR lower(slug) = 'bluladder-klamath') AS organization_identity_count,
  (SELECT count(*) FROM public.organization_resolution_keys
    WHERE key_type = 'hostname'
      AND key_hash =
        '0ef6fcf28e127279570a272e667e488bbda76191b99d204e78f4d936343a4c77')
    AS hostname_identity_count;

-- Must return one DFW legacy default and zero other legacy defaults. This does
-- not select contact, customer, credential, message, or provider values.
SELECT
  count(*) FILTER (WHERE is_legacy_default) AS legacy_default_count,
  count(*) FILTER (
    WHERE is_legacy_default
      AND id <> 'b1addf00-0000-4000-8000-000000000001'
  ) AS unexpected_legacy_default_count
FROM public.organizations;

ROLLBACK;
