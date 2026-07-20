ALTER TABLE public.campaign_enrollments
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;

CREATE INDEX IF NOT EXISTS campaign_enrollments_paused_until_idx
  ON public.campaign_enrollments (paused_until)
  WHERE status = 'paused';

COMMENT ON COLUMN public.campaign_enrollments.paused_until IS
  'Scheduled auto-resume time. When an inbound customer reply routes to the AI orchestrator, the enrollment is paused (status=paused, paused_at=now, paused_until=now+72h). The queue processor defers sends until this time and the campaign sweep re-activates the enrollment when it elapses, provided no permanent stop condition (booking, opt-out, revoked consent, decline, suppression, human takeover, newer quote supersession, escalation) has occurred. Null on non-paused rows and on admin-initiated pauses (which have no automatic resume).';