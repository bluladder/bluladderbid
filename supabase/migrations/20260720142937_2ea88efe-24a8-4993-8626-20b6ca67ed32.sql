
-- Mark the terminal phase of the Unbooked Quote Follow-Up 12-month sequence so
-- the completion sweep knows which enrollments trigger the post-12-month
-- lifecycle transition. Existing 22-step cadence + templates + consent are
-- unchanged.
ALTER TABLE public.sms_campaigns
  ADD COLUMN IF NOT EXISTS is_terminal_phase boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sms_campaigns.is_terminal_phase IS
  'When true, an enrollment that finishes all scheduled steps for this campaign is treated as the end of a multi-phase lifecycle. Used by the completion sweep to emit quote_follow_up_completed.';

-- Phase 3 (Days 210-365) is the terminal phase of the 12-month sequence.
UPDATE public.sms_campaigns
  SET is_terminal_phase = true
  WHERE id = '33333333-3333-4333-9333-333333333333'::uuid;

-- Post-12-month long-term nurture destination. Kept inactive/draft; owner
-- will approve activation. Uses the canonical event ingress
-- (quote_follow_up_completed) so no parallel scheduler is required.
INSERT INTO public.sms_campaigns (
  id, name, description, campaign_kind, event_name,
  required_consent, active, status, version,
  reentry_enabled, audience_conditions
) VALUES (
  '44444444-4444-4444-9444-444444444444'::uuid,
  'BluLadder Long-Term Home Care Nurture (Post 12-Month)',
  'Receives eligible leads after the Unbooked Quote Follow-Up 12-month sequence completes without booking. Owner approves activation.',
  'lifecycle',
  'quote_follow_up_completed',
  'marketing',
  false,
  'draft',
  1,
  false,
  '{"opted_out": false}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
