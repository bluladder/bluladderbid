CREATE TABLE public.message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  channel TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('sms','email','both')),
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT,
  body TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view message templates"
  ON public.message_templates FOR SELECT
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE POLICY "Operations admins can manage message templates"
  ON public.message_templates FOR ALL
  TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE TRIGGER update_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.message_templates (name, description, channel, category, subject, body) VALUES
('Quote ready (text)', 'Let a customer know their bid is ready to view', 'sms', 'quote',
  NULL, 'Hi {{first_name}}, your BluLadder quote for {{service}} is ready: {{link}} Reply STOP to opt out.'),
('Quote ready (email)', 'Email version of the quote-ready notice', 'email', 'quote',
  'Your BluLadder quote is ready', 'Hi {{first_name}},

Your quote for {{service}} is ready to review. You can view it here:

{{link}}

Total: {{total}}

- The BluLadder Team'),
('Appointment confirmed (text)', 'Confirm a scheduled appointment', 'sms', 'appointment',
  NULL, 'Hi {{first_name}}, your {{service}} appointment is confirmed for {{date}} at {{time}}. Details: {{link}} Reply STOP to opt out.'),
('Appointment confirmed (email)', 'Email confirmation for a scheduled appointment', 'email', 'appointment',
  'Your appointment is confirmed', 'Hi {{first_name}},

Your {{service}} appointment is confirmed for {{date}} at {{time}}.

View the details here: {{link}}

- The BluLadder Team'),
('Friendly follow-up (text)', 'General nudge for customers who have not responded', 'sms', 'follow_up',
  NULL, 'Hi {{first_name}}, just checking in from BluLadder about your {{service}}. Any questions? {{link}} Reply STOP to opt out.'),
('Thanks for booking (email)', 'Thank-you note after a booking', 'email', 'follow_up',
  'Thanks for choosing BluLadder', 'Hi {{first_name}},

Thank you for booking your {{service}} with us on {{date}}. We look forward to serving you!

{{link}}

- The BluLadder Team');