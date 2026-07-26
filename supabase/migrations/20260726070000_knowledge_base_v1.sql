-- BluLadder Knowledge Base v1 foundation.
-- Safe, correctable-by-design: seeded records remain draft and inactive until owner review.

alter table if exists public.business_knowledge
  add column if not exists record_number integer,
  add column if not exists question text,
  add column if not exists voice_answer text,
  add column if not exists internal_policy text,
  add column if not exists sales_guidance text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists related_records integer[] not null default '{}',
  add column if not exists confidence text not null default 'medium',
  add column if not exists owner_notes text,
  add column if not exists effective_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id);

create unique index if not exists business_knowledge_record_number_uidx
  on public.business_knowledge(record_number) where record_number is not null;
create index if not exists business_knowledge_live_idx
  on public.business_knowledge(is_active, review_status, category, priority, sort_order);
create index if not exists business_knowledge_tags_gin
  on public.business_knowledge using gin(tags);
create index if not exists business_knowledge_search_gin
  on public.business_knowledge using gin(
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(question,'') || ' ' || coalesce(content,''))
  );

create table if not exists public.knowledge_feedback (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid null,
  message_id uuid null,
  knowledge_keys text[] not null default '{}',
  answer_text text,
  reporter_note text,
  status text not null default 'open'
    check (status in ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  created_by uuid null references auth.users(id),
  resolved_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.knowledge_audit_events (
  id bigint generated always as identity primary key,
  knowledge_id uuid,
  knowledge_key text not null,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  actor_id uuid null references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.audit_business_knowledge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.knowledge_audit_events(
    knowledge_id, knowledge_key, action, old_row, new_row, actor_id
  ) values (
    coalesce(new.id, old.id),
    coalesce(new.knowledge_key, old.knowledge_key),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists business_knowledge_audit_trigger on public.business_knowledge;
create trigger business_knowledge_audit_trigger
after insert or update or delete on public.business_knowledge
for each row execute function public.audit_business_knowledge();

create or replace function public.search_published_business_knowledge(
  p_query text,
  p_limit integer default 18
)
returns table(
  knowledge_key text,
  category text,
  title text,
  question text,
  content text,
  voice_answer text,
  priority integer,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(nullif(trim(p_query),''), 'BluLadder')) query
  )
  select
    bk.knowledge_key,
    bk.category,
    bk.title,
    bk.question,
    bk.content,
    bk.voice_answer,
    bk.priority,
    ts_rank_cd(
      to_tsvector('english', coalesce(bk.title,'') || ' ' || coalesce(bk.question,'') || ' ' || coalesce(bk.content,'')),
      q.query
    )::real rank
  from public.business_knowledge bk, q
  where bk.is_active = true
    and bk.review_status = 'published'
    and (bk.effective_at is null or bk.effective_at <= now())
    and (bk.expires_at is null or bk.expires_at > now())
  order by
    (to_tsvector('english', coalesce(bk.title,'') || ' ' || coalesce(bk.question,'') || ' ' || coalesce(bk.content,'')) @@ q.query) desc,
    rank desc,
    bk.priority asc,
    bk.sort_order asc
  limit greatest(1, least(coalesce(p_limit,18),40));
$$;

alter table public.knowledge_feedback enable row level security;
alter table public.knowledge_audit_events enable row level security;

drop policy if exists "admins manage knowledge feedback" on public.knowledge_feedback;
create policy "admins manage knowledge feedback"
on public.knowledge_feedback for all
to authenticated
using (public.has_admin_level(auth.uid(), 'operations_admin'))
with check (public.has_admin_level(auth.uid(), 'operations_admin'));

drop policy if exists "admins read knowledge audit" on public.knowledge_audit_events;
create policy "admins read knowledge audit"
on public.knowledge_audit_events for select
to authenticated
using (public.has_admin_level(auth.uid(), 'operations_admin'));

comment on function public.search_published_business_knowledge(text, integer)
is 'Returns only active, published, currently effective canonical knowledge. Drafts never leak into AI answers.';
