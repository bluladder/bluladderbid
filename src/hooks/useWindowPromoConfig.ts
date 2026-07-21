import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WindowPromoConfig {
  active: boolean;
  promoId: string;
  version: number;
  flatPrice: number;
  maxWindows: number;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  prepInstructions: string;
  stackingPolicy: 'none' | 'allow_discount_codes';
  serviceLabel?: string;
  terms?: string;
}

function isEffective(row: WindowPromoConfig | null): row is WindowPromoConfig {
  if (!row || !row.active) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (row.effectiveStart && today < row.effectiveStart) return false;
  if (row.effectiveEnd && today > row.effectiveEnd) return false;
  if (!Number.isFinite(row.flatPrice) || row.flatPrice <= 0) return false;
  if (!Number.isFinite(row.maxWindows) || row.maxWindows <= 0) return false;
  if (!row.promoId) return false;
  return true;
}

/**
 * Public hook: returns the currently active $99 window promotion, or null when
 * the admin has it disabled / it is outside the effective window. Fail-closed —
 * a missing or malformed config yields null, never a fabricated promo.
 */
export function useWindowPromoConfig() {
  const query = useQuery({
    queryKey: ['window-promo-99'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_config')
        .select('config_value')
        .eq('config_key', 'window_promo_99')
        .maybeSingle();
      if (error) throw error;
      return (data?.config_value as unknown as WindowPromoConfig | null) ?? null;
    },
    staleTime: 60_000,
  });
  return { promo: isEffective(query.data ?? null) ? (query.data as WindowPromoConfig) : null };
}