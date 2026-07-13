-- Admin-configurable quote-abandonment delay lives on the campaign config
-- (no new table). Validated to a sane range (1 minute .. 30 days).
ALTER TABLE public.sms_campaigns
  ADD COLUMN IF NOT EXISTS abandonment_delay_minutes integer;

ALTER TABLE public.sms_campaigns
  DROP CONSTRAINT IF EXISTS sms_campaigns_abandonment_delay_chk;
ALTER TABLE public.sms_campaigns
  ADD CONSTRAINT sms_campaigns_abandonment_delay_chk
  CHECK (abandonment_delay_minutes IS NULL OR abandonment_delay_minutes BETWEEN 1 AND 43200);

-- Staff-takeover record + abandonment bookkeeping on the conversation (the
-- persistent lead/quote record). These let the sweep exclude taken-over leads
-- and avoid re-emitting an abandonment for the same pricing version.
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS staff_takeover_at timestamptz,
  ADD COLUMN IF NOT EXISTS staff_takeover_by uuid,
  ADD COLUMN IF NOT EXISTS staff_takeover_reason text,
  ADD COLUMN IF NOT EXISTS abandonment_emitted_version text,
  ADD COLUMN IF NOT EXISTS abandonment_swept_at timestamptz;

-- Bounded, oldest-first eligibility scan for abandonment detection.
CREATE INDEX IF NOT EXISTS idx_chat_convo_abandonment
  ON public.chat_conversations (last_activity_at)
  WHERE resolved IS NOT TRUE AND staff_takeover_at IS NULL;

-- Recovery scan for critical campaign events that were recorded but not yet
-- processed (used by the existing process-sms-queue cron; no new queue).
CREATE INDEX IF NOT EXISTS idx_campaign_events_unprocessed
  ON public.campaign_events (created_at)
  WHERE processed_at IS NULL;