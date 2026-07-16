
-- Recreate eligibility_rules_public with security_invoker so it uses the querying user's permissions
DROP VIEW IF EXISTS public.eligibility_rules_public;

CREATE VIEW public.eligibility_rules_public
WITH (security_invoker = true) AS
SELECT id, rule_name, priority, conditions, rule_type, is_active, description, created_at, updated_at
FROM public.eligibility_rules
WHERE is_active = true;

GRANT SELECT ON public.eligibility_rules_public TO anon, authenticated;

-- Column-level SELECT on base table (non-sensitive columns only) so the invoker view works for anon/authenticated
GRANT SELECT (id, rule_name, priority, conditions, rule_type, is_active, description, created_at, updated_at)
  ON public.eligibility_rules TO anon, authenticated;

-- RLS policy allowing anyone to read active rules (columns restricted via grants above)
DROP POLICY IF EXISTS "Public can view active rules via view" ON public.eligibility_rules;
CREATE POLICY "Public can view active rules via view"
  ON public.eligibility_rules
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);
