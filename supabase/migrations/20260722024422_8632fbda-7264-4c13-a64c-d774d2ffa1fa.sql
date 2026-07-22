
-- 1. Extend knowledge_gaps ---------------------------------------------------
ALTER TABLE public.knowledge_gaps
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS exact_question text,
  ADD COLUMN IF NOT EXISTS conversion_outcome text,
  ADD COLUMN IF NOT EXISTS suggested_answer text,
  ADD COLUMN IF NOT EXISTS grouping_confidence numeric(4,3)
    NOT NULL DEFAULT 1 CHECK (grouping_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS grouping_key text,
  ADD COLUMN IF NOT EXISTS approved_answer_version integer,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill grouping_key from existing normalized_question so uniqueness swap is safe.
UPDATE public.knowledge_gaps
   SET grouping_key = 'grp:' || normalized_question
 WHERE grouping_key IS NULL;

-- Swap uniqueness: normalized_question can now repeat (low-confidence rows);
-- grouping_key becomes the true de-dupe key.
ALTER TABLE public.knowledge_gaps
  DROP CONSTRAINT IF EXISTS knowledge_gaps_normalized_question_key;

ALTER TABLE public.knowledge_gaps
  ALTER COLUMN grouping_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_gaps_grouping_key_uidx
  ON public.knowledge_gaps (grouping_key);

-- Widen status list to include approval lifecycle.
ALTER TABLE public.knowledge_gaps
  DROP CONSTRAINT IF EXISTS knowledge_gaps_status_check;
ALTER TABLE public.knowledge_gaps
  ADD CONSTRAINT knowledge_gaps_status_check
  CHECK (status IN (
    'open','in_progress','resolved','dismissed',
    'approved','rejected','duplicate'
  ));

-- 2. Review queue ------------------------------------------------------------
CREATE TABLE public.conversation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  signals text[] NOT NULL DEFAULT '{}',
  signal_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  outcome text,
  quote_state text,
  booking_state text,
  model_version text,
  prompt_version text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_review','resolved','dismissed')),
  assigned_admin uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)
);

CREATE INDEX idx_conversation_reviews_status
  ON public.conversation_reviews (status, created_at DESC);
CREATE INDEX idx_conversation_reviews_signals
  ON public.conversation_reviews USING GIN (signals);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_reviews TO authenticated;
GRANT ALL ON public.conversation_reviews TO service_role;

ALTER TABLE public.conversation_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage conversation reviews"
  ON public.conversation_reviews FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER trg_conversation_reviews_updated_at
  BEFORE UPDATE ON public.conversation_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
