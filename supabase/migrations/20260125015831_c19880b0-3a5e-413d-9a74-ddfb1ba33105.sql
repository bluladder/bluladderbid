-- Create pricing configuration table for admin control
CREATE TABLE public.pricing_config (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    config_key TEXT NOT NULL UNIQUE,
    config_value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

-- Create admin role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table for admin access control
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check admin role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- RLS policies for pricing_config: public read, admin write
CREATE POLICY "Anyone can read pricing config" 
ON public.pricing_config 
FOR SELECT 
USING (true);

CREATE POLICY "Admins can insert pricing config" 
ON public.pricing_config 
FOR INSERT 
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update pricing config" 
ON public.pricing_config 
FOR UPDATE 
USING (public.is_admin());

CREATE POLICY "Admins can delete pricing config" 
ON public.pricing_config 
FOR DELETE 
USING (public.is_admin());

-- RLS policies for user_roles: only admins can manage roles
CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles" 
ON public.user_roles 
FOR ALL 
TO authenticated
USING (public.is_admin());

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_pricing_config_updated_at
BEFORE UPDATE ON public.pricing_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default pricing configuration
INSERT INTO public.pricing_config (config_key, config_value, description) VALUES
('window_base_rates', '{
  "exteriorPerSqFt": 0.045,
  "interiorPerSqFt": 0.035
}', 'Base window cleaning rates per square foot'),

('story_multipliers', '{
  "1": 1,
  "2": 1.25,
  "3": 1.5
}', 'Multipliers based on number of stories'),

('condition_multipliers', '{
  "maintenance": 1,
  "heavy": 1.4
}', 'Multipliers based on window condition'),

('window_modifiers', '{
  "hardWaterMultiplier": 0.25,
  "frenchPanesMultiplier": 0.30,
  "solarScreensMultiplier": 0.20
}', 'Percentage modifiers for window types'),

('ladder_work', '{
  "1-3": 45,
  "4-8": 85,
  "9+": 135
}', 'Flat fees for ladder work tiers'),

('sunroom', '{
  "none": 0,
  "small": 75,
  "medium": 125,
  "large": 200
}', 'Flat fees for sunroom sizes'),

('driveway', '{
  "small": 150,
  "medium": 225,
  "large": 350
}', 'Base pressure washing driveway prices'),

('surface_multipliers', '{
  "concrete": 1,
  "stamped": 1.15,
  "pavers": 1.25,
  "brick": 1.20,
  "stone": 1.30,
  "tile": 1.35
}', 'Surface type price multipliers'),

('pressure_washing_addons', '{
  "frontPorch": 75,
  "backPatio": 95,
  "poolDeck": 125,
  "sidewalks": 65
}', 'Pressure washing add-on prices'),

('gutter_cleaning', '{
  "base": 125,
  "perStory": 50,
  "perSqFt": 0.025
}', 'Gutter cleaning pricing components'),

('house_wash', '{
  "perSqFt": 0.12,
  "storyMultiplier": {"1": 1, "2": 1.3, "3": 1.6}
}', 'House wash pricing per sq ft and story multipliers'),

('roof_cleaning', '{
  "base": {"asphalt": 300, "tile": 400, "metal": 275, "flat": 250},
  "severityMultiplier": {"light": 1, "moderate": 1.25, "heavy": 1.5},
  "perSqFt": 0.08
}', 'Roof cleaning base prices and multipliers'),

('bundle_config', '{
  "good": {"name": "Good", "label": "Essential Care", "description": "Keep your home looking great with regular exterior cleaning", "windowFrequency": 2, "additionalServicesFrequency": 1, "discount": 0},
  "better": {"name": "Better", "label": "Complete Care", "description": "More frequent cleaning for a consistently sparkling home", "windowFrequency": 3, "additionalServicesFrequency": 1, "discount": 0.05},
  "best": {"name": "Best", "label": "Premium Care", "description": "The ultimate in home maintenance with maximum coverage", "windowFrequency": 4, "additionalServicesFrequency": 2, "discount": 0.10}
}', 'Bundle tier configurations');