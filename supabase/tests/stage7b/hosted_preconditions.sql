\set ON_ERROR_STOP on

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL
);
CREATE TABLE public.customers (id uuid PRIMARY KEY);
CREATE TABLE public.properties (id uuid PRIMARY KEY);
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id)
);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id)
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_customers ON public.customers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY legacy_properties ON public.properties
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY legacy_quotes ON public.quotes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY legacy_bookings ON public.bookings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.customers, public.properties, public.quotes, public.bookings
  TO authenticated;

CREATE TABLE public.big_job_settings (id text PRIMARY KEY);
CREATE TABLE public.eligibility_rules (id uuid PRIMARY KEY);
CREATE TABLE public.schedule_blocks (id uuid PRIMARY KEY);

INSERT INTO auth.users(id)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.user_roles(user_id, role)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin');

INSERT INTO public.customers(id)
SELECT (
  '10000000-0000-4000-8000-' || lpad(n::text, 12, '0')
)::uuid
FROM generate_series(1, 16) n;
INSERT INTO public.properties(id)
SELECT (
  '20000000-0000-4000-8000-' || lpad(n::text, 12, '0')
)::uuid
FROM generate_series(1, 10) n;
INSERT INTO public.quotes(id, customer_id)
SELECT (
         '30000000-0000-4000-8000-' || lpad(n::text, 12, '0')
       )::uuid,
       (
         '10000000-0000-4000-8000-' || lpad(n::text, 12, '0')
       )::uuid
FROM generate_series(1, 2) n;
INSERT INTO public.bookings(id, customer_id)
SELECT (
         '40000000-0000-4000-8000-' || lpad(n::text, 12, '0')
       )::uuid,
       (
         '10000000-0000-4000-8000-' || lpad(n::text, 12, '0')
       )::uuid
FROM generate_series(1, 2) n;
