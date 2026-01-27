-- Create table for saved embed presets
CREATE TABLE public.embed_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  selected_page TEXT NOT NULL DEFAULT '',
  embed_width TEXT NOT NULL DEFAULT '100%',
  embed_height TEXT NOT NULL DEFAULT '800',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.embed_presets ENABLE ROW LEVEL SECURITY;

-- Admins can manage all presets
CREATE POLICY "Admins can manage embed presets"
  ON public.embed_presets
  FOR ALL
  USING (is_admin());

-- Add trigger for updated_at
CREATE TRIGGER update_embed_presets_updated_at
  BEFORE UPDATE ON public.embed_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();