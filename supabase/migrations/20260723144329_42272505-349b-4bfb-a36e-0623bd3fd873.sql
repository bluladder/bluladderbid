
-- 1) Extend sms_booking_confirmations with Phase 6A linkage + result fields.
ALTER TABLE public.sms_booking_confirmations
  ADD COLUMN IF NOT EXISTS presentation_id UUID
    REFERENCES public.sms_availability_presentations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jobber_job_id TEXT,
  ADD COLUMN IF NOT EXISTS jobber_visit_id TEXT,
  ADD COLUMN IF NOT EXISTS reference_number TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_ack_sms_id UUID
    REFERENCES public.sms_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS booking_result JSONB;

-- 2) At most one active (pending or confirmed) ledger row per presentation.
--    Duplicate YES replies for the same presentation MUST reuse this row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_smsbc_presentation_active
  ON public.sms_booking_confirmations (presentation_id)
  WHERE status IN ('pending','confirmed') AND presentation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smsbc_presentation
  ON public.sms_booking_confirmations (presentation_id);

-- 3) Add "consumed" hold state for presentations whose hold was turned into
--    a real booking. Keeps the audit trail distinct from released/expired.
ALTER TABLE public.sms_availability_presentations
  DROP CONSTRAINT IF EXISTS sms_availability_presentations_hold_status_check;
ALTER TABLE public.sms_availability_presentations
  ADD CONSTRAINT sms_availability_presentations_hold_status_check
  CHECK (hold_status IN (
    'none','held','released','expired',
    'revalidation_failed','conflict','superseded','consumed'
  ));
