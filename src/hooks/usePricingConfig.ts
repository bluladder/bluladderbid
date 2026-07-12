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
  // All 4 main services use sq ft base rate + modifiers + minimum price
  window_cleaning: {
    exteriorPerSqFt: number;
    interiorPerSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers;
  };
  gutter_cleaning: {
    perSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers;
    // Gutter add-ons pricing
    undergroundDrainPricing: Record<string, number>; // '1', '2', '3', '4+'
    minorRepairsPrice: number;
    gutterGuardsPerLinearFoot: number;
  };
  roof_cleaning: {
    perSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers & {
      roofType: Record<string, number>;   // asphalt: 0, tile: 20, etc.
      severity: Record<string, number>;   // light: 0, moderate: 25, heavy: 50
    };
  };
  
  // House wash with stain type
  house_wash: {
    perSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers;
    rustStainSurcharge: number; // percentage increase for rust stains
  };
  
  // Window-specific add-ons (flat fees)
  window_addons: {
    ladderWork: Record<string, number>;
    sunroom: Record<string, number>;
  };
  
  // Driveway cleaning (sqft-based, separate service)
  driveway_cleaning: {
    perSqFt: number;
    minimumPrice: number;
    surfaceMultipliers: Record<string, number>;
  };
  
  // Pressure washing for flatwork (sqft-based)
  pressure_washing: {
    perSqFt: number;
    minimumPrice: number;
    surfaceMultipliers: Record<string, number>;
  };
  
  // Bundle configuration
  bundle_config: Record<string, {
    name: string;
    label: string;
    description: string;
    // Window frequencies
    exteriorWindowFrequency: number;  // times per year
    interiorWindowFrequency: number;  // times per year (0 = not included)
    // Other services
    additionalServicesFrequency: number;
    // Discounts
    bundleDiscount: number;           // Overall bundle discount (0-1)
    addonDiscount: number;            // Discount on added services (0.05/0.10/0.15)
    // Services included by default
    includedServices: string[];       // e.g., ['gutter_cleaning', 'house_wash']
  }>;
}

// Default pricing for fallback
// Estimate-only safety net. The AUTHORITATIVE prices live in the pricing_config
// table and are recalculated server-side (calculate-quote / jobber-create-booking).
// These values are kept in sync with the live production config so that, in the
// rare case the DB read fails, the instant on-screen ESTIMATE is never wrong.
// They are NEVER used to charge a customer — the server always recomputes.
export const DEFAULT_PRICING: PricingData = {
  window_cleaning: {
    exteriorPerSqFt: 0.08,
    interiorPerSqFt: 0.075,
    minimumPrice: 185,
    modifiers: {
      stories: { "1": 0, "2": 12, "3": 18 },
      condition: { maintenance: 0, heavy: 15 },
      hardWater: 10,
      frenchPanes: 40,
      solarScreens: 20,
    },
  },
  house_wash: {
    perSqFt: 0.25,
    minimumPrice: 396,
    modifiers: {
      stories: { "1": 0, "2": 10, "3": 15 },
    },
    rustStainSurcharge: 15,
  },
  gutter_cleaning: {
    perSqFt: 0.08,
    minimumPrice: 200,
    modifiers: {
      stories: { "1": 0, "2": 10, "3": 12 },
    },
    undergroundDrainPricing: {
      "1": 75,
      "2": 125,
      "3": 175,
      "4+": 225,
    },
    minorRepairsPrice: 85,
    gutterGuardsPerLinearFoot: 8,
  },
  roof_cleaning: {
    perSqFt: 0.30,
    minimumPrice: 500,
    modifiers: {
      stories: { "1": 0, "2": 10, "3": 15 },
      roofType: { asphalt: 0, tile: 10, metal: 0, flat: 0 },
      severity: { light: 0, moderate: 5, heavy: 10 },
    },
  },
  window_addons: {
    ladderWork: { "1-3": 25, "4-8": 50, "9+": 75 },
    sunroom: { none: 0, small: 125, medium: 175, large: 225 },
  },
  driveway_cleaning: {
    perSqFt: 0.20,
    minimumPrice: 200,
    surfaceMultipliers: {
      concrete: 1,
      stamped: 1,
      pavers: 1.25,
      brick: 1,
      stone: 1,
      tile: 1,
    },
  },
  pressure_washing: {
    perSqFt: 0.25,
    minimumPrice: 75,
    surfaceMultipliers: {
      concrete: 1,
      stamped: 1.15,
      pavers: 1.25,
      brick: 1.20,
      stone: 1.30,
      tile: 1.35,
    },
  },
  bundle_config: {
    good: {
      name: "Good",
      label: "Core Exterior Care",
      description: "Essential exterior window cleaning to keep your home looking great",
      exteriorWindowFrequency: 4,      // Quarterly exterior
      interiorWindowFrequency: 0,      // No interior
      additionalServicesFrequency: 1,
      bundleDiscount: 0,
      addonDiscount: 0.05,             // 5% off added services
      includedServices: [],            // Base package - no extras
    },
    better: {
      name: "Better",
      label: "Consistent Window Care",
      description: "Complete window care with interior cleaning included",
      exteriorWindowFrequency: 4,      // Quarterly exterior
      interiorWindowFrequency: 1,      // 1x interior per year
      additionalServicesFrequency: 1,
      bundleDiscount: 0.05,
      addonDiscount: 0.10,             // 10% off added services
      includedServices: ['gutter_cleaning'],
    },
    best: {
      name: "Best",
      label: "Total Window & Home Care",
      description: "Maximum coverage with frequent interior cleaning and premium perks",
      exteriorWindowFrequency: 4,      // Quarterly exterior
      interiorWindowFrequency: 2,      // 2x interior per year
      additionalServicesFrequency: 2,
      bundleDiscount: 0.10,
      addonDiscount: 0.15,             // 15% off added services
      includedServices: ['gutter_cleaning', 'house_wash'],
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
