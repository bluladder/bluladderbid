
-- ============================================================================
-- Knowledge management, monitoring & human-escalation foundation.
-- Reuses existing helpers: public.is_admin(), public.update_updated_at_column().
-- ============================================================================

-- ---------- 1. Centralized business phone numbers ----------
CREATE TABLE public.phone_numbers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purpose text NOT NULL UNIQUE
    CHECK (purpose IN ('primary_public','app_ai','responsibid','escalation_sender')),
  e164 text NOT NULL,
  display_format text NOT NULL,
  label text NOT NULL,
  description text,
  provider text,
  is_public boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  effective_date date NOT NULL DEFAULT current_date,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.phone_numbers TO anon;
GRANT SELECT ON public.phone_numbers TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.phone_numbers TO authenticated;
GRANT ALL ON public.phone_numbers TO service_role;
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active public phone numbers"
  ON public.phone_numbers FOR SELECT
  USING ((is_active = true AND is_public = true) OR public.is_admin());
CREATE POLICY "Admins insert phone numbers"
  ON public.phone_numbers FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins update phone numbers"
  ON public.phone_numbers FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins delete phone numbers"
  ON public.phone_numbers FOR DELETE USING (public.is_admin());

CREATE TABLE public.phone_number_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_id uuid NOT NULL,
  purpose text NOT NULL,
  e164 text NOT NULL,
  display_format text NOT NULL,
  label text NOT NULL,
  is_public boolean NOT NULL,
  is_active boolean NOT NULL,
  revision integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);
