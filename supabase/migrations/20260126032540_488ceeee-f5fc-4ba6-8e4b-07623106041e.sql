-- Fix RLS policies for customers and bookings to be more restrictive

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Public can create customers" ON public.customers;
DROP POLICY IF EXISTS "Public can create bookings" ON public.bookings;

-- Customers: Allow unauthenticated insert but require email to be provided
-- This is intentional for the booking flow where customers provide their email
CREATE POLICY "Anyone can create customer record"
ON public.customers
FOR INSERT
WITH CHECK (email IS NOT NULL AND email <> '');

-- Bookings: Require a valid customer_id reference
CREATE POLICY "Anyone can create booking with valid customer"
ON public.bookings
FOR INSERT
WITH CHECK (
    customer_id IS NOT NULL 
    AND reference_number IS NOT NULL
    AND duration_minutes > 0
);