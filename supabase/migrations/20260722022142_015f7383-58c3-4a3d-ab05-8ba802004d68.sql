ALTER TABLE public.sms_campaign_steps
  ADD COLUMN IF NOT EXISTS content_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.sms_campaigns
  ADD COLUMN IF NOT EXISTS historical_backfill_enabled boolean NOT NULL DEFAULT false;

INSERT INTO public.sms_campaigns
  (id, name, description, campaign_kind, event_name, status,
   required_consent, reentry_enabled, historical_backfill_enabled,
   audience_conditions, stop_conditions)
VALUES
  ('55555555-5555-4555-9555-555555555555',
   'Evergreen Service Education Nurture',
   'Year-long educational email nurture for completed-service customers. Six email touches (day 0/60/120/200/280/365). Timing editable. Historical backfill disabled by default.',
   'event',
   'service_completed',
   'draft',
   'marketing'::consent_type,
   false,
   false,
   '{}'::jsonb,
   '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sms_campaign_steps
  (campaign_id, step_order, delay_hours, channel, active, is_marketing, business_hours_only, subject, body_template, content_config)
VALUES
  ('55555555-5555-4555-9555-555555555555', 1,   0 * 24, 'email', false, true, false,
   '{{subject}}', '{{body}}',
   jsonb_build_object('placeholder_id','evergreen_edu_day_0','subject','','body','','cta_label','','cta_url','','article_title','','article_url','','article_description','','fallback_copy','')),
  ('55555555-5555-4555-9555-555555555555', 2,  60 * 24, 'email', false, true, false,
   '{{subject}}', '{{body}}',
   jsonb_build_object('placeholder_id','evergreen_edu_day_60','subject','','body','','cta_label','','cta_url','','article_title','','article_url','','article_description','','fallback_copy','')),
  ('55555555-5555-4555-9555-555555555555', 3, 120 * 24, 'email', false, true, false,
   '{{subject}}', '{{body}}',
   jsonb_build_object('placeholder_id','evergreen_edu_day_120','subject','','body','','cta_label','','cta_url','','article_title','','article_url','','article_description','','fallback_copy','')),
  ('55555555-5555-4555-9555-555555555555', 4, 200 * 24, 'email', false, true, false,
   '{{subject}}', '{{body}}',
   jsonb_build_object('placeholder_id','evergreen_edu_day_200','subject','','body','','cta_label','','cta_url','','article_title','','article_url','','article_description','','fallback_copy','')),
  ('55555555-5555-4555-9555-555555555555', 5, 280 * 24, 'email', false, true, false,
   '{{subject}}', '{{body}}',
   jsonb_build_object('placeholder_id','evergreen_edu_day_280','subject','','body','','cta_label','','cta_url','','article_title','','article_url','','article_description','','fallback_copy','')),
  ('55555555-5555-4555-9555-555555555555', 6, 365 * 24, 'email', false, true, false,
   '{{subject}}', '{{body}}',
   jsonb_build_object('placeholder_id','evergreen_edu_day_365','subject','','body','','cta_label','','cta_url','','article_title','','article_url','','article_description','','fallback_copy',''));
