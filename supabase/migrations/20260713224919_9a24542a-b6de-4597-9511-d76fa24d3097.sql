-- Escalation notification: per-recipient email + email alert config + delivery audit
ALTER TABLE public.escalation_recipients ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.escalation_settings ADD COLUMN IF NOT EXISTS email_alerts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.escalation_settings ADD COLUMN IF NOT EXISTS notify_email text;

-- Delivery-status audit for internal alerts (SMS + email), surfaced in System Health.
ALTER TABLE public.ai_escalations ADD COLUMN IF NOT EXISTS alert_error text;
ALTER TABLE public.ai_escalations ADD COLUMN IF NOT EXISTS email_alert_status text;
ALTER TABLE public.ai_escalations ADD COLUMN IF NOT EXISTS email_alert_error text;

-- Track consecutive slot-selection failures so the AI escalates instead of looping.
ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS slot_failure_count integer NOT NULL DEFAULT 0;