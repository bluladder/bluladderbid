-- Action Inbox types
DO $$ BEGIN
  CREATE TYPE public.action_inbox_type AS ENUM (
    'knowledge_gap',
    'low_confidence_answer',
    'reported_bad_answer',
    'missed_call_followup',
    'promised_callback',
    'email_draft_review',
    'complaint_or_risk',
    'quote_followup',
    'content_recommendation',
    'policy_conflict',
    'integration_error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.action_inbox_status AS ENUM (
    'open',
    'in_progress',
    'snoozed',
    'resolved',
    'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.action_inbox_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.action_inbox_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.action_inbox_type NOT NULL,
  status public.action_inbox_status NOT NULL DEFAULT 'open',
  priority public.action_inbox_priority NOT NULL DEFAULT 'normal',
  source_channel TEXT,
  customer_id UUID,
  conversation_id UUID,
  quote_id UUID,
  booking_id UUID,
  knowledge_gap_id UUID,
  knowledge_key TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  recommended_action TEXT,
  suggested_response TEXT,
  owner_user_id UUID,
  due_at TIMESTAMPTZ,
  snooze_until TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  dedupe_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS action_inbox_items_dedupe_key_idx
  ON public.action_inbox_items(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('open','in_progress','snoozed');

CREATE INDEX IF NOT EXISTS action_inbox_items_status_priority_idx
  ON public.action_inbox_items(status, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS action_inbox_items_type_status_idx
  ON public.action_inbox_items(type, status);
CREATE INDEX IF NOT EXISTS action_inbox_items_customer_idx
  ON public.action_inbox_items(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS action_inbox_items_conversation_idx
  ON public.action_inbox_items(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS action_inbox_items_snooze_idx
  ON public.action_inbox_items(snooze_until) WHERE status = 'snoozed';
CREATE INDEX IF NOT EXISTS action_inbox_items_due_idx
  ON public.action_inbox_items(due_at) WHERE due_at IS NOT NULL AND status IN ('open','in_progress');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_inbox_items TO authenticated;
GRANT ALL ON public.action_inbox_items TO service_role;

ALTER TABLE public.action_inbox_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view action inbox" ON public.action_inbox_items;
CREATE POLICY "Admins can view action inbox"
  ON public.action_inbox_items FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can insert action inbox" ON public.action_inbox_items;
CREATE POLICY "Admins can insert action inbox"
  ON public.action_inbox_items FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update action inbox" ON public.action_inbox_items;
CREATE POLICY "Admins can update action inbox"
  ON public.action_inbox_items FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete action inbox" ON public.action_inbox_items;
CREATE POLICY "Admins can delete action inbox"
  ON public.action_inbox_items FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Reuse standard updated_at trigger fn if present, else create
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS action_inbox_items_updated_at ON public.action_inbox_items;
CREATE TRIGGER action_inbox_items_updated_at
  BEFORE UPDATE ON public.action_inbox_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();