-- Customer Intelligence Phase 3: explainable, bounded learning system.
-- Additive migration only. No customer-facing automation is enabled here.

create table if not exists public.customer_timeline_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  event_type text not null,
  event_at timestamptz not null,
  source_system text not null default 'bluladder',
  source_record_id text,
  service_key text,
  amount numeric(12,2),
  status text,
  channel text,
  city text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  as_of timestamptz not null,
  feature_version text not null,
  lifetime_value numeric(12,2) not null default 0,
  completed_job_count integer not null default 0,
  quote_count integer not null default 0,
  booking_count integer not null default 0,
  cancellation_count integer not null default 0,
  average_ticket numeric(12,2) not null default 0,
  days_since_last_completed integer,
  days_since_last_quote integer,
  preferred_channel text,
  primary_city text,
  service_counts jsonb not null default '{}'::jsonb,
  service_last_completed_at jsonb not null default '{}'::jsonb,
  inferred_service_cadence_days jsonb not null default '{}'::jsonb,
  seasonality jsonb not null default '{}'::jsonb,
  property_features jsonb not null default '{}'::jsonb,
  behavior_features jsonb not null default '{}'::jsonb,
  data_quality jsonb not null default '{}'::jsonb,
  feature_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(customer_id, as_of, feature_version)
);

create table if not exists public.recommendation_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_key text not null,
  version integer not null,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  algorithm text not null default 'bounded_logistic',
  weights jsonb not null default '{}'::jsonb,
  bounds jsonb not null default '{}'::jsonb,
  priors jsonb not null default '{}'::jsonb,
  training_window_start timestamptz,
  training_window_end timestamptz,
  sample_count integer not null default 0,
  evaluation_metrics jsonb not null default '{}'::jsonb,
  parent_version_id uuid references public.recommendation_model_versions(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  created_by uuid references auth.users(id),
  unique(model_key, version)
);

create table if not exists public.customer_recommendations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  feature_snapshot_id uuid references public.customer_feature_snapshots(id),
  model_version_id uuid references public.recommendation_model_versions(id),
  recommendation_type text not null,
  service_key text,
  rank integer not null default 1,
  score numeric(8,6) not null check (score >= 0 and score <= 1),
  confidence numeric(8,6) not null check (confidence >= 0 and confidence <= 1),
  expected_value numeric(12,2),
  reason_codes text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  explanation text not null,
  status text not null default 'active' check (status in ('active','suppressed','accepted','rejected','expired')),
  advisory_only boolean not null default true,
  expires_at timestamptz,
  suppressed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recommendation_outcomes (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.customer_recommendations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  outcome_type text not null check (outcome_type in ('shown','accepted','rejected','ignored','booked','cancelled','completed','owner_suppressed','owner_overridden')),
  outcome_at timestamptz not null default now(),
  value numeric(12,2),
  service_key text,
  source_system text not null default 'bluladder',
  source_record_id text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.model_learning_runs (
  id uuid primary key default gen_random_uuid(),
  model_key text not null,
  base_model_version_id uuid references public.recommendation_model_versions(id),
  proposed_model_version_id uuid references public.recommendation_model_versions(id),
  status text not null default 'pending' check (status in ('pending','completed','failed','rejected')),
  input_window_start timestamptz,
  input_window_end timestamptz,
  outcome_count integer not null default 0,
  update_summary jsonb not null default '{}'::jsonb,
  guardrail_results jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.customer_intelligence_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'jobber',
  object_type text not null,
  cursor jsonb,
  range_start timestamptz,
  range_end timestamptz,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','paused')),
  records_seen integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  records_skipped integer not null default 0,
  error_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_timeline_customer_event_idx on public.customer_timeline_events(customer_id, event_at desc);
create index if not exists customer_timeline_source_idx on public.customer_timeline_events(source_system, source_record_id);
create index if not exists customer_features_customer_idx on public.customer_feature_snapshots(customer_id, as_of desc);
create index if not exists customer_recommendations_customer_idx on public.customer_recommendations(customer_id, status, score desc);
create index if not exists recommendation_outcomes_recommendation_idx on public.recommendation_outcomes(recommendation_id, outcome_at desc);
create index if not exists backfill_runs_status_idx on public.customer_intelligence_backfill_runs(status, created_at);

alter table public.customer_timeline_events enable row level security;
alter table public.customer_feature_snapshots enable row level security;
alter table public.recommendation_model_versions enable row level security;
alter table public.customer_recommendations enable row level security;
alter table public.recommendation_outcomes enable row level security;
alter table public.model_learning_runs enable row level security;
alter table public.customer_intelligence_backfill_runs enable row level security;

create policy "admins read customer intelligence timeline" on public.customer_timeline_events for select to authenticated using (public.has_admin_level(auth.uid(), 'operations_admin'));
create policy "admins read customer feature snapshots" on public.customer_feature_snapshots for select to authenticated using (public.has_admin_level(auth.uid(), 'operations_admin'));
create policy "admins manage recommendation models" on public.recommendation_model_versions for all to authenticated using (public.has_admin_level(auth.uid(), 'operations_admin')) with check (public.has_admin_level(auth.uid(), 'operations_admin'));
create policy "admins manage customer recommendations" on public.customer_recommendations for all to authenticated using (public.has_admin_level(auth.uid(), 'operations_admin')) with check (public.has_admin_level(auth.uid(), 'operations_admin'));
create policy "admins manage recommendation outcomes" on public.recommendation_outcomes for all to authenticated using (public.has_admin_level(auth.uid(), 'operations_admin')) with check (public.has_admin_level(auth.uid(), 'operations_admin'));
create policy "admins read model learning runs" on public.model_learning_runs for select to authenticated using (public.has_admin_level(auth.uid(), 'operations_admin'));
create policy "admins read intelligence backfill runs" on public.customer_intelligence_backfill_runs for select to authenticated using (public.has_admin_level(auth.uid(), 'operations_admin'));

insert into public.recommendation_model_versions (
  model_key, version, status, algorithm, weights, bounds, priors, sample_count, evaluation_metrics, activated_at
) values (
  'service_next_best_action',
  1,
  'active',
  'bounded_logistic',
  '{"recency_due":1.2,"prior_service":1.0,"cross_sell_gap":0.65,"season_match":0.45,"repeat_customer":0.35,"recent_complaint":-3.0,"recent_cancellation":-0.7}'::jsonb,
  '{"min_weight":-4.0,"max_weight":4.0,"max_delta_per_run":0.15,"minimum_outcomes":30,"minimum_positive_outcomes":5}'::jsonb,
  '{"base_probability":0.15,"service_default_cadence_days":{"window_cleaning":180,"gutter_cleaning":270,"house_wash":365,"driveway_cleaning":365,"roof_cleaning":1095,"solar_panel_cleaning":180,"screen_repair":730}}'::jsonb,
  0,
  '{"bootstrap":"heuristic","advisory_only":true}'::jsonb,
  now()
) on conflict (model_key, version) do nothing;

comment on table public.customer_feature_snapshots is 'Versioned point-in-time features used to reproduce recommendations and avoid future-data leakage.';
comment on table public.recommendation_model_versions is 'Bounded, auditable model weights. Learning may propose new versions but cannot silently rewrite owner business rules.';
comment on table public.customer_recommendations is 'Explainable advisory recommendations with evidence, confidence, expected value, and model provenance.';
comment on table public.recommendation_outcomes is 'Observed recommendation feedback used for later bounded model updates.';