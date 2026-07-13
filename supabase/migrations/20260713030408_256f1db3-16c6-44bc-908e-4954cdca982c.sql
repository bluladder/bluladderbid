-- Make the approved permanent test identity resilient to cleanup and re-seed it.

-- 1) Mark rows that are permanent configuration and must never be removed by cleanup.
ALTER TABLE public.test_identities
  ADD COLUMN IF NOT EXISTS protected boolean NOT NULL DEFAULT false;

-- 2) Prevent duplicate identities and enable idempotent re-seeding by normalized email.
CREATE UNIQUE INDEX IF NOT EXISTS test_identities_email_lower_uidx
  ON public.test_identities (lower(email))
  WHERE email IS NOT NULL;

-- 3) Cleanup guard: a broad "delete test data" statement will silently skip
--    protected rows instead of removing them. Temporary verification records
--    (protected = false) are still deletable exactly as before.
CREATE OR REPLACE FUNCTION public.prevent_protected_test_identity_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.protected THEN
    -- Skip the delete for protected rows; allow all others through.
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_test_identity ON public.test_identities;
CREATE TRIGGER trg_protect_test_identity
  BEFORE DELETE ON public.test_identities
  FOR EACH ROW EXECUTE FUNCTION public.prevent_protected_test_identity_delete();

-- 4) Re-seed the owner-approved permanent test identity (normalized email + E.164 phone),
--    idempotently. If a row already exists for this email, ensure it is active + protected.
INSERT INTO public.test_identities (name, email, phone, active, protected, note)
VALUES (
  'BluLadder Booking Test',
  'blmillen@gmail.com',
  '+14692150144',
  true,
  true,
  'Owner-approved permanent end-to-end test identity. Protected: must never be deleted by cleanup.'
)
ON CONFLICT (lower(email)) WHERE email IS NOT NULL
DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  active = true,
  protected = true,
  note = EXCLUDED.note,
  updated_at = now();