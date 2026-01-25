import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

export interface PricingConfigRow {
  id: string;
  config_key: string;
  config_value: Record<string, unknown>;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricingData {
  window_base_rates: {
    exteriorPerSqFt: number;
    interiorPerSqFt: number;
  };
  story_multipliers: Record<string, number>;
  condition_multipliers: Record<string, number>;
  window_modifiers: {
    hardWaterMultiplier: number;
    frenchPanesMultiplier: number;
    solarScreensMultiplier: number;
  };
  ladder_work: Record<string, number>;
  sunroom: Record<string, number>;
  driveway: Record<string, number>;
  surface_multipliers: Record<string, number>;
  pressure_washing_addons: Record<string, number>;
  gutter_cleaning: {
    base: number;
    perStory: number;
    perSqFt: number;
  };
  house_wash: {
    perSqFt: number;
    storyMultiplier: Record<string, number>;
  };
  roof_cleaning: {
    base: Record<string, number>;
    severityMultiplier: Record<string, number>;
    perSqFt: number;
  };
  bundle_config: Record<string, {
    name: string;
    label: string;
    description: string;
    windowFrequency: number;
    additionalServicesFrequency: number;
    discount: number;
  }>;
}

// Default pricing for fallback
export const DEFAULT_PRICING: PricingData = {
  window_base_rates: {
    exteriorPerSqFt: 0.045,
    interiorPerSqFt: 0.035,
  },
  story_multipliers: { "1": 1, "2": 1.25, "3": 1.5 },
  condition_multipliers: { maintenance: 1, heavy: 1.4 },
  window_modifiers: {
    hardWaterMultiplier: 0.25,
    frenchPanesMultiplier: 0.30,
    solarScreensMultiplier: 0.20,
  },
  ladder_work: { "1-3": 45, "4-8": 85, "9+": 135 },
  sunroom: { none: 0, small: 75, medium: 125, large: 200 },
  driveway: { small: 150, medium: 225, large: 350 },
  surface_multipliers: {
    concrete: 1,
    stamped: 1.15,
    pavers: 1.25,
    brick: 1.20,
    stone: 1.30,
    tile: 1.35,
  },
  pressure_washing_addons: {
    frontPorch: 75,
    backPatio: 95,
    poolDeck: 125,
    sidewalks: 65,
  },
  gutter_cleaning: { base: 125, perStory: 50, perSqFt: 0.025 },
  house_wash: {
    perSqFt: 0.12,
    storyMultiplier: { "1": 1, "2": 1.3, "3": 1.6 },
  },
  roof_cleaning: {
    base: { asphalt: 300, tile: 400, metal: 275, flat: 250 },
    severityMultiplier: { light: 1, moderate: 1.25, heavy: 1.5 },
    perSqFt: 0.08,
  },
  bundle_config: {
    good: {
      name: "Good",
      label: "Essential Care",
      description: "Keep your home looking great with regular exterior cleaning",
      windowFrequency: 2,
      additionalServicesFrequency: 1,
      discount: 0,
    },
    better: {
      name: "Better",
      label: "Complete Care",
      description: "More frequent cleaning for a consistently sparkling home",
      windowFrequency: 3,
      additionalServicesFrequency: 1,
      discount: 0.05,
    },
    best: {
      name: "Best",
      label: "Premium Care",
      description: "The ultimate in home maintenance with maximum coverage",
      windowFrequency: 4,
      additionalServicesFrequency: 2,
      discount: 0.10,
    },
  },
};

export function usePricingConfig() {
  return useQuery({
    queryKey: ['pricing-config'],
    queryFn: async (): Promise<PricingData> => {
      const { data, error } = await supabase
        .from('pricing_config')
        .select('config_key, config_value');
      
      if (error) {
        console.error('Error fetching pricing config:', error);
        return DEFAULT_PRICING;
      }
      
      if (!data || data.length === 0) {
        return DEFAULT_PRICING;
      }
      
      // Transform array to object - use explicit typing to avoid complex inference
      const result = { ...DEFAULT_PRICING };
      
      for (const row of data) {
        const key = row.config_key;
        const value = row.config_value;
        if (key in result && value !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (result as any)[key] = value;
        }
      }
      
      return result;
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

export function useUpdatePricingConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      configKey, 
      configValue 
    }: { 
      configKey: string; 
      configValue: Record<string, unknown> 
    }) => {
      const { error } = await supabase
        .from('pricing_config')
        .update({ config_value: configValue as Json })
        .eq('config_key', configKey);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pricing-config'] });
      toast.success('Pricing updated successfully');
    },
    onError: (error) => {
      console.error('Error updating pricing:', error);
      toast.error('Failed to update pricing. Make sure you have admin access.');
    },
  });
}

export function usePricingConfigRows() {
  return useQuery({
    queryKey: ['pricing-config-rows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_config')
        .select('*')
        .order('config_key');
      
      if (error) throw error;
      return data as PricingConfigRow[];
    },
  });
}
