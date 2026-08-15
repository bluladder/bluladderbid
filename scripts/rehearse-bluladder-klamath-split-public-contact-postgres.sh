#!/usr/bin/env bash
set -euo pipefail

: "${BLULADDER_KLAMATH_SPLIT_PUBLIC_CONTACT_DATABASE_URL:?set BLULADDER_KLAMATH_SPLIT_PUBLIC_CONTACT_DATABASE_URL}"

BLULADDER_KLAMATH_PUBLIC_CONTACT_DATABASE_URL="${BLULADDER_KLAMATH_SPLIT_PUBLIC_CONTACT_DATABASE_URL}" \
  bash scripts/rehearse-bluladder-klamath-public-contact-authority-postgres.sh

psql_args=(
  "${BLULADDER_KLAMATH_SPLIT_PUBLIC_CONTACT_DATABASE_URL}"
  --no-psqlrc
  --set=ON_ERROR_STOP=1
)

psql "${psql_args[@]}" --file \
  supabase/preflight/bluladder_klamath_split_public_contact_channels.sql

psql "${psql_args[@]}" --file \
  supabase/migrations/20260815040824_bluladder_klamath_split_public_contact_channels.sql

psql "${psql_args[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_public_contacts) <> 0 THEN
    RAISE EXCEPTION 'split public-contact migration seeded data';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.organization_public_contacts'::regclass) THEN
    RAISE EXCEPTION 'split public-contact RLS is disabled';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'organization_public_contacts') <> 2 THEN
    RAISE EXCEPTION 'split public-contact policy count drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'organization_public_contacts'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'split public-contact anon grant unexpectedly present';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'organization_public_contacts'
        AND grantee = 'authenticated') <> 4 THEN
    RAISE EXCEPTION 'split public-contact authenticated grants drifted';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'organization_public_contacts'
        AND grantee = 'service_role') <> 7 THEN
    RAISE EXCEPTION 'split public-contact service-role grants drifted';
  END IF;
END
$$;

BEGIN;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_public_contacts (
      organization_id, channel, label, destination
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      'sms', 'Invalid text', '5415550102'
    );
    RAISE EXCEPTION 'non-E.164 public SMS was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

INSERT INTO public.organization_public_contacts (
  organization_id, channel, label, destination, status,
  owner_approved_at, owner_approval_reference_hash, verified_at, published_at
) VALUES
  (
    'b1addf00-0000-4000-8000-000000000003',
    'phone', 'Call support', '+15415550100', 'published',
    '2026-08-15T00:00:00Z', repeat('a', 64),
    '2026-08-15T00:01:00Z', '2026-08-15T00:02:00Z'
  ),
  (
    'b1addf00-0000-4000-8000-000000000003',
    'sms', 'Text support', '+15415550102', 'published',
    '2026-08-15T00:00:00Z', repeat('a', 64),
    '2026-08-15T00:01:00Z', '2026-08-15T00:02:00Z'
  );

DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_public_contacts
      WHERE status = 'published') <> 2 THEN
    RAISE EXCEPTION 'distinct call and text contacts were not accepted';
  END IF;
  BEGIN
    INSERT INTO public.organization_public_contacts (
      organization_id, channel, label, destination, status,
      owner_approved_at, owner_approval_reference_hash,
      verified_at, published_at
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000003',
      'sms', 'Second text', '+15415550103', 'published',
      '2026-08-15T00:00:00Z', repeat('b', 64),
      '2026-08-15T00:01:00Z', '2026-08-15T00:02:00Z'
    );
    RAISE EXCEPTION 'duplicate published SMS channel was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

ROLLBACK;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_public_contacts) <> 0 THEN
    RAISE EXCEPTION 'split public-contact rehearsal was not rolled back';
  END IF;
END
$$;
SQL

psql "${psql_args[@]}" --file \
  supabase/verification/bluladder_klamath_split_public_contact_channels.sql

echo "BluLadder Klamath split public-contact rehearsal passed: distinct call/text channels, E.164 validation, uniqueness, zero rows, unchanged grants/RLS, and inactive tenant state."
