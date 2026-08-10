-- Issue #96: bind every human-transfer/alert recipient to an authoritative
-- organization before the Realtime assistant may use it.
--
-- Historical escalation recipients were DFW-only global configuration. The
-- backfill is allowed only while DFW is the sole active organization; any
-- multi-tenant ambiguity aborts the migration instead of guessing.

BEGIN;

ALTER TABLE public.escalation_recipients
  ADD COLUMN IF NOT EXISTS organization_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.escalation_recipients
    WHERE organization_id IS NULL
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true
    ) OR EXISTS (
      SELECT 1
      FROM public.organizations
      WHERE status = 'active'
        AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid
    ) THEN
      RAISE EXCEPTION
        'escalation recipient organization backfill requires DFW as the sole active organization';
    END IF;

    UPDATE public.escalation_recipients
    SET organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
    WHERE organization_id IS NULL;
  END IF;
END
$$;

ALTER TABLE public.escalation_recipients
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'escalation_recipients_organization_id_fkey'
      AND conrelid = 'public.escalation_recipients'::regclass
  ) THEN
    ALTER TABLE public.escalation_recipients
      ADD CONSTRAINT escalation_recipients_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.escalation_recipients
  VALIDATE CONSTRAINT escalation_recipients_organization_id_fkey;

CREATE INDEX IF NOT EXISTS escalation_recipients_organization_lookup_idx
  ON public.escalation_recipients
  (organization_id, is_enabled, role, verified_at);

-- Exactly one enabled primary operator is permitted for deterministic live
-- transfer. Runtime also requires verified_at; backups are never promoted.
CREATE UNIQUE INDEX IF NOT EXISTS escalation_recipients_one_active_primary_idx
  ON public.escalation_recipients (organization_id)
  WHERE is_enabled = true AND role = 'primary';

DROP POLICY IF EXISTS "Admins manage escalation recipients"
  ON public.escalation_recipients;
DROP POLICY IF EXISTS "Members read escalation recipients"
  ON public.escalation_recipients;
DROP POLICY IF EXISTS "Organization admins manage escalation recipients"
  ON public.escalation_recipients;

CREATE POLICY "Members read escalation recipients"
  ON public.escalation_recipients FOR SELECT TO authenticated
  USING (
    tenant_security.current_organization_role(organization_id) IS NOT NULL
  );

CREATE POLICY "Organization admins manage escalation recipients"
  ON public.escalation_recipients FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = escalation_recipients.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships actor
      WHERE actor.organization_id = escalation_recipients.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

COMMIT;
