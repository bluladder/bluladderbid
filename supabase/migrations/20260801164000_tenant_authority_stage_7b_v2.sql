-- Issue #7, Stage 7B v2: server-derived session authority and lineage repair.
-- Repository migration only. Do not apply before the hosted aggregate stop
-- gates in docs/architecture/tenant-stage-7b-v2-hosted-preflight.md pass.

BEGIN;

-- Freeze every lineage participant before evaluating stop gates. Without this
-- lock, a concurrent legacy writer could create a new mismatch after the gate
-- query but before the replacement triggers are installed.
LOCK TABLE
  public.customers,
  public.properties,
  public.quotes,
  public.bookings,
  public.quote_sessions,
  public.chat_conversations
IN SHARE ROW EXCLUSIVE MODE;

-- Hosted reconciliation found an unresolved first-wave quote. Make the
-- release gate executable: this migration must not proceed until a separately
-- approved data-remediation step has restored explicit parent lineage.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.quotes q
    LEFT JOIN public.customers c ON c.id = q.customer_id
    LEFT JOIN public.properties p ON p.id = q.property_id
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT candidate) AS organization_count
      FROM unnest(ARRAY[q.organization_id, c.organization_id, p.organization_id])
        candidate
      WHERE candidate IS NOT NULL
    ) evidence
    WHERE evidence.organization_count > 1
       OR (q.customer_id IS NOT NULL AND c.organization_id IS NULL)
       OR (q.property_id IS NOT NULL AND p.organization_id IS NULL)
       OR (
         q.organization_id IS NULL
         AND (c.organization_id IS NOT NULL OR p.organization_id IS NOT NULL)
       )
  ) THEN
    RAISE EXCEPTION 'first-wave quote organization reconciliation required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN public.customers c ON c.id = b.customer_id
    LEFT JOIN public.properties p ON p.id = b.property_id
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT candidate) AS organization_count
      FROM unnest(ARRAY[b.organization_id, c.organization_id, p.organization_id])
        candidate
      WHERE candidate IS NOT NULL
    ) evidence
    WHERE evidence.organization_count > 1
       OR (b.customer_id IS NOT NULL AND c.organization_id IS NULL)
       OR (b.property_id IS NOT NULL AND p.organization_id IS NULL)
       OR (
         b.organization_id IS NULL
         AND (c.organization_id IS NOT NULL OR p.organization_id IS NOT NULL)
       )
  ) THEN
    RAISE EXCEPTION 'first-wave booking organization reconciliation required';
  END IF;
END
$$;

-- A parented quote/booking may inherit organization authority, but it may not
-- invent it, disagree with it, or keep a null organization when the parent is
-- already scoped. This replaces the original compatibility trigger without
-- changing historical rows.
CREATE OR REPLACE FUNCTION public.enforce_first_wave_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  candidate_organizations uuid[];
  parent_was_requested boolean := false;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    parent_was_requested := true;
  END IF;
  IF NEW.property_id IS NOT NULL THEN
    parent_was_requested := true;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT candidate
    FROM (
      SELECT c.organization_id AS candidate
      FROM public.customers c
      WHERE c.id = NEW.customer_id
      UNION ALL
      SELECT p.organization_id AS candidate
      FROM public.properties p
      WHERE p.id = NEW.property_id
    ) candidates
    WHERE candidate IS NOT NULL
  ) INTO candidate_organizations;

  IF cardinality(candidate_organizations) > 1 THEN
    RAISE EXCEPTION 'organization lineage conflict'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.organization_id IS NULL AND cardinality(candidate_organizations) = 1 THEN
    NEW.organization_id := candidate_organizations[1];
  ELSIF NEW.organization_id IS NOT NULL
        AND cardinality(candidate_organizations) = 1
        AND NEW.organization_id <> candidate_organizations[1] THEN
    RAISE EXCEPTION 'organization lineage mismatch'
      USING ERRCODE = '23514';
  ELSIF parent_was_requested
        AND cardinality(candidate_organizations) = 0 THEN
    RAISE EXCEPTION 'organization parent lineage missing'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_first_wave_organization_lineage()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_bookings_organization_lineage
  ON public.bookings;
CREATE TRIGGER enforce_bookings_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_id, property_id
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_first_wave_organization_lineage();

DROP TRIGGER IF EXISTS enforce_quotes_organization_lineage ON public.quotes;
CREATE TRIGGER enforce_quotes_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_id, property_id
  ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_first_wave_organization_lineage();

-- Conversations and quote sessions are capability/session roots for voice,
-- web, chat, and SMS. Keep the columns nullable while legacy rows have no
-- provable parent; no database default and no blanket DFW backfill is allowed.
ALTER TABLE public.quote_sessions
  ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS organization_id uuid;

CREATE INDEX IF NOT EXISTS quote_sessions_organization_id_idx
  ON public.quote_sessions (organization_id);
