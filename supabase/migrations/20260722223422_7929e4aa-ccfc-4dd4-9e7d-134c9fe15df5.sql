
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  source text not null default 'booking_help_contact',
  customer_name text,
  customer_email text,
  customer_phone text,
  property_address text,
  quote_id uuid,
  booking_id uuid,
  services jsonb,
  total numeric,
  appointment_status text,
  note text,
  page_url text,
  owner_notification_status text not null default 'pending',
  owner_provider_message_id text,
  owner_error text,
  ip_hash text,
  created_at timestamptz not null default now()
);

grant select, insert on public.contact_requests to anon;
grant select, insert on public.contact_requests to authenticated;
grant all on public.contact_requests to service_role;

alter table public.contact_requests enable row level security;

create index if not exists contact_requests_created_at_idx
  on public.contact_requests (created_at desc);

delete from public.notification_events
 where booking_id = '74ed44a4-b68f-4629-b37d-3a3e806037c9'
   and channel = 'customer_email'
   and suppressed = true
   and suppressed_reason like 'test_identity%';