GRANT SELECT ON public.phone_number_revisions TO authenticated;
GRANT ALL ON public.phone_number_revisions TO service_role;
ALTER TABLE public.phone_number_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read phone revisions"
  ON public.phone_number_revisions FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.log_phone_number_revision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.e164 IS DISTINCT FROM NEW.e164)
     OR (OLD.display_format IS DISTINCT FROM NEW.display_format)
     OR (OLD.label IS DISTINCT FROM NEW.label)
     OR (OLD.is_public IS DISTINCT FROM NEW.is_public)
     OR (OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
    INSERT INTO public.phone_number_revisions
      (phone_id, purpose, e164, display_format, label, is_public, is_active, revision, changed_by)
    VALUES
      (OLD.id, OLD.purpose, OLD.e164, OLD.display_format, OLD.label, OLD.is_public, OLD.is_active, OLD.revision, auth.uid());
    NEW.revision := OLD.revision + 1;
    NEW.effective_date := current_date;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_phone_number_revision
  BEFORE UPDATE ON public.phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.log_phone_number_revision();

-- Seed the three approved numbers by purpose.
INSERT INTO public.phone_numbers (purpose, e164, display_format, label, description, provider, is_public, is_active) VALUES
('primary_public','+18662422583','(866) 242-2583','BluLadder',
  'Primary public BluLadder business number. Use for general public contact, website contact info, "Call BluLadder" options, and when a customer wants to call the office.',
  NULL, true, true),
('app_ai','+14697472877','(469) 747-2877','BluLadder Bid',
  'BluLadder Bid / AI app number. Use for app communications, AI-chat transactional texting, app-originated follow-up, and SMS replies tied to this booking/AI system. Sending identity for internal escalation alerts when supported.',
  'callrail', false, true),
('responsibid','+14692426556','(469) 242-6556','ResponsiBid',
  'ResponsiBid integration number. Use ONLY where the ResponsiBid integration specifically requires it. Never present as the primary BluLadder contact.',
  'responsibid', false, true);

-- ---------- 2. Website-sourcing columns on business_knowledge ----------
ALTER TABLE public.business_knowledge
  ADD COLUMN IF NOT EXISTS applicable_service text,
  ADD COLUMN IF NOT EXISTS applicable_region text,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','website','app_config','seed')),
  ADD COLUMN IF NOT EXISTS source_page text,
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'published'
    CHECK (review_status IN ('published','draft','conflict','rejected')),
  ADD COLUMN IF NOT EXISTS requires_owner_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS pending_content text,
  ADD COLUMN IF NOT EXISTS pending_source_hash text;

-- Existing seeded rows are approved/published manual seeds.
UPDATE public.business_knowledge SET source_type = 'seed' WHERE source_type = 'manual';

-- ---------- 3. Knowledge gaps ----------
CREATE TABLE public.knowledge_gaps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  normalized_question text NOT NULL UNIQUE,
  example_wording text,
  service text,
  category text,
  conversation_count integer NOT NULL DEFAULT 1,
  handoff_count integer NOT NULL DEFAULT 0,
  reason text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  related_knowledge_id uuid REFERENCES public.business_knowledge(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_knowledge_gaps_status ON public.knowledge_gaps(status, conversation_count DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_gaps TO authenticated;
GRANT ALL ON public.knowledge_gaps TO service_role;
ALTER TABLE public.knowledge_gaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage knowledge gaps"
  ON public.knowledge_gaps FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- 4. AI escalations ----------
CREATE TABLE public.ai_escalations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  record_ref text,
  prospect_name text,
  prospect_phone text,
  prospect_email text,
  service_requested text,
  service_address text,
  category text NOT NULL
    CHECK (category IN ('human_request','manual_quote','complaint','damage','billing_dispute',
      'pricing_unverified','booking_needs_attention','service_area_review','unanswered_question',
      'confused_conversation','urgent','other')),
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high','urgent')),
  summary text,
  requested_contact_method text,
  best_callback_time text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','resolved','cancelled')),
  assigned_recipient text,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  alert_status text NOT NULL DEFAULT 'pending'
    CHECK (alert_status IN ('pending','sent','suppressed','no_recipient','failed')),
  alert_count integer NOT NULL DEFAULT 0,
  last_alert_severity text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One active escalation per conversation + category (idempotency / noise control).
CREATE UNIQUE INDEX uq_ai_escalations_active
  ON public.ai_escalations(conversation_id, category)
  WHERE status IN ('open','claimed');
CREATE INDEX idx_ai_escalations_status ON public.ai_escalations(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_escalations TO authenticated;
GRANT ALL ON public.ai_escalations TO service_role;
ALTER TABLE public.ai_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ai escalations"
  ON public.ai_escalations FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- 5. Escalation recipients & settings ----------
CREATE TABLE public.escalation_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  role text NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','backup')),
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  handles_urgent boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalation_recipients TO authenticated;
GRANT ALL ON public.escalation_recipients TO service_role;
ALTER TABLE public.escalation_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage escalation recipients"
  ON public.escalation_recipients FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.escalation_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  internal_alerts_enabled boolean NOT NULL DEFAULT false,
  business_hours_start integer NOT NULL DEFAULT 8,
  business_hours_end integer NOT NULL DEFAULT 18,
  after_hours_behavior text NOT NULL DEFAULT 'queue' CHECK (after_hours_behavior IN ('queue','alert','suppress')),
  dashboard_base_url text,
  alert_cooldown_minutes integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.escalation_settings TO authenticated;
GRANT ALL ON public.escalation_settings TO service_role;
ALTER TABLE public.escalation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read escalation settings"
  ON public.escalation_settings FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins insert escalation settings"
  ON public.escalation_settings FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins update escalation settings"
  ON public.escalation_settings FOR UPDATE USING (public.is_admin());
INSERT INTO public.escalation_settings (singleton, internal_alerts_enabled) VALUES (true, false);

-- ---------- 6. System issues (operational incidents) ----------
CREATE TABLE public.system_issues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_type text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  associated_ref text,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  suggested_action text,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes text,
  details jsonb,
  last_alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_system_issues_status ON public.system_issues(status, severity, last_seen_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_issues TO authenticated;
GRANT ALL ON public.system_issues TO service_role;
ALTER TABLE public.system_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage system issues"
  ON public.system_issues FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- updated_at triggers ----------
CREATE TRIGGER trg_phone_numbers_updated_at BEFORE UPDATE ON public.phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_knowledge_gaps_updated_at BEFORE UPDATE ON public.knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ai_escalations_updated_at BEFORE UPDATE ON public.ai_escalations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_escalation_recipients_updated_at BEFORE UPDATE ON public.escalation_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_escalation_settings_updated_at BEFORE UPDATE ON public.escalation_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_system_issues_updated_at BEFORE UPDATE ON public.system_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
