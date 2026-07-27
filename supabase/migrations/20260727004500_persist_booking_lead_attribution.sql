-- Persist the client attribution snapshot into canonical attribution columns.
-- This keeps booking writes backward-compatible: the existing edge function
-- continues writing bookings.attribution while the database projects the
-- normalized fields into attribution_events.

create or replace function public.persist_booking_lead_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb := coalesce(new.attribution, '{}'::jsonb);
  first_touch jsonb := coalesce(a->'first_touch', '{}'::jsonb);
  last_touch jsonb := coalesce(a->'last_touch', '{}'::jsonb);
  session_id text := coalesce(new.source_session_id, a->>'source_session_id');
  reported text := nullif(trim(a->>'self_reported_source'), '');
  reported_detail text := nullif(trim(a->>'self_reported_source_detail'), '');
  normalized text;
begin
  if session_id is null then
    return new;
  end if;

  normalized := public.normalize_lead_source(reported);

  update public.attribution_events
  set booking_id = new.id,
      customer_id = new.customer_id,
      jobber_job_id = new.jobber_job_id,
      source_session_id = session_id,
      self_reported_source = reported,
      self_reported_source_detail = reported_detail,
      normalized_source_key = normalized,
      attribution_source = coalesce(last_touch->>'utm_source', first_touch->>'utm_source'),
      attribution_medium = coalesce(last_touch->>'utm_medium', first_touch->>'utm_medium'),
      attribution_campaign = coalesce(last_touch->>'utm_campaign', first_touch->>'utm_campaign'),
      attribution_content = coalesce(last_touch->>'utm_content', first_touch->>'utm_content'),
      first_touch_referrer = first_touch->>'referrer',
      last_touch_referrer = last_touch->>'referrer',
      source_required_resolved_at = case when reported is not null then coalesce(source_required_resolved_at, now()) else source_required_resolved_at end,
      updated_at = now()
  where attribution_events.source_session_id = session_id;

  if not found then
    insert into public.attribution_events (
      source_session_id, booking_id, customer_id, jobber_job_id,
      first_touch, last_touch, landing_page_slug, fbclid, referrer,
      self_reported_source, self_reported_source_detail, normalized_source_key,
      attribution_source, attribution_medium, attribution_campaign, attribution_content,
      first_touch_referrer, last_touch_referrer, source_required_resolved_at
    ) values (
      session_id, new.id, new.customer_id, new.jobber_job_id,
      first_touch, last_touch, coalesce(a->>'landing_page_slug', first_touch->>'landing_page_slug'),
      coalesce(a->>'fbclid', first_touch->>'fbclid'), coalesce(a->>'referrer', first_touch->>'referrer'),
      reported, reported_detail, normalized,
      coalesce(last_touch->>'utm_source', first_touch->>'utm_source'),
      coalesce(last_touch->>'utm_medium', first_touch->>'utm_medium'),
      coalesce(last_touch->>'utm_campaign', first_touch->>'utm_campaign'),
      coalesce(last_touch->>'utm_content', first_touch->>'utm_content'),
      first_touch->>'referrer', last_touch->>'referrer',
      case when reported is not null then now() else null end
    );
  end if;

  return new;
end;
$$;

drop trigger if exists persist_booking_lead_attribution_trigger on public.bookings;
create trigger persist_booking_lead_attribution_trigger
after insert or update of attribution, source_session_id, jobber_job_id on public.bookings
for each row execute function public.persist_booking_lead_attribution();

comment on function public.persist_booking_lead_attribution() is
'Projects booking attribution JSON into canonical first/last-touch and self-reported lead-source columns without changing the booking API contract.';
