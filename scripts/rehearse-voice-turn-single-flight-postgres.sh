#!/usr/bin/env bash
set -euo pipefail

: "${VOICE_TURN_DATABASE_URL:?Set VOICE_TURN_DATABASE_URL to a disposable PostgreSQL database}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
candidate="$repo_root/supabase/release-candidates/voice_turn_single_flight.sql"

psql "$VOICE_TURN_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN CREATE ROLE sandbox_exec NOLOGIN; END IF;
END;
$roles$;
ALTER ROLE service_role BYPASSRLS;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  is_legacy_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.organizations (id, slug, display_name, status)
VALUES ('11111111-1111-4111-8111-111111111111', 'rehearsal', 'Rehearsal', 'active');

-- Reproduce the existing-project defaults observed in production so the
-- release candidate must normalize them explicitly on its two ledger tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO sandbox_exec;
SQL

# This applies the review-only candidate solely inside the disposable CI DB.
psql "$VOICE_TURN_DATABASE_URL" --set=ON_ERROR_STOP=1 --file="$candidate"

psql "$VOICE_TURN_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
SET ROLE service_role;
DO $turns$
DECLARE
  v text;
  org constant uuid := '11111111-1111-4111-8111-111111111111';
  n constant uuid := '20000000-0000-4000-8000-000000000001';
  n1 constant uuid := '20000000-0000-4000-8000-000000000002';
  token_a constant uuid := '30000000-0000-4000-8000-000000000001';
  token_b constant uuid := '30000000-0000-4000-8000-000000000002';
BEGIN
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-order',n,1,repeat('a',64),token_a);
  IF v <> 'acquired' THEN RAISE EXCEPTION 'initial N claim: %', v; END IF;
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-order',n,1,repeat('a',64),token_a);
  IF v <> 'acquired' THEN RAISE EXCEPTION 'same-token live retry: %', v; END IF;
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-order',n,1,repeat('a',64),token_b);
  IF v <> 'wait' THEN RAISE EXCEPTION 'different-token duplicate: %', v; END IF;
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-order',n1,2,repeat('b',64),token_b);
  IF v <> 'wait' THEN RAISE EXCEPTION 'N+1 did not wait: %', v; END IF;
  PERFORM public.complete_voice_turn(org,'call-order',n);
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-order',n1,2,repeat('b',64),token_b);
  IF v <> 'acquired' THEN RAISE EXCEPTION 'N+1 did not acquire after N: %', v; END IF;
  PERFORM public.complete_voice_turn(org,'call-order',n1);
  IF public.is_authoritative_voice_turn(org,'call-order',n) THEN RAISE EXCEPTION 'N remained authoritative'; END IF;
  IF NOT public.is_authoritative_voice_turn(org,'call-order',n1) THEN RAISE EXCEPTION 'N+1 not authoritative'; END IF;
END;
$turns$;

DO $expired$
DECLARE
  v text;
  org constant uuid := '11111111-1111-4111-8111-111111111111';
  v_turn_id constant uuid := '20000000-0000-4000-8000-000000000003';
  token constant uuid := '30000000-0000-4000-8000-000000000003';
BEGIN
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-expired',v_turn_id,1,repeat('c',64),token);
  UPDATE public.voice_turn_claims SET lease_expires_at=now()-interval '1 second'
   WHERE organization_id=org AND call_id='call-expired' AND turn_id=v_turn_id;
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-expired',v_turn_id,1,repeat('c',64),token);
  IF v <> 'uncertain' THEN RAISE EXCEPTION 'expired same token reacquired: %', v; END IF;
  SELECT status INTO v FROM public.claim_voice_turn(org,'call-expired',v_turn_id,1,repeat('c',64),token);
  IF v <> 'uncertain' THEN RAISE EXCEPTION 'uncertain turn was not terminal: %', v; END IF;
END;
$expired$;

CREATE TEMP TABLE simulated_provider_boundary(action_key text PRIMARY KEY);
DO $actions$
DECLARE
  v text;
  org constant uuid := '11111111-1111-4111-8111-111111111111';
  turn_id constant uuid := '20000000-0000-4000-8000-000000000002';
  token_a constant uuid := '40000000-0000-4000-8000-000000000001';
  token_b constant uuid := '40000000-0000-4000-8000-000000000002';
BEGIN
  SELECT status INTO v FROM public.claim_voice_external_action(org,'call-order',turn_id,'completed',token_a);
  IF v <> 'acquired' THEN RAISE EXCEPTION 'action claim failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voice_external_action_claims WHERE action_key='completed' AND status='claimed') THEN
    RAISE EXCEPTION 'provider boundary preceded action claim';
  END IF;
  INSERT INTO simulated_provider_boundary VALUES ('completed');
  PERFORM public.finish_voice_external_action(org,'call-order',turn_id,'completed','completed');
  SELECT status INTO v FROM public.claim_voice_external_action(org,'call-order',turn_id,'completed',token_b);
  IF v <> 'terminal' THEN RAISE EXCEPTION 'completed action repeated'; END IF;

  SELECT status INTO v FROM public.claim_voice_external_action(org,'call-order',turn_id,'uncertain',token_a);
  PERFORM public.finish_voice_external_action(org,'call-order',turn_id,'uncertain','uncertain');
  SELECT status INTO v FROM public.claim_voice_external_action(org,'call-order',turn_id,'uncertain',token_b);
  IF v <> 'terminal' THEN RAISE EXCEPTION 'uncertain action repeated'; END IF;

  SELECT status INTO v FROM public.claim_voice_external_action(org,'call-order',turn_id,'claimed',token_a);
  SELECT status INTO v FROM public.claim_voice_external_action(org,'call-order',turn_id,'claimed',token_b);
  IF v <> 'terminal' THEN RAISE EXCEPTION 'active claimed action repeated'; END IF;
END;
$actions$;
RESET ROLE;

DO $privileges$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('voice_turn_claims','voice_external_action_claims')
       AND (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
         OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  ) THEN
    RAISE EXCEPTION 'caller roles gained ledger table access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('voice_turn_claims','voice_external_action_claims')
       AND EXISTS (
         SELECT 1
           FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
           JOIN pg_roles role ON role.oid=acl.grantee
          WHERE role.rolname='sandbox_exec'
       )
  ) THEN
    RAISE EXCEPTION 'sandbox_exec retained ledger table access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'claim_voice_turn','complete_voice_turn','mark_voice_turn_uncertain',
       'is_authoritative_voice_turn','claim_voice_external_action','finish_voice_external_action'
     ) AND (has_function_privilege('anon',p.oid,'EXECUTE')
       OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'caller roles gained claim RPC access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('voice_turn_claims','voice_external_action_claims')
       AND (NOT has_table_privilege('service_role',c.oid,'SELECT')
         OR NOT has_table_privilege('service_role',c.oid,'INSERT')
         OR NOT has_table_privilege('service_role',c.oid,'UPDATE')
         OR has_table_privilege('service_role',c.oid,'DELETE')
         OR EXISTS (
           SELECT 1
             FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
             JOIN pg_roles role ON role.oid=acl.grantee
            WHERE role.rolname='service_role'
              AND acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE')
         ))
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'claim_voice_turn','complete_voice_turn','mark_voice_turn_uncertain',
       'is_authoritative_voice_turn','claim_voice_external_action','finish_voice_external_action'
     ) AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'service_role privilege contract failed';
  END IF;
END;
$privileges$;
SQL

echo "Voice turn single-flight disposable PostgreSQL rehearsal passed."
