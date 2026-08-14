#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_PHASE1F_DATABASE_URL:?set BLULADDER_KLAMATH_PHASE1F_DATABASE_URL}"

psql_args=(
  "${BLULADDER_KLAMATH_PHASE1F_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

psql "${psql_args[@]}" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  is_legacy_default boolean NOT NULL DEFAULT false
);
CREATE TABLE public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  status text NOT NULL,
  role text NOT NULL
);

CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_admin_level(uuid, text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  email text NOT NULL UNIQUE
);
CREATE TABLE public.customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  verified_phone text UNIQUE,
  verified_email text,
  auth_user_id uuid,
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_accounts_identity_present
    CHECK (verified_phone IS NOT NULL OR verified_email IS NOT NULL)
);
CREATE UNIQUE INDEX ux_customer_accounts_verified_email
  ON public.customer_accounts (verified_email)
  WHERE verified_email IS NOT NULL;
CREATE UNIQUE INDEX customer_accounts_auth_user_id_key
  ON public.customer_accounts (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE TABLE public.customer_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash text NOT NULL UNIQUE,
  customer_account_id uuid NOT NULL REFERENCES public.customer_accounts(id)
    ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.customer_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text,
  recipient_hint text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.customer_account_match_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_customer_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.customer_auth_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_account_match_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_auth_link_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view customer accounts"
  ON public.customer_accounts FOR SELECT TO PUBLIC USING (public.is_admin());
CREATE POLICY "Admins can view portal sessions"
  ON public.customer_portal_sessions FOR SELECT TO PUBLIC USING (public.is_admin());
CREATE POLICY "Admins can view verification challenges"
  ON public.customer_verification_challenges FOR SELECT TO PUBLIC USING (public.is_admin());
CREATE POLICY "Admins can view match issues"
  ON public.customer_account_match_issues FOR SELECT TO PUBLIC USING (public.is_admin());
CREATE POLICY "Admins can update match issues"
  ON public.customer_account_match_issues FOR UPDATE TO PUBLIC USING (public.is_admin());
CREATE POLICY "Admins can view auth link events"
  ON public.customer_auth_link_events FOR SELECT TO PUBLIC USING (public.is_admin());

INSERT INTO public.organizations (id, status, is_legacy_default) VALUES
  ('b1addf00-0000-4000-8000-000000000001', 'active', true),
  ('b1addf00-0000-4000-8000-000000000003', 'provisioning', false);

INSERT INTO public.customers (id, organization_id, email) VALUES
  ('c0000000-0000-4000-8000-000000000001',
   'b1addf00-0000-4000-8000-000000000001', 'dfw@example.test');
INSERT INTO public.customer_accounts (
  id, customer_id, verified_phone, verified_email
) VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  '+10000000000', 'dfw@example.test'
);
INSERT INTO public.customer_portal_sessions (
  session_token_hash, customer_account_id, absolute_expires_at
) VALUES (
  repeat('a', 64), 'a0000000-0000-4000-8000-000000000001', now() + interval '1 hour'
);
INSERT INTO public.customer_verification_challenges (phone_hash)
VALUES (repeat('b', 64));
INSERT INTO public.customer_auth_link_events (customer_id)
VALUES ('c0000000-0000-4000-8000-000000000001');
SQL

psql "${psql_args[@]}" --file \
  supabase/migrations/20260814060000_bluladder_klamath_phase_1f_portal_tenant_lineage.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customer_accounts account
    JOIN public.customers customer ON customer.id = account.customer_id
    WHERE account.organization_id <> customer.organization_id
  ) THEN
    RAISE EXCEPTION 'account lineage mismatch after rehearsal';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.customer_portal_sessions session
    JOIN public.customer_accounts account
      ON account.id = session.customer_account_id
    WHERE session.organization_id <> account.organization_id
  ) THEN
    RAISE EXCEPTION 'session lineage mismatch after rehearsal';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.customer_verification_challenges
    WHERE organization_id <>
      'b1addf00-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'historical challenge compatibility backfill drifted';
  END IF;
END
$$;

BEGIN;
UPDATE public.organizations
SET status = 'active'
WHERE id = 'b1addf00-0000-4000-8000-000000000003';
INSERT INTO public.customers (id, organization_id, email) VALUES (
  'c0000000-0000-4000-8000-000000000003',
  'b1addf00-0000-4000-8000-000000000003',
  'dfw@example.test'
);
INSERT INTO public.customer_accounts (
  id, customer_id, verified_email
) VALUES (
  'a0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000003',
  'dfw@example.test'
);
INSERT INTO public.customer_portal_sessions (
  session_token_hash, customer_account_id, absolute_expires_at
) VALUES (
  repeat('c', 64),
  'a0000000-0000-4000-8000-000000000003',
  now() + interval '1 hour'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_accounts
    WHERE id = 'a0000000-0000-4000-8000-000000000003'
      AND organization_id = 'b1addf00-0000-4000-8000-000000000003'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.customer_portal_sessions
    WHERE session_token_hash = repeat('c', 64)
      AND organization_id = 'b1addf00-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'trigger-derived Klamath lineage failed';
  END IF;

  BEGIN
    INSERT INTO public.customer_accounts (
      organization_id, customer_id, verified_phone
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000003',
      '+10000000001'
    );
    RAISE EXCEPTION 'mismatched account lineage was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;
ROLLBACK;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_phase_1f_portal_tenant_lineage.sql

echo "BluLadder Klamath Phase 1F disposable PostgreSQL rehearsal passed."
