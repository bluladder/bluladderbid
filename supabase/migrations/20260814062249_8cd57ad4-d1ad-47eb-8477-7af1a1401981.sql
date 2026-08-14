-- BluLadder Klamath Phase 1F: tenant lineage for customer portal identity.
--
-- This migration is intentionally additive and fail-closed. It preserves the
-- exact historical DFW account/session behavior while making organization
-- authority explicit on portal identity, challenge, and audit rows. It does
-- not activate Klamath, publish a site, create a customer, send a message, or
-- configure a provider.

BEGIN;

LOCK TABLE
  public.customers,
  public.customer_accounts,
  public.customer_portal_sessions,
  public.customer_verification_challenges,
  public.customer_account_match_issues,
  public.customer_auth_link_events
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL THEN
    RAISE EXCEPTION 'organization foundation is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND status = 'active'
      AND is_legacy_default = true
  ) THEN
    RAISE EXCEPTION 'exact active DFW legacy organization is unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_accounts ca
    LEFT JOIN public.customers c ON c.id = ca.customer_id
    WHERE c.id IS NULL OR c.organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'customer account parent organization reconciliation required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_portal_sessions session
    LEFT JOIN public.customer_accounts account
      ON account.id = session.customer_account_id
    LEFT JOIN public.customers customer ON customer.id = account.customer_id
    WHERE account.id IS NULL OR customer.organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'portal session parent organization reconciliation required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customers
    GROUP BY organization_id, lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'organization-scoped customer email reconciliation required';
  END IF;

  -- Klamath remains provisioning and has no customer traffic. Historical
  -- parentless challenge/audit rows therefore belong to the reviewed DFW-only
  -- compatibility era; stop rather than make that inference after activation.
  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000003'
      AND status <> 'provisioning'
  ) OR EXISTS (
    SELECT 1 FROM public.customers
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'Klamath customer traffic must remain absent for compatibility backfill';
  END IF;
END
$$;

ALTER TABLE public.customer_accounts
  ADD COLUMN organization_id uuid;
ALTER TABLE public.customer_portal_sessions
  ADD COLUMN organization_id uuid;
ALTER TABLE public.customer_verification_challenges
  ADD COLUMN organization_id uuid;
ALTER TABLE public.customer_account_match_issues
  ADD COLUMN organization_id uuid;
ALTER TABLE public.customer_auth_link_events
  ADD COLUMN organization_id uuid;

UPDATE public.customer_accounts account
SET organization_id = customer.organization_id
FROM public.customers customer
WHERE customer.id = account.customer_id;

UPDATE public.customer_portal_sessions session
SET organization_id = account.organization_id
FROM public.customer_accounts account
WHERE account.id = session.customer_account_id;

-- Challenges have no customer parent. All existing rows predate the second
-- tenant and are covered by the DFW-only stop gate above.
UPDATE public.customer_verification_challenges
SET organization_id = 'b1addf00-0000-4000-8000-000000000001';

UPDATE public.customer_account_match_issues issue
SET organization_id = COALESCE(
  (
    SELECT customer.organization_id
    FROM public.customers customer
    WHERE customer.id = ANY(issue.candidate_customer_ids)
    ORDER BY customer.organization_id
    LIMIT 1
  ),
  'b1addf00-0000-4000-8000-000000000001'
);

UPDATE public.customer_auth_link_events event
SET organization_id = customer.organization_id
FROM public.customers customer
WHERE customer.id = event.customer_id;

UPDATE public.customer_auth_link_events
SET organization_id = 'b1addf00-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customer_account_match_issues issue
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT customer.organization_id) AS organization_count
      FROM public.customers customer
      WHERE customer.id = ANY(issue.candidate_customer_ids)
    ) evidence
    WHERE evidence.organization_count > 1
  ) THEN
    RAISE EXCEPTION 'customer account match issue crosses organizations';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_accounts WHERE organization_id IS NULL
    UNION ALL
    SELECT 1 FROM public.customer_portal_sessions WHERE organization_id IS NULL
    UNION ALL
    SELECT 1 FROM public.customer_verification_challenges WHERE organization_id IS NULL
    UNION ALL
    SELECT 1 FROM public.customer_account_match_issues WHERE organization_id IS NULL
    UNION ALL
    SELECT 1 FROM public.customer_auth_link_events WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'portal organization backfill is incomplete';
  END IF;
END
$$;

ALTER TABLE public.customer_accounts
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT customer_accounts_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.customer_portal_sessions
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT customer_portal_sessions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.customer_verification_challenges
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT customer_verification_challenges_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.customer_account_match_issues
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT customer_account_match_issues_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.customer_auth_link_events
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT customer_auth_link_events_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id);

CREATE UNIQUE INDEX customers_organization_id_id_key
  ON public.customers (organization_id, id);
CREATE UNIQUE INDEX customer_accounts_organization_id_id_key
  ON public.customer_accounts (organization_id, id);

ALTER TABLE public.customer_accounts
  ADD CONSTRAINT customer_accounts_organization_customer_fkey
  FOREIGN KEY (organization_id, customer_id)
  REFERENCES public.customers (organization_id, id);
ALTER TABLE public.customer_portal_sessions
  ADD CONSTRAINT customer_portal_sessions_organization_account_fkey
  FOREIGN KEY (organization_id, customer_account_id)
  REFERENCES public.customer_accounts (organization_id, id);

