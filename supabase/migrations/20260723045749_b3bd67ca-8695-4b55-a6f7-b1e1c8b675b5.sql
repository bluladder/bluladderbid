
-- Tables first ------------------------------------------------------------
CREATE TABLE public.properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  normalized_address TEXT NOT NULL,
  street TEXT, city TEXT, state TEXT, postal_code TEXT,
  latitude NUMERIC, longitude NUMERIC,
  property_type TEXT NOT NULL DEFAULT 'residential' CHECK (property_type IN ('residential','commercial')),
  jobber_property_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_properties_normalized_address ON public.properties (normalized_address);
CREATE INDEX ix_properties_jobber ON public.properties (jobber_property_id) WHERE jobber_property_id IS NOT NULL;

CREATE TABLE public.customer_properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'owner'
    CHECK (relationship_type IN ('owner','resident','property_manager','realtor','family','authorized_contact','other')),
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  authorization_status TEXT NOT NULL DEFAULT 'self_asserted'
    CHECK (authorization_status IN ('self_asserted','verified','revoked')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, property_id)
);
CREATE INDEX ix_customer_properties_customer ON public.customer_properties (customer_id);
CREATE INDEX ix_customer_properties_property ON public.customer_properties (property_id);
CREATE UNIQUE INDEX ux_customer_properties_primary
  ON public.customer_properties (customer_id) WHERE is_primary = true;

CREATE TABLE public.property_facts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL,
  value_numeric NUMERIC,
  value_text TEXT,
  unit TEXT,
  source TEXT NOT NULL CHECK (source IN (
    'prior_quote','booking','jobber','technician','admin',
    'customer_provided','imported','ai_inferred'
  )),
  source_record_id UUID,
  verification_status TEXT NOT NULL DEFAULT 'customer_provided'
    CHECK (verification_status IN ('verified','customer_provided','inferred','conflicting','stale','needs_review')),
  confidence NUMERIC,
  observed_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_by_type TEXT NOT NULL DEFAULT 'system',
  created_by_id UUID,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (value_numeric IS NOT NULL OR value_text IS NOT NULL)
);
CREATE INDEX ix_property_facts_lookup ON public.property_facts (property_id, fact_type)
  WHERE superseded_at IS NULL;

-- Grants ------------------------------------------------------------------
GRANT SELECT ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;
GRANT SELECT ON public.customer_properties TO authenticated;
GRANT ALL ON public.customer_properties TO service_role;
GRANT SELECT ON public.property_facts TO authenticated;
GRANT ALL ON public.property_facts TO service_role;

-- Triggers ----------------------------------------------------------------
CREATE TRIGGER trg_properties_updated BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_customer_properties_updated BEFORE UPDATE ON public.customer_properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_property_facts_updated BEFORE UPDATE ON public.property_facts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS ---------------------------------------------------------------------
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage properties" ON public.properties
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE POLICY "Customers see own properties" ON public.properties
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_accounts ca
      JOIN public.customer_properties cp ON cp.customer_id = ca.customer_id
      WHERE ca.auth_user_id = auth.uid()
        AND cp.property_id = properties.id
        AND cp.active = true
    )
  );

CREATE POLICY "Admins manage customer_properties" ON public.customer_properties
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE POLICY "Customers see own customer_properties" ON public.customer_properties
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_accounts ca
      WHERE ca.auth_user_id = auth.uid() AND ca.customer_id = customer_properties.customer_id
    )
  );

CREATE POLICY "Admins manage property_facts" ON public.property_facts
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE POLICY "Customers see own property_facts" ON public.property_facts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_accounts ca
      JOIN public.customer_properties cp ON cp.customer_id = ca.customer_id
      WHERE ca.auth_user_id = auth.uid()
        AND cp.property_id = property_facts.property_id
        AND cp.active = true
    )
  );

-- Current-fact view -------------------------------------------------------
CREATE OR REPLACE VIEW public.property_facts_current
WITH (security_invoker = true) AS
SELECT DISTINCT ON (property_id, fact_type)
  id, property_id, fact_type, value_numeric, value_text, unit,
  source, source_record_id, verification_status, confidence,
  observed_at, last_verified_at, created_by_type, created_by_id,
  created_at, updated_at
FROM (
  SELECT pf.*,
    CASE pf.source
      WHEN 'technician' THEN 100 WHEN 'admin' THEN 90 WHEN 'jobber' THEN 80
      WHEN 'booking' THEN 70 WHEN 'customer_provided' THEN 60
      WHEN 'prior_quote' THEN 50 WHEN 'imported' THEN 40
      WHEN 'ai_inferred' THEN 10 ELSE 0 END AS source_rank
  FROM public.property_facts pf
  WHERE pf.superseded_at IS NULL
) ranked
ORDER BY property_id, fact_type, source_rank DESC, COALESCE(last_verified_at, observed_at, created_at) DESC;

GRANT SELECT ON public.property_facts_current TO authenticated, service_role;

-- Extend existing tables --------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'homeowner',
  ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT,
  ADD COLUMN IF NOT EXISTS preferred_phone TEXT,
  ADD COLUMN IF NOT EXISTS preferred_email TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_customer_type_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_customer_type_check
  CHECK (customer_type IN ('homeowner','realtor','property_manager','commercial','other'));

ALTER TABLE public.quote_sessions
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_quote_sessions_property ON public.quote_sessions (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_chat_conversations_property ON public.chat_conversations (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_quotes_property ON public.quotes (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bookings_property ON public.bookings (property_id) WHERE property_id IS NOT NULL;
