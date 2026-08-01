\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT organization_id FROM public.quote_sessions
      WHERE id='f0000000-0000-4000-8000-000000000001') <>
     'b0000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'quote session parent backfill failed';
  END IF;
  IF (SELECT organization_id FROM public.chat_conversations
      WHERE id='90000000-0000-4000-8000-000000000001') <>
     'b0000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'conversation parent backfill failed';
  END IF;
  IF (SELECT organization_id FROM public.quote_sessions
      WHERE id='f0000000-0000-4000-8000-000000000002') IS NOT NULL THEN
    RAISE EXCEPTION 'unresolved quote session was defaulted';
  END IF;
  IF (SELECT organization_id FROM public.chat_conversations
      WHERE id='90000000-0000-4000-8000-000000000002') IS NOT NULL THEN
    RAISE EXCEPTION 'unresolved conversation was defaulted';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN (
      'quote_sessions_organization_id_fkey',
      'chat_conversations_organization_id_fkey'
    ) AND convalidated) <> 2 THEN
    RAISE EXCEPTION 'second-wave foreign keys are not validated';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
      AND policyname IN (
        'Tenant boundary quote sessions',
        'Tenant boundary chat conversations'
      ) AND permissive='RESTRICTIVE'
      AND coalesce(qual, '') <> '' AND coalesce(with_check, '') <> '') <> 2 THEN
    RAISE EXCEPTION 'second-wave USING/WITH CHECK policies are incomplete';
  END IF;
  IF has_table_privilege('anon', 'public.quote_sessions', 'SELECT')
     OR has_table_privilege('anon', 'public.chat_conversations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.quote_sessions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.chat_conversations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.quote_sessions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.quote_sessions', 'DELETE')
     OR has_table_privilege('authenticated', 'public.chat_conversations', 'DELETE')
     OR NOT has_table_privilege(
       'service_role', 'public.quote_sessions', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'second-wave Data API grants are incorrect';
  END IF;
  IF has_function_privilege(
       'service_role', 'public.enforce_session_organization_lineage()', 'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.enforce_first_wave_organization_lineage()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'trigger function is directly executable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN (
        'admin_marketing_funnel', 'eligibility_rules_public',
        'property_facts_current', 'technicians_public'
      )
      AND NOT (
        coalesce(c.reloptions, ARRAY[]::text[])
          @> ARRAY['security_invoker=true']::text[]
      )
  ) THEN
    RAISE EXCEPTION 'Data API view is not security invoker';
  END IF;
  IF has_table_privilege(
       'authenticated', 'public.admin_marketing_funnel', 'INSERT,UPDATE,DELETE'
     ) OR has_table_privilege(
       'anon', 'public.eligibility_rules_public', 'INSERT,UPDATE,DELETE'
     ) OR NOT has_table_privilege(
       'anon', 'public.eligibility_rules_public', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'Data API view grants are not read-only';
  END IF;
END
$$;

-- First-wave parent derivation and conflict rejection.
INSERT INTO public.quotes(id, customer_id, property_id)
VALUES (
  'e0000000-0000-4000-8000-000000000010',
  'c0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001'
) ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  IF (SELECT organization_id FROM public.quotes
      WHERE id='e0000000-0000-4000-8000-000000000010') <>
     'b0000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'first-wave parent derivation failed';
  END IF;
  BEGIN
    INSERT INTO public.bookings(id, customer_id, property_id)
    VALUES (
      'e0000000-0000-4000-8000-000000000011',
      'c0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'cross-tenant booking unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.quotes(id, organization_id, customer_id)
    VALUES (
      'e0000000-0000-4000-8000-000000000012',
      'b0000000-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'unscoped first-wave parent unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

-- Second-wave derivation and conflict rejection.
INSERT INTO public.quote_sessions(id, channel, customer_id)
VALUES (
  'f0000000-0000-4000-8000-000000000010', 'voice',
  'c0000000-0000-4000-8000-000000000001'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.chat_conversations(id, session_token, quote_session_id)
VALUES (
  '90000000-0000-4000-8000-000000000010', 'derived',
  'f0000000-0000-4000-8000-000000000010'
) ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  IF (SELECT organization_id FROM public.chat_conversations
      WHERE id='90000000-0000-4000-8000-000000000010') <>
     'b0000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'conversation trigger derivation failed';
  END IF;
  BEGIN
    UPDATE public.chat_conversations
    SET property_id='d0000000-0000-4000-8000-000000000002'
    WHERE id='90000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'cross-tenant conversation update unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.quote_sessions(
      id, channel, organization_id, customer_id
    ) VALUES (
      'f0000000-0000-4000-8000-000000000012', 'voice',
      'b0000000-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'unscoped session parent unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

-- Authenticated RLS isolates A, B, and unresolved legacy rows.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a0000000-0000-4000-8000-000000000002', true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.quote_sessions) <> 2 THEN
    RAISE EXCEPTION 'tenant A member quote-session visibility is incorrect';
  END IF;
  IF (SELECT count(*) FROM public.chat_conversations) <> 2 THEN
    RAISE EXCEPTION 'tenant A member conversation visibility is incorrect';
  END IF;
END
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a0000000-0000-4000-8000-000000000003', true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.quote_sessions) <> 0
     OR (SELECT count(*) FROM public.chat_conversations) <> 0 THEN
    RAISE EXCEPTION 'tenant B saw tenant A or unscoped session rows';
  END IF;
END
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a0000000-0000-4000-8000-000000000004', true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.quote_sessions) <> 0
     OR (SELECT count(*) FROM public.chat_conversations) <> 0 THEN
    RAISE EXCEPTION 'inactive membership retained tenant visibility';
  END IF;
END
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a0000000-0000-4000-8000-000000000001', true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.quote_sessions) <> 3 THEN
    RAISE EXCEPTION 'platform admin compatibility visibility is incorrect';
  END IF;
  BEGIN
    UPDATE public.chat_conversations
    SET organization_id='b0000000-0000-4000-8000-000000000002'
    WHERE id='90000000-0000-4000-8000-000000000001';
    IF FOUND THEN
      RAISE EXCEPTION 'cross-tenant authenticated update unexpectedly succeeded';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.chat_conversations
    SET session_token='still-unscoped'
    WHERE id='90000000-0000-4000-8000-000000000002';
    IF FOUND THEN
      RAISE EXCEPTION 'legacy unscoped row remained writable';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.chat_conversations(id, session_token, organization_id)
    VALUES (
      '90000000-0000-4000-8000-000000000099', 'cross-tenant-insert',
      'b0000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'cross-tenant authenticated insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.chat_conversations
    WHERE id='90000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'authenticated delete unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
ROLLBACK;
