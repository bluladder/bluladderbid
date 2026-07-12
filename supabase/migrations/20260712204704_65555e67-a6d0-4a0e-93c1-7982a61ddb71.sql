-- Versioning + revision history for business_knowledge
ALTER TABLE public.business_knowledge
  ADD COLUMN IF NOT EXISTS effective_date date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.business_knowledge_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id uuid NOT NULL,
  knowledge_key text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  is_active boolean NOT NULL,
  effective_date date NOT NULL,
  revision integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

GRANT SELECT ON public.business_knowledge_revisions TO authenticated;
GRANT ALL ON public.business_knowledge_revisions TO service_role;
ALTER TABLE public.business_knowledge_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read knowledge revisions" ON public.business_knowledge_revisions;
CREATE POLICY "Admins can read knowledge revisions"
  ON public.business_knowledge_revisions FOR SELECT
  USING (is_admin());

-- Trigger: on meaningful change, snapshot the OLD row and bump revision.
CREATE OR REPLACE FUNCTION public.log_business_knowledge_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.content IS DISTINCT FROM NEW.content)
     OR (OLD.title IS DISTINCT FROM NEW.title)
     OR (OLD.is_active IS DISTINCT FROM NEW.is_active)
     OR (OLD.category IS DISTINCT FROM NEW.category) THEN
    INSERT INTO public.business_knowledge_revisions
      (knowledge_id, knowledge_key, category, title, content, is_active, effective_date, revision, changed_by)
    VALUES
      (OLD.id, OLD.knowledge_key, OLD.category, OLD.title, OLD.content, OLD.is_active, OLD.effective_date, OLD.revision, auth.uid());
    NEW.revision := OLD.revision + 1;
    NEW.effective_date := current_date;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_knowledge_revision ON public.business_knowledge;
CREATE TRIGGER trg_business_knowledge_revision
  BEFORE UPDATE ON public.business_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.log_business_knowledge_revision();

-- Service area: primary cities live in allowed_cities; add county-based manual review.
ALTER TABLE public.service_area_config
  ADD COLUMN IF NOT EXISTS state_code text NOT NULL DEFAULT 'TX',
  ADD COLUMN IF NOT EXISTS manual_review_counties jsonb NOT NULL DEFAULT '["Collin"]'::jsonb;