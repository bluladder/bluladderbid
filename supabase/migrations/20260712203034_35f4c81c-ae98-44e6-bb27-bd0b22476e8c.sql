-- =====================================================================
-- AI website chat: channel-independent conversation store, admin-editable
-- business knowledge, and service-area configuration.
-- Clients NEVER read/write these directly; the ai-chat edge function uses
-- the service role and scopes every read to the caller's session token.
-- =====================================================================

-- ---------- chat_conversations ----------
CREATE TABLE public.chat_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_token TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','voice')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','abandoned')),
  prospect_name TEXT,
  prospect_phone TEXT,
  prospect_email TEXT,
  contact_method TEXT,
  best_time_to_contact TEXT,
  summary TEXT,
  services_discussed JSONB NOT NULL DEFAULT '[]'::jsonb,
  quote_result JSONB,
  pricing_version INTEGER,
  booking_status TEXT NOT NULL DEFAULT 'none'
    CHECK (booking_status IN ('none','quoted','confirmed','needs_attention','failed')),
  manual_review_reason TEXT,
  callback_requested BOOLEAN NOT NULL DEFAULT false,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  campaign_status TEXT,
  needs_attention BOOLEAN NOT NULL DEFAULT false,
  assigned_admin UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  internal_notes TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_conversations_session ON public.chat_conversations(session_token);
CREATE INDEX idx_chat_conversations_status ON public.chat_conversations(status, needs_attention);

GRANT SELECT, UPDATE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

-- Admins only for direct table reads/updates. Anonymous prospects reach their
-- own conversation exclusively through the edge function (service role).
CREATE POLICY "Admins can view chat conversations"
  ON public.chat_conversations FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update chat conversations"
  ON public.chat_conversations FOR UPDATE USING (public.is_admin());

-- ---------- chat_messages ----------
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT,
  tool_name TEXT,
  tool_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conversation ON public.chat_messages(conversation_id, created_at);

GRANT SELECT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view chat messages"
  ON public.chat_messages FOR SELECT USING (public.is_admin());

-- ---------- business_knowledge (admin-editable approved facts) ----------
CREATE TABLE public.business_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  knowledge_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  requires_admin_input BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.business_knowledge TO anon;
GRANT SELECT ON public.business_knowledge TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.business_knowledge TO authenticated;
GRANT ALL ON public.business_knowledge TO service_role;
ALTER TABLE public.business_knowledge ENABLE ROW LEVEL SECURITY;

-- Active facts are public (safe, customer-facing). Admins manage all rows.
CREATE POLICY "Anyone can read active business knowledge"
  ON public.business_knowledge FOR SELECT USING (is_active = true OR public.is_admin());
CREATE POLICY "Admins can insert business knowledge"
  ON public.business_knowledge FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update business knowledge"
  ON public.business_knowledge FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete business knowledge"
  ON public.business_knowledge FOR DELETE USING (public.is_admin());

-- ---------- service_area_config ----------
CREATE TABLE public.service_area_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  center_address TEXT,
  radius_miles NUMERIC,
  allowed_postal_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_cities JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_configured BOOLEAN NOT NULL DEFAULT false,
  out_of_area_message TEXT NOT NULL DEFAULT 'That address looks like it may be outside our normal service area. I can pass your details to the team to confirm and follow up.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.service_area_config TO authenticated;
GRANT ALL ON public.service_area_config TO service_role;
ALTER TABLE public.service_area_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read service area config"
  ON public.service_area_config FOR SELECT USING (true);
CREATE POLICY "Admins can insert service area config"
  ON public.service_area_config FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update service area config"
  ON public.service_area_config FOR UPDATE USING (public.is_admin());

-- ---------- updated_at triggers ----------
CREATE TRIGGER trg_chat_conversations_updated_at
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_business_knowledge_updated_at
  BEFORE UPDATE ON public.business_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_service_area_config_updated_at
  BEFORE UPDATE ON public.service_area_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Seed approved service facts (safe, derived from list_services) ----------
INSERT INTO public.business_knowledge (knowledge_key, category, title, content, is_active, sort_order) VALUES
('service_window_cleaning','service','Window Cleaning','Interior and exterior window cleaning, priced per square foot with story and condition modifiers.',true,10),
('service_gutter_cleaning','service','Gutter Cleaning','Gutter cleanout with optional underground drain flushing, minor repairs, and micro-mesh gutter guards.',true,20),
('service_roof_cleaning','service','Roof Cleaning','Soft-wash roof cleaning priced per square foot with roof type and severity modifiers.',true,30),
('service_house_wash','service','House Wash','Exterior house soft-washing priced per square foot, with a surcharge for rust and irrigation stains.',true,40),
('service_driveway_cleaning','service','Driveway Cleaning','Pressure washing for driveways, priced per square foot by surface type.',true,50),
('service_pressure_washing','service','Pressure Washing (Flatwork)','Pressure washing for patios, walkways, and other flatwork, priced per square foot.',true,60);

-- Placeholder policy/knowledge rows that MUST be filled in by an admin before
-- the AI is allowed to state them. Inactive => the AI will not use them.
INSERT INTO public.business_knowledge (knowledge_key, category, title, content, is_active, requires_admin_input, sort_order) VALUES
('policy_service_area','policy','Service Area','PENDING ADMIN INPUT — describe the cities/ZIP codes BluLadder serves.',false,true,100),
('policy_rain','policy','Rain / Weather Policy','PENDING ADMIN INPUT — describe how weather reschedules are handled.',false,true,110),
('policy_guarantee','policy','Satisfaction Guarantee','PENDING ADMIN INPUT — describe the guarantee, if any.',false,true,120),
('policy_preparation','policy','Preparation Instructions','PENDING ADMIN INPUT — what should the customer do before the crew arrives?',false,true,130),
('policy_payment','policy','Payment Expectations','PENDING ADMIN INPUT — when and how does BluLadder collect payment?',false,true,140),
('policy_appointment','policy','Appointment Expectations','PENDING ADMIN INPUT — arrival windows, notifications, access requirements.',false,true,150),
('policy_manual_quote','policy','Manual-Quote Conditions','Screens, tracks and sills not already included in a package, solar-panel cleaning, mobile screen repair, commercial work, and unusual restoration or access conditions require a manual quote from the team.',true,false,160),
('policy_contact','policy','Contact & Escalation','PENDING ADMIN INPUT — phone/email for BluLadder and when to escalate to a person.',false,true,170);

-- Service-area singleton (unconfigured until admin sets it).
INSERT INTO public.service_area_config (singleton, is_configured) VALUES (true, false);