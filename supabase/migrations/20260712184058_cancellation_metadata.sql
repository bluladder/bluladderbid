-- Additive, non-destructive: cancellation audit metadata on bookings.
-- No data is dropped or overwritten. Safe to run in production.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_source text,
  ADD COLUMN IF NOT EXISTS cancellation_needs_attention_reason text;

COMMENT ON COLUMN public.bookings.cancelled_at IS 'Timestamp when the booking was confirmed cancelled (Jobber-verified).';
COMMENT ON COLUMN public.bookings.cancellation_source IS 'Who initiated the cancellation: customer | admin | system.';
COMMENT ON COLUMN public.bookings.cancellation_needs_attention_reason IS 'Server-side technical reason a cancellation could not be confirmed with Jobber (never shown to customers).';
