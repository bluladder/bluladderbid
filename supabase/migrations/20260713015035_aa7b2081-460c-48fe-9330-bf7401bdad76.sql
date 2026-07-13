-- Campaign admin: add lifecycle status, effective window, and step classification.
-- Additive only. Existing campaigns keep their `active` flag (engine source of
-- truth) unchanged; `status` mirrors it for the richer draft/active/inactive UI.

ALTER TABLE public.sms_campaigns
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS effective_start timestamptz,
  ADD COLUMN IF NOT EXISTS effective_end timestamptz;

-- Backfill status from existing active flag without changing behavior.
UPDATE public.sms_campaigns
  SET status = CASE WHEN active THEN 'active' ELSE 'inactive' END
  WHERE status = 'draft';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sms_campaigns_status_chk'
  ) THEN
    ALTER TABLE public.sms_campaigns
      ADD CONSTRAINT sms_campaigns_status_chk CHECK (status IN ('draft','active','inactive'));
  END IF;
END$$;

ALTER TABLE public.sms_campaign_steps
  ADD COLUMN IF NOT EXISTS is_marketing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_hours_only boolean NOT NULL DEFAULT false;