CREATE INDEX customer_accounts_organization_id_idx
  ON public.customer_accounts (organization_id);
CREATE INDEX customer_portal_sessions_organization_id_idx
  ON public.customer_portal_sessions (organization_id);
CREATE INDEX customer_verification_challenges_organization_subject_created_idx
  ON public.customer_verification_challenges (
    organization_id, phone_hash, recipient_hint, created_at DESC
  );
CREATE INDEX customer_account_match_issues_organization_id_idx
  ON public.customer_account_match_issues (organization_id, created_at DESC);
CREATE INDEX customer_auth_link_events_organization_id_idx
  ON public.customer_auth_link_events (organization_id, created_at DESC);

-- Customer identity is organization-scoped. The opaque portal session hash is
-- intentionally still platform-global so one bearer token can resolve to only
-- one session before tenant-owned data is accessed.
ALTER TABLE public.customers
  DROP CONSTRAINT customers_email_key;
ALTER TABLE public.customer_accounts
  DROP CONSTRAINT customer_accounts_verified_phone_key;
DROP INDEX public.ux_customer_accounts_verified_email;
DROP INDEX public.customer_accounts_auth_user_id_key;

CREATE UNIQUE INDEX customers_organization_email_key
  ON public.customers (organization_id, lower(btrim(email)));
CREATE UNIQUE INDEX customer_accounts_organization_verified_phone_key
  ON public.customer_accounts (organization_id, verified_phone)
  WHERE verified_phone IS NOT NULL;
CREATE UNIQUE INDEX customer_accounts_organization_verified_email_key
  ON public.customer_accounts (organization_id, verified_email)
  WHERE verified_email IS NOT NULL;
CREATE UNIQUE INDEX customer_accounts_organization_auth_user_key
  ON public.customer_accounts (organization_id, auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_customer_account_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  parent_organization uuid;
BEGIN
  SELECT customer.organization_id
  INTO parent_organization
  FROM public.customers customer
  WHERE customer.id = NEW.customer_id;

  IF parent_organization IS NULL THEN
    RAISE EXCEPTION 'customer account parent organization missing'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := parent_organization;
  ELSIF NEW.organization_id <> parent_organization THEN
    RAISE EXCEPTION 'customer account organization mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_portal_session_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  parent_organization uuid;
BEGIN
  SELECT account.organization_id
  INTO parent_organization
  FROM public.customer_accounts account
  WHERE account.id = NEW.customer_account_id;

  IF parent_organization IS NULL THEN
    RAISE EXCEPTION 'portal session parent organization missing'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := parent_organization;
  ELSIF NEW.organization_id <> parent_organization THEN
    RAISE EXCEPTION 'portal session organization mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_customer_account_organization_lineage()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_portal_session_organization_lineage()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER enforce_customer_account_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_id
  ON public.customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_account_organization_lineage();
CREATE TRIGGER enforce_portal_session_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_account_id
  ON public.customer_portal_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_session_organization_lineage();

-- Preserve legacy DFW admin visibility exactly, while non-DFW rows require an
-- active organization membership. Service-role functions continue to bypass
-- RLS and enforce their own exact organization predicates.
DROP POLICY IF EXISTS "Admins can view customer accounts"
  ON public.customer_accounts;
CREATE POLICY "Tenant members view customer accounts"
  ON public.customer_accounts FOR SELECT TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND (
        public.is_admin()
        OR public.has_admin_level((SELECT auth.uid()), 'read_only_admin')
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = customer_accounts.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins can view portal sessions"
  ON public.customer_portal_sessions;
CREATE POLICY "Tenant members view portal sessions"
  ON public.customer_portal_sessions FOR SELECT TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND (
        public.is_admin()
        OR public.has_admin_level((SELECT auth.uid()), 'read_only_admin')
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = customer_portal_sessions.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins can view verification challenges"
  ON public.customer_verification_challenges;
CREATE POLICY "Tenant members view verification challenges"
  ON public.customer_verification_challenges FOR SELECT TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND (
        public.is_admin()
        OR public.has_admin_level((SELECT auth.uid()), 'read_only_admin')
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = customer_verification_challenges.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Admins can view match issues"
  ON public.customer_account_match_issues;
DROP POLICY IF EXISTS "Admins can update match issues"
  ON public.customer_account_match_issues;
CREATE POLICY "Tenant members view customer match issues"
  ON public.customer_account_match_issues FOR SELECT TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND (
        public.is_admin()
        OR public.has_admin_level((SELECT auth.uid()), 'read_only_admin')
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = customer_account_match_issues.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );
CREATE POLICY "Tenant admins update customer match issues"
  ON public.customer_account_match_issues FOR UPDATE TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public.is_admin()
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = customer_account_match_issues.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public.is_admin()
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = customer_account_match_issues.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can view auth link events"
  ON public.customer_auth_link_events;
CREATE POLICY "Tenant members view auth link events"
  ON public.customer_auth_link_events FOR SELECT TO authenticated
  USING (
    (
      organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public.has_role((SELECT auth.uid()), 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      JOIN public.organizations tenant ON tenant.id = actor.organization_id
      WHERE actor.organization_id = customer_auth_link_events.organization_id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND tenant.status = 'active'
    )
  );

COMMIT;