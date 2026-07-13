/**
 * ============================================================================
 * useServerBundleTiers — the SINGLE authoritative client bundle-tier service.
 * ============================================================================
 * Good/Better/Best plan tiers for the public website MUST come from the deployed
 * `calculate-plan-options` Edge Function in `bundle_tiers` mode (which recomputes
 * from the canonical pricing engine + live pricing_config). No component may
 * compute a bundle price, add-on discount, tier buffer or customization delta
 * locally.
 *
 * Guarantees (same safety model as useServerQuoteCalculation):
 *  - NEVER falls back to local/constant pricing. A server failure yields the
 *    `unavailable` phase with NO dollar amounts and NO selectable tiers.
 *  - Debounces rapid input changes.
 *  - Cancels obsolete in-flight requests (AbortController + sequence guard).
 *  - Prevents an older response from overwriting a newer one.
 *  - De-duplicates identical normalized inputs.
 *  - On ANY input change (property, services, customizations) the previous tiers
 *    are invalidated immediately — a stale price is never shown and a stale tier
 *    is never selectable while a new one is loading.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  BundleTierOption,
  BundleTierServiceBases,
  EngineHomeDetails,
  EngineAdditionalServices,
} from '@/lib/pricing/engine';
import type { BundleTier, HomeDetails, AdditionalServices } from '@/types/homeowner';
import type { TierCustomizations } from '@/hooks/usePlanCustomizations';

export type BundleTiersPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'missing_information'
  | 'manual_review_required'
  | 'unavailable';

export interface ServerBundleTiersState {
  phase: BundleTiersPhase;
  loading: boolean;
  /** Server-authoritative tiers in the legacy display shape. Empty unless ready. */
  bundles: BundleTier[];
  /** Server-authoritative single-visit service bases (never locally derived). */
  serviceBases: BundleTierServiceBases | null;
  error: string | null;
  missing: string[];
  manualReviewReasons: string[];
  ruleVersion: number | null;
  engineVersion: string | null;
  isReady: boolean;
  isMissingInfo: boolean;
  isManualReview: boolean;
  isUnavailable: boolean;
  refetch: () => void;
}

const UNAVAILABLE_MESSAGE =
  "We're temporarily unable to calculate plan pricing. You can request a quote and our team will follow up.";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Structural map: server BundleTierOption → legacy BundleTier. No math. */
function toBundleTier(o: BundleTierOption): BundleTier {
  return {
    name: o.name as BundleTier['name'],
    tier: o.tier as BundleTier['tier'],
    label: o.label,
    description: o.description,
    features: o.features,
    windowFrequency: o.windowFrequency,
    windowFrequencyConfig: o.windowFrequencyConfig as BundleTier['windowFrequencyConfig'],
    additionalServicesIncluded: o.additionalServicesIncluded,
    baseServices: o.baseServices,
    availableAddons: o.availableAddons,
    annualTotal: o.annualTotal,
    monthlyPayment: o.monthlyPayment,
    savings: o.savings,
    savingsPercent: o.savingsPercent,
    addonDiscountPercent: o.addonDiscountPercent,
    addonSavings: o.addonSavings,
    windowCost: o.windowCost,
    additionalServicesCost: o.additionalServicesCost,
    addonsCost: o.addonsCost,
    bundleDiscount: o.bundleDiscount,
    isPopular: o.isPopular,
    isCustomized: o.isCustomized,
  };
}

export interface BundleTiersRequest {
  homeDetails: HomeDetails;
  additionalServices: AdditionalServices;
  /** Optional per-tier customizations, keyed by tier. Applied server-side only. */
  customizations?: TierCustomizations;
}

/** Build the structural server payload (no pricing, no defaults). */
function toPayload(req: BundleTiersRequest) {
  const home = req.homeDetails;
  return {
    mode: 'bundle_tiers' as const,
    homeDetails: {
      squareFootage: home.squareFootage,
      stories: home.stories,
      windowCleaningType: home.windowCleaningType,
      condition: home.condition,
      showAdvanced: home.showAdvanced,
      hardWaterStains: home.hardWaterStains,
      hardWaterPercent: home.hardWaterPercent,
      frenchPanes: home.frenchPanes,
      frenchPanesPercent: home.frenchPanesPercent,
      solarScreens: home.solarScreens,
      solarScreensPercent: home.solarScreensPercent,
      ladderWork: home.ladderWork,
      ladderWorkCount: home.ladderWorkCount,
      sunroom: home.sunroom,
    } as EngineHomeDetails,
    additionalServices: req.additionalServices as unknown as EngineAdditionalServices,
    customizations: req.customizations ?? undefined,
  };
}

