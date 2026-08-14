-- Read-only preflight for BluLadder Klamath Phase 1F portal tenant lineage.
-- This file performs no DDL, DML, credential access, provider action, or
-- migration-ledger mutation.

BEGIN TRANSACTION READ ONLY;

-- All eight prerequisites must be present.
SELECT required_table, to_regclass('public.' || required_table) IS NOT NULL AS present
FROM unnest(ARRAY[
  'organizations',
  'organization_memberships',
  'customers',
  'customer_accounts',
  'customer_portal_sessions',
  'customer_verification_challenges',
  'customer_account_match_issues',
  'customer_auth_link_events'
]) AS required_tables(required_table)
ORDER BY required_table;

-- Every result must be zero before first application.
SELECT
  count(*) FILTER (
    WHERE table_name = 'customer_accounts' AND column_name = 'organization_id'
  ) AS account_organization_columns,
  count(*) FILTER (
    WHERE table_name = 'customer_portal_sessions' AND column_name = 'organization_id'
  ) AS session_organization_columns,
  count(*) FILTER (
    WHERE table_name = 'customer_verification_challenges' AND column_name = 'organization_id'
  ) AS challenge_organization_columns,
  count(*) FILTER (
    WHERE table_name = 'customer_account_match_issues' AND column_name = 'organization_id'
  ) AS match_issue_organization_columns,
  count(*) FILTER (
    WHERE table_name = 'customer_auth_link_events' AND column_name = 'organization_id'
  ) AS auth_event_organization_columns
FROM information_schema.columns
WHERE table_schema = 'public';

-- Must return one exact active DFW default and no unexpected default.
SELECT
  count(*) FILTER (
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND status = 'active'
      AND is_legacy_default = true
  ) AS exact_dfw_default_count,
  count(*) FILTER (
    WHERE is_legacy_default
      AND id <> 'b1addf00-0000-4000-8000-000000000001'
  ) AS unexpected_legacy_default_count
FROM public.organizations;

-- The second tenant must remain provisioning with zero customer rows.
SELECT
  count(*) FILTER (
    WHERE id = 'b1addf00-0000-4000-8000-000000000003'
      AND status = 'provisioning'
  ) AS exact_provisioning_klamath_count,
  (SELECT count(*) FROM public.customers
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS klamath_customer_count
FROM public.organizations;

-- Parent lineage must be total and unambiguous.
SELECT
  count(*) AS customer_account_count,
  count(*) FILTER (WHERE customer.id IS NULL) AS missing_customer_count,
  count(*) FILTER (WHERE customer.organization_id IS NULL)
    AS missing_customer_organization_count,
  count(*) FILTER (
    WHERE customer.organization_id <>
      'b1addf00-0000-4000-8000-000000000001'
  ) AS non_dfw_legacy_account_count
FROM public.customer_accounts account
LEFT JOIN public.customers customer ON customer.id = account.customer_id;

SELECT
  count(*) AS portal_session_count,
  count(*) FILTER (WHERE account.id IS NULL) AS missing_account_count,
  count(*) FILTER (WHERE customer.organization_id IS NULL)
    AS missing_parent_organization_count
FROM public.customer_portal_sessions session
LEFT JOIN public.customer_accounts account
  ON account.id = session.customer_account_id
LEFT JOIN public.customers customer ON customer.id = account.customer_id;

-- Aggregate-only legacy counts for the bounded compatibility backfill.
SELECT
  (SELECT count(*) FROM public.customer_verification_challenges)
    AS challenge_count,
  (SELECT count(*) FROM public.customer_account_match_issues)
    AS match_issue_count,
  (SELECT count(*) FROM public.customer_auth_link_events)
    AS auth_event_count;

ROLLBACK;
