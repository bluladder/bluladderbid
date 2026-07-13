-- Cleanup of the controlled geocoding verification precheck session.
-- Removes only the transient precheck conversation + messages. No live
-- customer, Jobber, campaign or message data is affected.
DELETE FROM public.chat_messages
  WHERE conversation_id IN (
    SELECT id FROM public.chat_conversations
    WHERE session_token = 'precheckgeocode0713verify'
  );
DELETE FROM public.chat_conversations
  WHERE session_token = 'precheckgeocode0713verify';