CREATE INDEX IF NOT EXISTS chat_conversations_organization_id_idx
  ON public.chat_conversations (organization_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_sessions_organization_id_fkey'
      AND conrelid = 'public.quote_sessions'::regclass
  ) THEN
    ALTER TABLE public.quote_sessions
      ADD CONSTRAINT quote_sessions_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_conversations_organization_id_fkey'
      AND conrelid = 'public.chat_conversations'::regclass
  ) THEN
    ALTER TABLE public.chat_conversations
      ADD CONSTRAINT chat_conversations_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
      NOT VALID;
  END IF;
END
$$;

-- Stop instead of guessing if the currently linked parents disagree.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.quote_sessions qs
    LEFT JOIN public.customers c ON c.id = qs.customer_id
    LEFT JOIN public.properties p ON p.id = qs.property_id
    LEFT JOIN public.quotes q ON q.id = qs.quote_id
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT candidate) AS organization_count
      FROM unnest(ARRAY[
        qs.organization_id,
        c.organization_id,
        p.organization_id,
        q.organization_id
      ])
        candidate
      WHERE candidate IS NOT NULL
    ) evidence
    WHERE evidence.organization_count > 1
  ) THEN
    RAISE EXCEPTION 'quote session organization backfill conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.chat_conversations cc
    LEFT JOIN public.customers c ON c.id = cc.customer_id
    LEFT JOIN public.customers confirmed
      ON confirmed.id = cc.confirmed_email_customer_id
    LEFT JOIN public.properties p ON p.id = cc.property_id
    LEFT JOIN public.quote_sessions qs ON qs.id = cc.quote_session_id
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT candidate) AS organization_count
      FROM unnest(ARRAY[
        cc.organization_id,
        c.organization_id,
        confirmed.organization_id,
        p.organization_id,
        qs.organization_id
      ]) candidate
      WHERE candidate IS NOT NULL
    ) evidence
    WHERE evidence.organization_count > 1
  ) THEN
    RAISE EXCEPTION 'conversation organization backfill conflict';
  END IF;
END
$$;

WITH evidence AS (
  SELECT qs.id, (array_agg(DISTINCT candidate))[1] AS organization_id
  FROM public.quote_sessions qs
  LEFT JOIN public.customers c ON c.id = qs.customer_id
  LEFT JOIN public.properties p ON p.id = qs.property_id
  LEFT JOIN public.quotes q ON q.id = qs.quote_id
  CROSS JOIN LATERAL unnest(
    ARRAY[
      qs.organization_id,
      c.organization_id,
      p.organization_id,
      q.organization_id
    ]
  ) candidate
  WHERE candidate IS NOT NULL
  GROUP BY qs.id
  HAVING count(DISTINCT candidate) = 1
)
UPDATE public.quote_sessions qs
SET organization_id = evidence.organization_id
FROM evidence
WHERE qs.id = evidence.id
  AND qs.organization_id IS NULL;

WITH evidence AS (
  SELECT cc.id, (array_agg(DISTINCT candidate))[1] AS organization_id
  FROM public.chat_conversations cc
  LEFT JOIN public.customers c ON c.id = cc.customer_id
  LEFT JOIN public.customers confirmed
    ON confirmed.id = cc.confirmed_email_customer_id
  LEFT JOIN public.properties p ON p.id = cc.property_id
  LEFT JOIN public.quote_sessions qs ON qs.id = cc.quote_session_id
  CROSS JOIN LATERAL unnest(ARRAY[
    cc.organization_id,
    c.organization_id,
    confirmed.organization_id,
    p.organization_id,
    qs.organization_id
  ]) candidate
  WHERE candidate IS NOT NULL
  GROUP BY cc.id
  HAVING count(DISTINCT candidate) = 1
)
UPDATE public.chat_conversations cc
SET organization_id = evidence.organization_id
FROM evidence
WHERE cc.id = evidence.id
  AND cc.organization_id IS NULL;

ALTER TABLE public.quote_sessions
  VALIDATE CONSTRAINT quote_sessions_organization_id_fkey;
ALTER TABLE public.chat_conversations
  VALIDATE CONSTRAINT chat_conversations_organization_id_fkey;

