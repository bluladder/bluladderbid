/**
 * useUpsellEstimates — fetches accurate per-service estimates for the four
 * sqft-driven services (window cleaning, house wash, gutter cleaning, roof
 * cleaning) so the "Complete Your Exterior Refresh" upsell shows a price the
 * customer will actually pay, not a marketing "from $X" floor.
 *
 * Implementation: calls the canonical `calculate-quote` Edge Function once
 * with all four services force-enabled, using safe defaults for structural
 * inputs (roof type, house-wash stain type). Prices for driveway/pressure
 * washing are intentionally NOT computed here — those depend on user-entered
 * flatwork sqft and remain marketed as "from $X" floors.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { QuoteInput, QuoteResult } from '@/lib/pricing/engine';
import type { HomeDetails } from '@/types/homeowner';

export interface UpsellEstimates {
  windowCleaning: number | null;
  houseWash: number | null;
  gutterCleaning: number | null;
  roofCleaning: number | null;
}

const EMPTY: UpsellEstimates = {
  windowCleaning: null,
  houseWash: null,
  gutterCleaning: null,
  roofCleaning: null,
};

function buildProbeInput(home: HomeDetails): QuoteInput {
  return {
    homeDetails: {
      squareFootage: home.squareFootage,
      stories: home.stories,
      // Estimate exterior-only windows so the probe reflects the most common
      // add-on scenario; the customer's actual selection recomputes on add.
      windowCleaningType: 'exterior',
      condition: home.condition,
      showAdvanced: false,
      hardWaterStains: false,
      hardWaterPercent: 0,
      frenchPanes: false,
      frenchPanesPercent: 0,
      solarScreens: false,
      solarScreensPercent: 0,
      ladderWork: false,
      ladderWorkCount: 0,
      sunroom: false,
    },
    additionalServices: {
      windowCleaning: true,
      houseWash: true,
      houseWashDetails: { stainType: 'none' },
      gutterCleaning: true,
      gutterAddons: {
        undergroundDrains: { enabled: false, count: '0' },
        minorRepairs: false,
        gutterGuards: { enabled: false, linearFeet: 0 },
      },
      roofCleaning: true,
      roofType: 'asphalt',
      roofSeverity: 'light',
      drivewayCleaning: { enabled: false, sqft: 0, surfaceType: 'concrete' },
      pressureWashing: {
        enabled: false,
        surfaceType: 'concrete',
        frontPorch: { enabled: false, sqft: 0 },
        backPatio: { enabled: false, sqft: 0 },
        poolDeck: { enabled: false, sqft: 0 },
        walkways: { enabled: false, sqft: 0 },
      },
      solarPanelCleaning: { enabled: false, panelCount: 0 },
      screenRepair: { enabled: false, screenCount: 0 },
    },
    discount: null,
    promotion: null,
  };
}

export function useUpsellEstimates(
  home: HomeDetails | null | undefined,
  enabled: boolean = true,
): UpsellEstimates {
  const [estimates, setEstimates] = useState<UpsellEstimates>(EMPTY);
  const seqRef = useRef(0);

  // Only re-fetch when the sqft / stories / condition change — the four
  // dimensions that actually move these prices.
  const key = useMemo(() => {
    if (!enabled || !home || !home.squareFootage || !home.stories) return null;
    return `${home.squareFootage}|${home.stories}|${home.condition ?? 'normal'}`;
  }, [enabled, home]);

  useEffect(() => {
    if (!key || !home) {
      setEstimates(EMPTY);
      return;
    }
    const seq = ++seqRef.current;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('calculate-quote', {
          body: buildProbeInput(home),
        });
        if (seq !== seqRef.current) return;
        if (error || !data || typeof data !== 'object') return;
        const result = data as Partial<QuoteResult>;
        const items = Array.isArray(result.lineItems) ? result.lineItems : [];
        const next: UpsellEstimates = { ...EMPTY };
        for (const li of items) {
          if (!li || typeof li.amount !== 'number') continue;
          switch (li.key) {
            case 'window_cleaning':
              next.windowCleaning = (next.windowCleaning ?? 0) + li.amount;
              break;
            case 'interior_windows':
              // Probe uses exterior-only so this shouldn't fire, but guard anyway.
              next.windowCleaning = (next.windowCleaning ?? 0) + li.amount;
              break;
            case 'house_wash':
              next.houseWash = li.amount;
              break;
            case 'gutter_cleaning':
              next.gutterCleaning = li.amount;
              break;
            case 'roof_cleaning':
              next.roofCleaning = li.amount;
              break;
          }
        }
        setEstimates(next);
      } catch {
        // Silent — the card falls back to its marketing "from $X" anchor.
      }
    })();
  }, [key, home]);

  return estimates;
}
