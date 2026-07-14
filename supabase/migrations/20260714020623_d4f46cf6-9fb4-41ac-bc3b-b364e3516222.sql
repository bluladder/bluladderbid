ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_role_check
  CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text, 'system'::text, 'staff'::text]));