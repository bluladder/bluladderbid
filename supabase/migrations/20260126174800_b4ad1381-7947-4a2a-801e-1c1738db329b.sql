-- Add is_hidden column to bookings table for soft delete
ALTER TABLE public.bookings 
ADD COLUMN is_hidden boolean NOT NULL DEFAULT false;

-- Add index for efficient filtering
CREATE INDEX idx_bookings_is_hidden ON public.bookings(is_hidden);