function baseState(phase: BundleTiersPhase, refetch: () => void, extra?: Partial<ServerBundleTiersState>): ServerBundleTiersState {
  return {
    phase,
    loading: phase === 'loading',
    bundles: extra?.bundles ?? [],
    serviceBases: extra?.serviceBases ?? null,
    error: extra?.error ?? null,
    missing: extra?.missing ?? [],
    manualReviewReasons: extra?.manualReviewReasons ?? [],
    ruleVersion: extra?.ruleVersion ?? null,
    engineVersion: extra?.engineVersion ?? null,
    isReady: phase === 'ready',
    isMissingInfo: phase === 'missing_information',
    isManualReview: phase === 'manual_review_required',
    isUnavailable: phase === 'unavailable',
    refetch,
  };
}

export function useServerBundleTiers(
  request: BundleTiersRequest | null,
  options: { debounceMs?: number; enabled?: boolean } = {},
): ServerBundleTiersState {
  const { debounceMs = 350, enabled = true } = options;

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastHashRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchRef = useRef<() => void>(() => {});
  const payloadRef = useRef<ReturnType<typeof toPayload> | null>(null);

  const payload = useMemo(
    () => (enabled && request ? toPayload(request) : null),
    [enabled, request],
  );
  payloadRef.current = payload;

  const [state, setState] = useState<ServerBundleTiersState>(() =>
    baseState('idle', () => refetchRef.current()),
  );

  const hash = useMemo(() => (payload ? stableStringify(payload) : null), [payload]);

  const applyUnavailable = useCallback((seq: number) => {
    if (seq !== seqRef.current) return;
    setState(baseState('unavailable', () => refetchRef.current(), { error: UNAVAILABLE_MESSAGE }));
  }, []);

  const run = useCallback(
    async (body: ReturnType<typeof toPayload>) => {
      const seq = ++seqRef.current;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const { data, error } = await supabase.functions.invoke('calculate-plan-options', { body });
        if (seq !== seqRef.current) return; // superseded
        if (error || !data || typeof data !== 'object') {
          applyUnavailable(seq);
          return;
        }
        const b = data as {
          status?: string;
          tiers?: BundleTierOption[];
          serviceBases?: BundleTierServiceBases;
          ruleVersion?: number;
          engineVersion?: string;
          missing?: string[];
          manualReviewReasons?: string[];
        };
        if (b.status !== 'ok' || !Array.isArray(b.tiers)) {
          if (b.status === 'missing_information') {
            setState(baseState('missing_information', () => refetchRef.current(), { missing: b.missing ?? [] }));
            return;
          }
          applyUnavailable(seq);
          return;
        }
        setState(
          baseState('ready', () => refetchRef.current(), {
            bundles: b.tiers.map(toBundleTier),
            serviceBases: b.serviceBases ?? null,
            ruleVersion: b.ruleVersion ?? null,
            engineVersion: b.engineVersion ?? null,
            missing: b.missing ?? [],
            manualReviewReasons: b.manualReviewReasons ?? [],
          }),
        );
      } catch {
        if (seq === seqRef.current) applyUnavailable(seq);
      }
    },
    [applyUnavailable],
  );

  const refetch = useCallback(() => {
    lastHashRef.current = null;
    const body = payloadRef.current;
    if (!body) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    seqRef.current++;
    setState(baseState('loading', () => refetchRef.current()));
    void run(body);
  }, [run]);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!hash) {
      seqRef.current++;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      lastHashRef.current = null;
      setState(baseState('idle', () => refetchRef.current()));
      return;
    }
    if (hash === lastHashRef.current) return; // de-dup identical inputs
    lastHashRef.current = hash;

    // Invalidate immediately — no stale price, no stale selectable tier.
    seqRef.current++;
    setState(baseState('loading', () => refetchRef.current()));

    if (timerRef.current) clearTimeout(timerRef.current);
    const body = payloadRef.current!;
    timerRef.current = setTimeout(() => void run(body), debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hash, debounceMs, run]);

  return state;
}