CREATE OR REPLACE FUNCTION public.enforce_session_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  candidate_organizations uuid[];
  parent_was_requested boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'quote_sessions' THEN
    parent_was_requested := NEW.customer_id IS NOT NULL
      OR NEW.property_id IS NOT NULL
      OR NEW.quote_id IS NOT NULL;
    SELECT ARRAY(
      SELECT DISTINCT candidate
      FROM (
        SELECT c.organization_id AS candidate
        FROM public.customers c WHERE c.id = NEW.customer_id
        UNION ALL
        SELECT p.organization_id AS candidate
        FROM public.properties p WHERE p.id = NEW.property_id
        UNION ALL
        SELECT q.organization_id AS candidate
        FROM public.quotes q WHERE q.id = NEW.quote_id
      ) candidates
      WHERE candidate IS NOT NULL
    ) INTO candidate_organizations;
  ELSIF TG_TABLE_NAME = 'chat_conversations' THEN
    parent_was_requested := NEW.customer_id IS NOT NULL
      OR NEW.confirmed_email_customer_id IS NOT NULL
      OR NEW.property_id IS NOT NULL
      OR NEW.quote_session_id IS NOT NULL;
    SELECT ARRAY(
      SELECT DISTINCT candidate
      FROM (
        SELECT c.organization_id AS candidate
        FROM public.customers c WHERE c.id = NEW.customer_id
        UNION ALL
        SELECT c.organization_id AS candidate
        FROM public.customers c
        WHERE c.id = NEW.confirmed_email_customer_id
        UNION ALL
        SELECT p.organization_id AS candidate
        FROM public.properties p WHERE p.id = NEW.property_id
        UNION ALL
        SELECT qs.organization_id AS candidate
        FROM public.quote_sessions qs WHERE qs.id = NEW.quote_session_id
      ) candidates
      WHERE candidate IS NOT NULL
    ) INTO candidate_organizations;
  ELSE
    RAISE EXCEPTION 'unsupported organization lineage table';
  END IF;

  IF cardinality(candidate_organizations) > 1 THEN
    RAISE EXCEPTION 'organization lineage conflict'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id IS NULL AND cardinality(candidate_organizations) = 1 THEN
    NEW.organization_id := candidate_organizations[1];
  ELSIF NEW.organization_id IS NOT NULL
        AND cardinality(candidate_organizations) = 1
        AND NEW.organization_id <> candidate_organizations[1] THEN
    RAISE EXCEPTION 'organization lineage mismatch'
      USING ERRCODE = '23514';
  -- Preserve the old-runtime/new-schema transition: a null-owned session may
  -- link to a null-owned parent until trusted mappings and the dependent
  -- runtime are released. A non-null organization still cannot be invented
  -- from an unscoped parent.
  ELSIF parent_was_requested
        AND cardinality(candidate_organizations) = 0
        AND NEW.organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'organization parent lineage missing'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_session_organization_lineage()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_quote_sessions_organization_lineage
  ON public.quote_sessions;
CREATE TRIGGER enforce_quote_sessions_organization_lineage
  BEFORE INSERT OR UPDATE OF
    organization_id, customer_id, property_id, quote_id
  ON public.quote_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_session_organization_lineage();

DROP TRIGGER IF EXISTS enforce_chat_conversations_organization_lineage
  ON public.chat_conversations;
CREATE TRIGGER enforce_chat_conversations_organization_lineage
  BEFORE INSERT OR UPDATE OF
    organization_id, customer_id, confirmed_email_customer_id,
    property_id, quote_session_id
  ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_session_organization_lineage();

-- Existing permissive purpose/role policies must also pass this restrictive
-- tenant boundary. Null compatibility is limited to an explicit platform
-- administrator and is never runtime authority.
DROP POLICY IF EXISTS "Tenant boundary quote sessions"
  ON public.quote_sessions;
CREATE POLICY "Tenant boundary quote sessions"
  ON public.quote_sessions AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (
      organization_id IS NOT NULL
      AND tenant_security.current_organization_role(organization_id)
        IS NOT NULL
    )
    OR (
      organization_id IS NULL
      AND tenant_security.is_platform_organization_admin()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id)
      IS NOT NULL
  );

DROP POLICY IF EXISTS "Tenant boundary chat conversations"
  ON public.chat_conversations;
CREATE POLICY "Tenant boundary chat conversations"
  ON public.chat_conversations AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (
      organization_id IS NOT NULL
      AND tenant_security.current_organization_role(organization_id)
        IS NOT NULL
    )
    OR (
      organization_id IS NULL
      AND tenant_security.is_platform_organization_admin()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id)
      IS NOT NULL
  );

-- Data API access is explicit. Service-role callers still require application
-- predicates because BYPASSRLS is not tenant authority.
REVOKE ALL ON public.quote_sessions, public.chat_conversations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.quote_sessions TO authenticated;
GRANT SELECT, UPDATE ON public.chat_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.quote_sessions, public.chat_conversations TO service_role;

-- Remove default-privilege spillover from the Stage 7B control plane without
-- changing its approved RLS behavior.
REVOKE ALL
  ON public.organizations,
     public.organization_memberships,
     public.organization_resolution_keys
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.organization_memberships,
     public.organization_resolution_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.organizations,
     public.organization_memberships,
     public.organization_resolution_keys TO service_role;

-- Every current Data API view remains invoker-secured and read-only. Preserve
-- the existing view-level eligibility/technician grants while leaving actual
-- row visibility to each underlying table's RLS policy.
ALTER VIEW public.admin_marketing_funnel SET (security_invoker = true);
ALTER VIEW public.eligibility_rules_public SET (security_invoker = true);
ALTER VIEW public.property_facts_current SET (security_invoker = true);
ALTER VIEW public.technicians_public SET (security_invoker = true);

REVOKE ALL
  ON public.admin_marketing_funnel,
     public.eligibility_rules_public,
     public.property_facts_current,
     public.technicians_public
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admin_marketing_funnel,
  public.property_facts_current TO authenticated, service_role;
GRANT SELECT ON public.eligibility_rules_public,
  public.technicians_public TO anon, authenticated, service_role;

COMMIT;
