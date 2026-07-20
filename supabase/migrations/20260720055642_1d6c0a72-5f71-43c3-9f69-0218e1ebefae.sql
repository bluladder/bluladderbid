-- Booking confirmation version + linkage columns for canonical booking_completed idempotency
-- 
-- booking_version:   monotonic integer that identifies the CONFIRMATION revision of a
--                    booking. Defaults to 1 for every new row so historical bookings and
--                    the existing booking_completed events remain valid. Future reschedule
--                    workflows (Phase 2B/C) can bump this to force a new confirmation event.
-- quote_id:          durable link to the originating quote row, so campaign-event can
--                    scope stop-events to a specific quote journey without depending on
--                    the source_session_id fallback.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quote_id uuid NULL REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_quote_id_idx ON public.bookings (quote_id);
