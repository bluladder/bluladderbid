-- Read-only postflight for BluLadder Klamath Phase 1F portal tenant lineage.
-- Every query returns schema/configuration counts only.

BEGIN TRANSACTION READ ONLY;

-- All five tables must have one non-null organization UUID with a validated FK.
SELECT
  column_state.table_name,
  column_state.is_nullable,
  count(constraint_state.constraint_name) FILTER (
    WHERE constraint_state.constraint_type = 'FOREIGN KEY'
      AND constraint_state.constraint_name LIKE '%organization_id_fkey'
  ) AS organization_fk_count
FROM information_schema.columns column_state
LEFT JOIN information_schema.table_constraints constraint_state
  ON constraint_state.table_schema = column_state.table_schema
 AND constraint_state.table_name = column_state.table_name
WHERE column_state.table_schema = 'public'
  AND column_state.column_name = 'organization_id'
  AND column_state.table_name IN (
    'customer_accounts',
    'customer_portal_sessions',
    'customer_verification_challenges',
    'customer_account_match_issues',
    'customer_auth_link_events'
  )
GROUP BY column_state.table_name, column_state.is_nullable
ORDER BY column_state.table_name;

-- Existing accounts and sessions must exactly match their parent lineage.
SELECT
  count(*) AS customer_account_count,
  count(*) FILTER (
    WHERE account.organization_id <> customer.organization_id
  ) AS account_lineage_mismatch_count,
  count(*) FILTER (
    WHERE account.organization_id =
      'b1addf00-0000-4000-8000-000000000001'
  ) AS dfw_account_count,
  count(*) FILTER (
    WHERE account.organization_id =
      'b1addf00-0000-4000-8000-000000000003'
  ) AS klamath_account_count
FROM public.customer_accounts account
JOIN public.customers customer ON customer.id = account.customer_id;

SELECT
  count(*) AS portal_session_count,
  count(*) FILTER (
    WHERE session.organization_id <> account.organization_id
  ) AS session_lineage_mismatch_count,
  count(*) FILTER (
    WHERE session.organization_id =
      'b1addf00-0000-4000-8000-000000000003'
  ) AS klamath_session_count
FROM public.customer_portal_sessions session
JOIN public.customer_accounts account
  ON account.id = session.customer_account_id;

-- Historical compatibility rows must be DFW-scoped; Klamath remains empty.
SELECT
  source_table,
  total_count,
  dfw_count,
  klamath_count,
  missing_count
FROM (
  SELECT
    'customer_verification_challenges'::text AS source_table,
    count(*) AS total_count,
    count(*) FILTER (WHERE organization_id =
      'b1addf00-0000-4000-8000-000000000001') AS dfw_count,
    count(*) FILTER (WHERE organization_id =
      'b1addf00-0000-4000-8000-000000000003') AS klamath_count,
    count(*) FILTER (WHERE organization_id IS NULL) AS missing_count
  FROM public.customer_verification_challenges
  UNION ALL
  SELECT
    'customer_account_match_issues', count(*),
    count(*) FILTER (WHERE organization_id =
      'b1addf00-0000-4000-8000-000000000001'),
    count(*) FILTER (WHERE organization_id =
      'b1addf00-0000-4000-8000-000000000003'),
    count(*) FILTER (WHERE organization_id IS NULL)
  FROM public.customer_account_match_issues
  UNION ALL
  SELECT
    'customer_auth_link_events', count(*),
    count(*) FILTER (WHERE organization_id =
      'b1addf00-0000-4000-8000-000000000001'),
    count(*) FILTER (WHERE organization_id =
      'b1addf00-0000-4000-8000-000000000003'),
    count(*) FILTER (WHERE organization_id IS NULL)
  FROM public.customer_auth_link_events
) evidence
ORDER BY source_table;

-- Organization-scoped identity uniqueness must replace all three global keys;
-- the session-token hash remains globally unique.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'customers_organization_email_key',
    'customer_accounts_organization_verified_phone_key',
    'customer_accounts_organization_verified_email_key',
    'customer_accounts_organization_auth_user_key',
    'customer_portal_sessions_session_token_hash_key'
  )
ORDER BY indexname;

SELECT count(*) AS retired_global_account_identity_key_count
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'customers_email_key',
    'customer_accounts_verified_phone_key',
    'ux_customer_accounts_verified_email',
    'customer_accounts_auth_user_id_key'
  );

-- Exact parent-lineage triggers must be installed and enabled.
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'enforce_customer_account_organization_lineage',
    'enforce_portal_session_organization_lineage'
  )
ORDER BY table_name, event_manipulation;

-- RLS remains enabled and each table has the reviewed tenant-aware policies.
SELECT
  class.relname AS table_name,
  class.relrowsecurity AS rls_enabled,
  count(policy.policyname) AS policy_count
FROM pg_class class
JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
LEFT JOIN pg_policies policy
  ON policy.schemaname = namespace.nspname
 AND policy.tablename = class.relname
WHERE namespace.nspname = 'public'
  AND class.relname IN (
    'customer_accounts',
    'customer_portal_sessions',
    'customer_verification_challenges',
    'customer_account_match_issues',
    'customer_auth_link_events'
  )
GROUP BY class.relname, class.relrowsecurity
ORDER BY class.relname;

-- Klamath remains provisioning and empty; no launch surface is activated.
SELECT
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000003'
      AND status = 'provisioning') AS provisioning_organization_count,
  (SELECT count(*) FROM public.customers
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS customer_count,
  (SELECT count(*) FROM public.customer_accounts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS account_count,
  (SELECT count(*) FROM public.customer_portal_sessions
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS session_count;

ROLLBACK;
