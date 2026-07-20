
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS previous_scheduled_start timestamptz NULL,
  ADD COLUMN IF NOT EXISTS previous_scheduled_end timestamptz NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reschedule_source text NULL,
  ADD COLUMN IF NOT EXISTS reschedule_reason text NULL,
  ADD COLUMN IF NOT EXISTS reschedule_notes text NULL;

-- Length guard for customer-provided notes (server-enforced).
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_reschedule_notes_len;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_reschedule_notes_len
  CHECK (reschedule_notes IS NULL OR char_length(reschedule_notes) <= 500);

-- Enrollment-level linkage so future reminders and pending confirmations tied
-- to a stale booking_version can be safely superseded on reschedule without
-- affecting other bookings for the same customer.
ALTER TABLE public.campaign_enrollments
  ADD COLUMN IF NOT EXISTS booking_id uuid NULL,
  ADD COLUMN IF NOT EXISTS booking_version integer NULL;

CREATE INDEX IF NOT EXISTS campaign_enrollments_booking_version_idx
  ON public.campaign_enrollments (booking_id, booking_version)
  WHERE booking_id IS NOT NULL;
