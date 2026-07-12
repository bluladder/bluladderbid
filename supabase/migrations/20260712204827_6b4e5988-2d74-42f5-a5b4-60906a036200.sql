ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS service_address text,
  ADD COLUMN IF NOT EXISTS service_area_status text,
  ADD COLUMN IF NOT EXISTS service_area_result jsonb;