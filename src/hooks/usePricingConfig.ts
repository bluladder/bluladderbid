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

// Canonical config keys expected in the pricing_config table. This is a
// NON-PRICED schema — it lists only which configuration sections must exist.
// It contains no dollar values, rates, discounts or minimums.
export const PRICING_CONFIG_KEYS = [
  'window_cleaning',
  'house_wash',
  'gutter_cleaning',
  'roof_cleaning',
  'window_addons',
  'driveway_cleaning',
  'pressure_washing',
  'bundle_config',
] as const;

export function usePricingConfig() {
  return useQuery({
    queryKey: ['pricing-config'],
    queryFn: async (): Promise<PricingData> => {
      const { data, error } = await supabase
        .from('pricing_config')
        .select('config_key, config_value');

      // FAIL-CLOSED: a configuration-load failure must surface an error state.
      // We NEVER fall back to hard-coded prices — the authoritative values live
      // only in the pricing_config table (and published pricing versions).
      if (error) {
        console.error('Error fetching pricing config:', error);
        throw new Error('Failed to load pricing configuration');
      }
      if (!data || data.length === 0) {
        throw new Error('Pricing configuration is unavailable');
      }

      const result: Record<string, unknown> = {};
      for (const row of data) {
        if (row.config_value !== null) result[row.config_key] = row.config_value;
      }

      // Every canonical section must be present, or we fail closed rather than
      // rendering a partially-populated (and therefore unsafe) configuration.
      for (const key of PRICING_CONFIG_KEYS) {
        if (!(key in result)) {
          throw new Error(`Pricing configuration is incomplete (missing ${key})`);
        }
      }

      return result as unknown as PricingData;
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: false,
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
