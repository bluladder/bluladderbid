-- Customer Intelligence Phase 2: canonical lead-source and attribution model.
-- Additive/idempotent migration. Existing production rows and integrations are preserved.

create table if not exists public.lead_source_definitions (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  display_name text not null,
  channel_group text not null,
  aliases text[] not null default '{}',
  is_other boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  jobber_mapping_mode text not null default 'internal_note'
    check (jobber_mapping_mode in ('native','custom_field','internal_note','disabled')),
  jobber_mapping_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

create table if not exists public.lead_source_sync_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('quote_session','quote','booking','customer')),
  entity_id uuid,
  provider text not null default 'jobber',
  idempotency_key text not null unique,
  source_key text,
  mapping_mode text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','skipped')),
  error_message text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.lead_source_definitions
  (source_key, display_name, channel_group, aliases, is_other, sort_order)
values
  ('google_search','Google Search','search',array['google','google search','web search'],false,10),
  ('google_business_profile','Google Maps / Google Business Profile','local_search',array['google maps','google business profile','gbp','maps'],false,20),
  ('facebook_instagram','Facebook / Instagram','paid_social',array['facebook','instagram','meta','fb','ig'],false,30),
  ('nextdoor','Nextdoor','social',array['next door'],false,40),
  ('door_hanger','Door Hanger','offline_direct',array['doorhanger','door hanger'],false,50),
  ('postcard_direct_mail','Postcard / Direct Mail','offline_direct',array['postcard','direct mail','mailer','eddm'],false,60),
  ('yard_sign','Yard Sign','offline_local',array['sign','yard sign'],false,70),
  ('referral','Referral from Friend or Family','referral',array['friend','family','word of mouth','referral'],false,80),
  ('existing_customer','Existing Customer','retention',array['repeat customer','past customer','returning customer'],false,90),
  ('saw_us_working','Neighborhood / Saw Us Working','offline_local',array['neighbor','neighborhood','saw truck','saw you working'],false,100),
  ('youtube_social','YouTube / Social Media','organic_social',array['youtube','social media','tiktok','video'],false,110),
  ('jobber_partner','Jobber Marketplace / Partner','partner',array['jobber','marketplace','partner'],false,120),
  ('other','Other','other',array[]::text[],true,999)
on conflict (source_key) do update set
  display_name = excluded.display_name,
  channel_group = excluded.channel_group,
  aliases = excluded.aliases,
  is_other = excluded.is_other,
  sort_order = excluded.sort_order;

alter table public.attribution_events
  add column if not exists self_reported_source text,
  add column if not exists self_reported_source_detail text,
  add column if not exists normalized_source_key text references public.lead_source_definitions(source_key),
  add column if not exists attribution_source text,
  add column if not exists attribution_medium text,
  add column if not exists attribution_campaign text,
  add column if not exists attribution_content text,
  add column if not exists first_touch_referrer text,
  add column if not exists last_touch_referrer text,
  add column if not exists callrail_tracking_number text,
  add column if not exists callrail_campaign text,
  add column if not exists source_required_resolved_at timestamptz;

create index if not exists attribution_events_normalized_source_idx
  on public.attribution_events(normalized_source_key, created_at desc);
create index if not exists lead_source_sync_events_entity_idx
  on public.lead_source_sync_events(entity_type, entity_id, created_at desc);
create index if not exists lead_source_sync_events_status_idx
  on public.lead_source_sync_events(status, last_attempt_at);

create or replace function public.normalize_lead_source(p_value text)
returns text
language sql
stable
set search_path = public
as $$
  select l.source_key
  from public.lead_source_definitions l
  where l.is_active = true
    and (
      lower(trim(p_value)) = lower(l.source_key)
      or lower(trim(p_value)) = lower(l.display_name)
      or exists (
        select 1 from unnest(l.aliases) alias
        where lower(trim(p_value)) = lower(alias)
      )
    )
  order by l.sort_order
  limit 1;
$$;

create or replace function public.validate_lead_source_submission(
  p_source_key text,
  p_source_detail text default null
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.lead_source_definitions l
    where l.source_key = p_source_key
      and l.is_active = true
      and (l.is_other = false or nullif(trim(p_source_detail), '') is not null)
  );
$$;

alter table public.lead_source_definitions enable row level security;
alter table public.lead_source_sync_events enable row level security;

drop policy if exists "public reads active lead sources" on public.lead_source_definitions;
create policy "public reads active lead sources"
on public.lead_source_definitions for select
to anon, authenticated
using (is_active = true or public.has_admin_level(auth.uid(), 'operations_admin'));

drop policy if exists "admins manage lead sources" on public.lead_source_definitions;
create policy "admins manage lead sources"
on public.lead_source_definitions for all
to authenticated
using (public.has_admin_level(auth.uid(), 'operations_admin'))
with check (public.has_admin_level(auth.uid(), 'operations_admin'));

drop policy if exists "admins read source sync events" on public.lead_source_sync_events;
create policy "admins read source sync events"
on public.lead_source_sync_events for select
to authenticated
using (public.has_admin_level(auth.uid(), 'operations_admin'));

comment on table public.lead_source_definitions is
'Canonical, owner-manageable lead-source catalog with aliases, channel grouping, and Jobber mapping policy.';
comment on table public.lead_source_sync_events is
'Idempotent audit log for downstream lead-source synchronization, including Jobber fallback behavior.';
