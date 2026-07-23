
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS pending_draft_reply text,
  ADD COLUMN IF NOT EXISTS draft_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_source_message_id uuid,
  ADD COLUMN IF NOT EXISTS draft_status text,
  ADD COLUMN IF NOT EXISTS draft_error text,
  ADD COLUMN IF NOT EXISTS draft_model text,
  ADD COLUMN IF NOT EXISTS draft_context_version text,
  ADD COLUMN IF NOT EXISTS draft_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_sent_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_draft_status_chk'
  ) THEN
    ALTER TABLE public.chat_conversations
      ADD CONSTRAINT chat_conversations_draft_status_chk
      CHECK (draft_status IS NULL OR draft_status IN
        ('pending','ready','edited','sent','discarded','failed','superseded'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS chat_conversations_draft_status_idx
  ON public.chat_conversations (draft_status)
  WHERE draft_status IN ('ready','edited','pending');
