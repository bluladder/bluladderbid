
-- 1. Config: visible / configurable inactivity threshold ---------------------
CREATE TABLE public.analytics_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  inactivity_threshold_minutes integer NOT NULL DEFAULT 60
    CHECK (inactivity_threshold_minutes BETWEEN 1 AND 43200),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.analytics_config TO authenticated;
GRANT ALL ON public.analytics_config TO service_role;

ALTER TABLE public.analytics_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view analytics config"
  ON public.analytics_config FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can insert analytics config"
  ON public.analytics_config FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update analytics config"
  ON public.analytics_config FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO public.analytics_config (id, inactivity_threshold_minutes)
VALUES (true, 60)
ON CONFLICT (id) DO NOTHING;

-- 2. Classified outcomes ----------------------------------------------------
CREATE TABLE public.conversation_outcomes (
  conversation_id uuid PRIMARY KEY
    REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN (
    'booked_automatically',
    'booked_after_human_assistance',
    'quote_not_booked',
    'waiting_on_customer',
    'customer_inactive',
    'explicit_decline',
    'outside_service_area',
    'unsupported_scope',
    'human_escalation',
    'complaint_or_service_issue',
    'ai_or_tool_failure',
    'duplicate_or_spam',
    'unknown'
  )),
  deterministic boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 1
    CHECK (confidence BETWEEN 0 AND 1),
  classifier_version text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  inactivity_threshold_minutes_used integer NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_outcomes_outcome
  ON public.conversation_outcomes (outcome);
CREATE INDEX idx_conversation_outcomes_classified_at
  ON public.conversation_outcomes (classified_at DESC);

GRANT SELECT ON public.conversation_outcomes TO authenticated;
GRANT ALL ON public.conversation_outcomes TO service_role;

ALTER TABLE public.conversation_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view conversation outcomes"
  ON public.conversation_outcomes FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Writes only happen from edge functions / classifier via service_role,
-- which bypasses RLS. No INSERT/UPDATE policies for authenticated users.

-- updated_at trigger reuse
CREATE TRIGGER trg_conversation_outcomes_updated_at
  BEFORE UPDATE ON public.conversation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_analytics_config_updated_at
  BEFORE UPDATE ON public.analytics_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
