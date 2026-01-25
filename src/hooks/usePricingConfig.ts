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

// All modifiers are expressed as percentage increases (0-100)
// Example: 25 means +25% increase to base price
export interface ServiceModifiers {
  stories: Record<string, number>;      // e.g., "1": 0, "2": 20, "3": 40
  condition?: Record<string, number>;   // e.g., maintenance: 0, heavy: 40
  hardWater?: number;                   // percentage increase when present
  frenchPanes?: number;                 // percentage increase when present
  solarScreens?: number;                // percentage increase when present
}

export interface PricingData {
  // All 4 main services use sq ft base rate + modifiers
  window_cleaning: {
    exteriorPerSqFt: number;
    interiorPerSqFt: number;
    modifiers: ServiceModifiers;
  };
  house_wash: {
    perSqFt: number;
    modifiers: ServiceModifiers;
  };
  gutter_cleaning: {
    perSqFt: number;
    modifiers: ServiceModifiers;
  };
  roof_cleaning: {
    perSqFt: number;
    modifiers: ServiceModifiers & {
      roofType: Record<string, number>;   // asphalt: 0, tile: 20, etc.
      severity: Record<string, number>;   // light: 0, moderate: 25, heavy: 50
    };
  };
  
  // Window-specific add-ons (flat fees)
  window_addons: {
    ladderWork: Record<string, number>;
    sunroom: Record<string, number>;
  };
  
  // Pressure washing (separate pricing model)
  pressure_washing: {
    driveway: Record<string, number>;
    surfaceMultipliers: Record<string, number>;
    addons: Record<string, number>;
  };
  
  // Bundle configuration
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
  window_cleaning: {
    exteriorPerSqFt: 0.045,
    interiorPerSqFt: 0.035,
    modifiers: {
      stories: { "1": 0, "2": 25, "3": 50 },
      condition: { maintenance: 0, heavy: 40 },
      hardWater: 25,      // +25% when hard water stains present
      frenchPanes: 30,    // +30% when french panes present
      solarScreens: 20,   // +20% when solar screens present
    },
  },
  house_wash: {
    perSqFt: 0.12,
    modifiers: {
      stories: { "1": 0, "2": 30, "3": 60 },
    },
  },
  gutter_cleaning: {
    perSqFt: 0.06,
    modifiers: {
      stories: { "1": 0, "2": 25, "3": 50 },
    },
  },
  roof_cleaning: {
    perSqFt: 0.10,
    modifiers: {
      stories: { "1": 0, "2": 20, "3": 40 },
      roofType: { asphalt: 0, tile: 25, metal: -10, flat: -15 },
      severity: { light: 0, moderate: 25, heavy: 50 },
    },
  },
  window_addons: {
    ladderWork: { "1-3": 45, "4-8": 85, "9+": 135 },
    sunroom: { none: 0, small: 75, medium: 125, large: 200 },
  },
  pressure_washing: {
    driveway: { small: 150, medium: 225, large: 350 },
    surfaceMultipliers: {
      concrete: 1,
      stamped: 1.15,
      pavers: 1.25,
      brick: 1.20,
      stone: 1.30,
      tile: 1.35,
    },
    addons: {
      frontPorch: 75,
      backPatio: 95,
      poolDeck: 125,
      sidewalks: 65,
    },
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
