DO $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.chat_conversations
  WHERE session_token LIKE 'cleanverify_%';

  IF v_ids IS NOT NULL THEN
    DELETE FROM public.chat_messages WHERE conversation_id = ANY(v_ids);
    DELETE FROM public.chat_conversations WHERE id = ANY(v_ids);
  END IF;
END $$;