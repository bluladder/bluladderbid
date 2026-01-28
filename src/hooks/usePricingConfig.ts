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
export const DEFAULT_PRICING: PricingData = {
  window_cleaning: {
    exteriorPerSqFt: 0.045,
    interiorPerSqFt: 0.035,
    minimumPrice: 150,
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
    minimumPrice: 200,
    modifiers: {
      stories: { "1": 0, "2": 30, "3": 60 },
    },
    rustStainSurcharge: 15, // +15% for rust/irrigation stains
  },
  gutter_cleaning: {
    perSqFt: 0.06,
    minimumPrice: 100,
    modifiers: {
      stories: { "1": 0, "2": 25, "3": 50 },
    },
    undergroundDrainPricing: {
      "1": 75,
      "2": 125,
      "3": 175,
      "4+": 225,
    },
    minorRepairsPrice: 85,
    gutterGuardsPerLinearFoot: 8, // $8 per linear foot
  },
  roof_cleaning: {
    perSqFt: 0.10,
    minimumPrice: 250,
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
  driveway_cleaning: {
    perSqFt: 0.50,      // $0.50 per sqft for driveways
    minimumPrice: 150,
    surfaceMultipliers: {
      concrete: 1,
      stamped: 1.15,
      pavers: 1.25,
      brick: 1.20,
      stone: 1.30,
      tile: 1.35,
    },
  },
  pressure_washing: {
    perSqFt: 0.40,      // $0.40 per sqft for flatwork
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
