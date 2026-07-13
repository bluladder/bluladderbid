DELETE FROM public.chat_messages
  WHERE conversation_id IN (
    SELECT id FROM public.chat_conversations
    WHERE session_token = 'precheckgeocode0713verify'
  );
DELETE FROM public.chat_conversations
  WHERE session_token = 'precheckgeocode0713verify';