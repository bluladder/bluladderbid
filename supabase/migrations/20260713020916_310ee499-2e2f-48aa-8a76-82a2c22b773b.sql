ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS conversation_state text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_slot_id text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_state ON public.chat_conversations (conversation_state);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_needs_attention ON public.chat_conversations (needs_attention) WHERE needs_attention = true;