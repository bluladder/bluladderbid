
ALTER TABLE public.chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_channel_check;
ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_channel_check
  CHECK (channel = ANY (ARRAY['web'::text, 'voice'::text, 'sms'::text]));

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS resolution_method text,
  ADD COLUMN IF NOT EXISTS resolution_confidence text,
  ADD COLUMN IF NOT EXISTS unresolved_reason text,
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;

ALTER TABLE public.chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_resolution_confidence_check;
ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_resolution_confidence_check
  CHECK (resolution_confidence IS NULL OR resolution_confidence = ANY (ARRAY['high','medium','low','ambiguous','unknown']));

CREATE INDEX IF NOT EXISTS idx_chat_conversations_sms_phone
  ON public.chat_conversations (prospect_phone)
  WHERE channel = 'sms';

CREATE INDEX IF NOT EXISTS idx_chat_conversations_customer_id
  ON public.chat_conversations (customer_id)
  WHERE customer_id IS NOT NULL;

ALTER TABLE public.callrail_inbound_events
  ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_notification_skipped_reason text;

DO $$
DECLARE
  v_customer_linked int := 0;
  v_threads_created int := 0;
  v_thread_linked int := 0;
  v_ambiguous int := 0;
  v_unmatched int := 0;
  rec record;
  v_customer_id uuid;
  v_match_count int;
  v_conv_id uuid;
BEGIN
  FOR rec IN
    SELECT id, from_phone, to_phone, received_at, customer_id, conversation_id
    FROM public.callrail_inbound_events
    WHERE received_at >= now() - interval '30 days'
      AND from_phone IS NOT NULL
    ORDER BY received_at ASC
  LOOP
    v_match_count := NULL;
    IF rec.customer_id IS NULL THEN
      SELECT count(*) INTO v_match_count FROM public.customers WHERE phone = rec.from_phone;
      IF v_match_count = 1 THEN
        SELECT id INTO v_customer_id FROM public.customers WHERE phone = rec.from_phone LIMIT 1;
        UPDATE public.callrail_inbound_events SET customer_id = v_customer_id WHERE id = rec.id;
        v_customer_linked := v_customer_linked + 1;
      ELSIF v_match_count > 1 THEN
        v_ambiguous := v_ambiguous + 1;
        v_customer_id := NULL;
      ELSE
        v_unmatched := v_unmatched + 1;
        v_customer_id := NULL;
      END IF;
    ELSE
      v_customer_id := rec.customer_id;
    END IF;

    IF rec.conversation_id IS NULL THEN
      SELECT id INTO v_conv_id
        FROM public.chat_conversations
        WHERE channel = 'sms' AND prospect_phone = rec.from_phone
        ORDER BY last_activity_at DESC
        LIMIT 1;

      IF v_conv_id IS NULL THEN
        INSERT INTO public.chat_conversations (
          session_token, channel, status, prospect_phone, customer_id,
          resolution_method, resolution_confidence, unresolved_reason,
          last_inbound_at, last_activity_at, summary
        ) VALUES (
          'sms:' || rec.from_phone || ':' || gen_random_uuid()::text,
          'sms', 'active', rec.from_phone, v_customer_id,
          CASE WHEN v_customer_id IS NOT NULL THEN 'phone_exact' ELSE 'unresolved' END,
          CASE WHEN v_customer_id IS NOT NULL THEN 'high'
               WHEN v_match_count IS NOT NULL AND v_match_count > 1 THEN 'ambiguous'
               ELSE 'unknown' END,
          CASE WHEN v_customer_id IS NULL AND coalesce(v_match_count,0) > 1 THEN 'multiple_customers_share_phone'
               WHEN v_customer_id IS NULL THEN 'no_customer_match'
               ELSE NULL END,
          rec.received_at, rec.received_at, 'SMS conversation (backfilled)'
        )
        RETURNING id INTO v_conv_id;
        v_threads_created := v_threads_created + 1;
      ELSE
        UPDATE public.chat_conversations
        SET last_inbound_at = GREATEST(coalesce(last_inbound_at, rec.received_at), rec.received_at),
            last_activity_at = GREATEST(last_activity_at, rec.received_at),
            customer_id = COALESCE(customer_id, v_customer_id)
        WHERE id = v_conv_id;
      END IF;

      UPDATE public.callrail_inbound_events SET conversation_id = v_conv_id WHERE id = rec.id;
      v_thread_linked := v_thread_linked + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'BACKFILL: customer_linked=%, threads_created=%, events_linked_to_thread=%, ambiguous_phone=%, unmatched=%',
    v_customer_linked, v_threads_created, v_thread_linked, v_ambiguous, v_unmatched;
END$$;
