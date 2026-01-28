-- Create audit log table for booking changes
CREATE TABLE IF NOT EXISTS public.booking_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  changed_by TEXT NOT NULL DEFAULT 'customer',
  changed_by_id UUID,
  is_admin_override BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.booking_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all audit logs
CREATE POLICY "Admins can read audit logs"
ON public.booking_audit_log
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Service role can insert (used by edge functions)
CREATE POLICY "Service role can insert audit logs"
ON public.booking_audit_log
FOR INSERT
TO service_role
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_booking_audit_log_booking_id ON public.booking_audit_log(booking_id);
CREATE INDEX idx_booking_audit_log_created_at ON public.booking_audit_log(created_at DESC);