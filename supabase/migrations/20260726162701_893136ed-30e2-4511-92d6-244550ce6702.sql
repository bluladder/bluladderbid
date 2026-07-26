-- 1. ai_metadata provenance column on chat_messages (internal only; no policy change needed —
--    existing "Admins can view chat messages" policy already covers reads).
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS ai_metadata jsonb;

-- 2. Allow "deprecated" review_status for retiring knowledge without deleting audit history.
ALTER TABLE public.business_knowledge
  DROP CONSTRAINT IF EXISTS business_knowledge_review_status_check;
ALTER TABLE public.business_knowledge
  ADD CONSTRAINT business_knowledge_review_status_check
  CHECK (review_status = ANY (ARRAY['published','draft','conflict','rejected','deprecated']));

-- 3. Widen source_type to include owner_knowledge_project (for the 300-record seed load).
ALTER TABLE public.business_knowledge
  DROP CONSTRAINT IF EXISTS business_knowledge_source_type_check;
ALTER TABLE public.business_knowledge
  ADD CONSTRAINT business_knowledge_source_type_check
  CHECK (source_type = ANY (ARRAY['manual','website','app_config','seed','owner_knowledge_project']));

-- 4. Idempotent seed of 300 draft records (kb:201..kb:500).
--    Uses ON CONFLICT (knowledge_key) DO UPDATE so re-runs are safe and never
--    touch published/manual records. Only rows whose source_type is
--    'owner_knowledge_project' are updated on conflict.
WITH ranges AS (
  SELECT n,
    CASE
      WHEN n BETWEEN 201 AND 250 THEN 'specialty_exterior'
      WHEN n BETWEEN 251 AND 300 THEN 'christmas_lights'
      WHEN n BETWEEN 301 AND 350 THEN 'pricing_packages'
      WHEN n BETWEEN 351 AND 400 THEN 'booking_operations'
      WHEN n BETWEEN 401 AND 450 THEN 'complaints_guarantees'
      ELSE 'ai_governance'
    END AS category,
    CASE
      WHEN n BETWEEN 201 AND 250 THEN ARRAY['solar_panels','roof_washing','specialty_exterior']
      WHEN n BETWEEN 251 AND 300 THEN ARRAY['christmas_lights','holiday_lighting','install']
      WHEN n BETWEEN 301 AND 350 THEN ARRAY['pricing','discounts','packages','maintenance_plan']
      WHEN n BETWEEN 351 AND 400 THEN ARRAY['estimates','booking','scheduling','access','weather','payments','operations']
      WHEN n BETWEEN 401 AND 450 THEN ARRAY['complaints','guarantees','property_concerns','damage','service_recovery']
      ELSE ARRAY['ai_governance','privacy','consent','escalation','quote_boundaries','internal_rules']
    END AS tags,
    CASE
      WHEN n BETWEEN 201 AND 250 THEN 'Specialty exterior cleaning topic #' || (n - 200)::text
      WHEN n BETWEEN 251 AND 300 THEN 'Christmas light installation topic #' || (n - 250)::text
      WHEN n BETWEEN 301 AND 350 THEN 'Pricing / packages / maintenance-plan topic #' || (n - 300)::text
      WHEN n BETWEEN 351 AND 400 THEN 'Booking / scheduling / operations topic #' || (n - 350)::text
      WHEN n BETWEEN 401 AND 450 THEN 'Complaints / guarantees / service-recovery topic #' || (n - 400)::text
      ELSE 'AI governance / consent / internal-rules topic #' || (n - 450)::text
    END AS title
  FROM generate_series(201, 500) AS g(n)
)
INSERT INTO public.business_knowledge (
  knowledge_key, record_number, category, title, question, content, voice_answer,
  internal_policy, sales_guidance, tags, owner_notes,
  review_status, is_active, requires_owner_review, requires_admin_input,
  source_type, confidence, priority, sort_order
)
SELECT
  'kb:' || r.n,
  r.n,
  r.category,
  r.title,
  'What is the BluLadder rule for: ' || r.title || '?',
  'OWNER REVIEW REQUIRED. This is a placeholder draft in the owner-knowledge-base project. '
    || 'Do not answer customers from this record until an admin has replaced this text with a verified '
    || 'BluLadder-specific answer. Do not invent exact prices, warranties, legal commitments, or time '
    || 'guarantees. If a customer asks about this topic and only this placeholder exists, defer to a '
    || 'human callback rather than guessing.',
  NULL,
  'Draft — needs owner-authored policy. Never quote a price, warranty, or guaranteed timeline from this record.',
  'Draft — needs owner-authored sales guidance. Ask the owner before promising anything.',
  r.tags,
  'Seeded ' || to_char(now(), 'YYYY-MM-DD') || ' as part of the 300-record owner knowledge project (records 201–500). '
    || 'Requires owner review before publishing.',
  'draft',
  false,
  true,
  true,
  'owner_knowledge_project',
  'medium',
  500,
  r.n
FROM ranges r
ON CONFLICT (knowledge_key) DO UPDATE
SET
  record_number = EXCLUDED.record_number,
  category      = CASE WHEN business_knowledge.source_type = 'owner_knowledge_project'
                       THEN EXCLUDED.category ELSE business_knowledge.category END,
  title         = CASE WHEN business_knowledge.source_type = 'owner_knowledge_project'
                       THEN EXCLUDED.title    ELSE business_knowledge.title    END,
  tags          = CASE WHEN business_knowledge.source_type = 'owner_knowledge_project'
                       THEN EXCLUDED.tags     ELSE business_knowledge.tags     END,
  owner_notes   = CASE WHEN business_knowledge.source_type = 'owner_knowledge_project'
                       THEN EXCLUDED.owner_notes ELSE business_knowledge.owner_notes END
WHERE business_knowledge.source_type = 'owner_knowledge_project';

-- 5. report_knowledge_feedback RPC — used by the knowledge-feedback edge function.
--    SECURITY DEFINER so anonymous submissions can insert into knowledge_feedback,
--    but body is bounded and rate-limited by the calling edge function.
CREATE OR REPLACE FUNCTION public.report_knowledge_feedback(
  p_conversation_id uuid,
  p_message_id uuid,
  p_knowledge_keys text[],
  p_answer_text text,
  p_reporter_note text,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.knowledge_feedback (
    conversation_id, message_id, knowledge_keys, answer_text, reporter_note, status, created_by
  ) VALUES (
    p_conversation_id,
    p_message_id,
    COALESCE(p_knowledge_keys, ARRAY[]::text[]),
    NULLIF(LEFT(COALESCE(p_answer_text,''), 4000), ''),
    NULLIF(LEFT(COALESCE(p_reporter_note,''), 2000), ''),
    'open',
    p_created_by
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_knowledge_feedback(uuid, uuid, text[], text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_knowledge_feedback(uuid, uuid, text[], text, text, uuid) TO service_role;
