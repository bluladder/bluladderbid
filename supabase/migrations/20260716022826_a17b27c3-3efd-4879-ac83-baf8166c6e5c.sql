
-- Add verified_email to customer_accounts so the email-OTP fallback can key rows
-- by email when no phone has been verified yet.
ALTER TABLE public.customer_accounts
  ADD COLUMN IF NOT EXISTS verified_email text,
  ALTER COLUMN verified_phone DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_accounts_verified_email
  ON public.customer_accounts (verified_email)
  WHERE verified_email IS NOT NULL;

-- Ensure at least one verified identity exists on every row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_accounts_identity_present'
  ) THEN
    ALTER TABLE public.customer_accounts
      ADD CONSTRAINT customer_accounts_identity_present
      CHECK (verified_phone IS NOT NULL OR verified_email IS NOT NULL);
  END IF;
END $$;

-- Track ambiguous email matches for admin review.
ALTER TABLE public.customer_account_match_issues
  ADD COLUMN IF NOT EXISTS verified_email text;

-- Booking-scoped management session columns. The bootstrap token in the
-- confirmation SMS/email is single-use; on redemption a scoped session hash
-- is stored here so subsequent view actions do not require another bootstrap
-- and so the raw session token is never persisted anywhere.
ALTER TABLE public.booking_management_tokens
  ADD COLUMN IF NOT EXISTS management_session_hash text,
  ADD COLUMN IF NOT EXISTS management_session_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bmt_management_session_hash
  ON public.booking_management_tokens (management_session_hash)
  WHERE management_session_hash IS NOT NULL;
