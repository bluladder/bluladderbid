DELETE FROM public.chat_conversations
WHERE session_token LIKE 'test%'
   OR session_token LIKE 'qtest%'
   OR session_token LIKE 'inj%'
   OR session_token ~ '^m[0-9]+$';