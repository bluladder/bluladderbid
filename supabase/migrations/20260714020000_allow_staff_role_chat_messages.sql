-- ============================================================================
-- Repair: customer-visible staff replies record a timeline row with
-- role='staff', but the chat_messages_role_check CHECK constraint only allowed
-- 'user','assistant','tool','system'. supabase-js .insert() does NOT throw on a
-- constraint violation, so recordTimeline() failed SILENTLY and every staff
-- reply (SMS or email, sent or failed) was missing from the conversation
-- timeline. Allow 'staff' so the audit trail is written.
-- ============================================================================
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_role_check
  CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text, 'system'::text, 'staff'::text]));
