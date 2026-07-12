import { useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  ServicePlanHomeDetails,
  ServicePlanService,
  ServicePlanPayment,
  ServicePlanCustomer,
  PlanBuilderServiceId,
} from '@/types/servicePlanBuilder';
import {
  DEFAULT_PLAN_HOME_DETAILS,
  DEFAULT_PLAN_CUSTOMER,
  PLAN_BUILDER_SERVICES,
} from '@/types/servicePlanBuilder';
import { TIER_CONFIGS, type PlanTier } from '@/components/plan-builder/TierSelector';
import {
  useServerPlanQuotes,
  type PlanQuotesInput,
} from './useServerPlanQuotes';
import type {
  EngineAdditionalServices,
  EngineHomeDetails,
  PlanScenario,
} from '@/lib/pricing/engine';

interface ServiceSelection {
  id: PlanBuilderServiceId;
  enabled: boolean;
  frequency: 1 | 2 | 3 | 4;
}

// Tier presets are pure UI defaults for service SELECTION — they contain NO
// pricing. Every dollar is calculated server-side by calculate-plan-options.
const TIER_PRESETS: Record<PlanTier, Array<{ id: PlanBuilderServiceId; frequency: 1 | 2 | 3 | 4 }>> = {
  good: [
    { id: 'window-cleaning-exterior', frequency: 2 },
    { id: 'gutter-cleaning', frequency: 1 },
  ],
  better: [
    { id: 'window-cleaning-exterior', frequency: 3 },
    { id: 'window-cleaning-interior', frequency: 1 },
    { id: 'gutter-cleaning', frequency: 2 },
    { id: 'house-wash', frequency: 1 },
  ],
  best: [
    { id: 'window-cleaning-exterior', frequency: 4 },
    { id: 'window-cleaning-interior', frequency: 2 },
    { id: 'gutter-cleaning', frequency: 2 },
    { id: 'house-wash', frequency: 1 },
    { id: 'roof-cleaning', frequency: 1 },
  ],
};

function getSelectionsForTier(tier: PlanTier): ServiceSelection[] {
  const preset = TIER_PRESETS[tier];
  return PLAN_BUILDER_SERVICES.map(s => {
    const presetService = preset.find(p => p.id === s.id);
    return {
      id: s.id as PlanBuilderServiceId,
      enabled: !!presetService,
      frequency: presetService?.frequency ?? 1,
    };
  });
}

// Map a plan-builder service id to its canonical engine line-item key.
const SERVICE_KEY: Record<PlanBuilderServiceId, string> = {
  'window-cleaning-exterior': 'window_cleaning',
  'window-cleaning-interior': 'interior_windows',
  'gutter-cleaning': 'gutter_cleaning',
  'house-wash': 'house_wash',
  'roof-cleaning': 'roof_cleaning',
  'driveway-cleaning': 'driveway_cleaning',
  'pressure-washing': 'pressure_washing',
};

function toEngineHome(h: ServicePlanHomeDetails): EngineHomeDetails {
  return {
    squareFootage: h.squareFootage,
    stories: h.stories,
    condition: h.condition,
    windowCleaningType: 'exterior',
    showAdvanced: true,
    hardWaterStains: h.hardWaterStains,
    hardWaterPercent: h.hardWaterPercent,
    frenchPanes: h.frenchPanes,
    frenchPanesPercent: h.frenchPanesPercent,
    solarScreens: h.solarScreens,
    solarScreensPercent: h.solarScreensPercent,
  };
}

// Build a server plan scenario from a set of selections. NO pricing math here —
// only a structural description of which services + frequencies the customer
// chose. The server applies all pricing, frequency and bundle rules.
function toScenario(
  id: string,
  selections: ServiceSelection[],
  h: ServicePlanHomeDetails,
): PlanScenario {
  const additionalServices: EngineAdditionalServices = {};
  const serviceFrequencies: Record<string, number> = {};

  for (const sel of selections) {
    if (!sel.enabled) continue;
    switch (sel.id) {
      case 'window-cleaning-exterior':
        additionalServices.windowCleaning = true;
        break;
      case 'window-cleaning-interior':
        additionalServices.interiorWindows = true;
        break;
      case 'gutter-cleaning':
        additionalServices.gutterCleaning = true;
        break;
      case 'house-wash':
        additionalServices.houseWash = true;
        break;
      case 'roof-cleaning':
        additionalServices.roofCleaning = true;
        additionalServices.roofType = h.roofType;
        additionalServices.roofSeverity = h.roofSeverity;
        break;
      case 'driveway-cleaning':
        additionalServices.drivewayCleaning = {
          enabled: true,
          sqft: h.drivewaySqft,
          surfaceType: h.drivewaySurfaceType,
        };
        break;
      case 'pressure-washing':
        additionalServices.pressureWashing = {
          enabled: true,
          surfaceType: h.flatworkSurfaceType,
          frontPorch: { enabled: h.frontPorchSqft > 0, sqft: h.frontPorchSqft },
          backPatio: { enabled: h.backPatioSqft > 0, sqft: h.backPatioSqft },
          poolDeck: { enabled: h.poolDeckSqft > 0, sqft: h.poolDeckSqft },
          walkways: { enabled: h.walkwaysSqft > 0, sqft: h.walkwaysSqft },
        };
        break;
    }
    serviceFrequencies[SERVICE_KEY[sel.id]] = sel.frequency;
  }

  return { id, billingCadence: 'monthly', additionalServices, serviceFrequencies };
}

export function useServicePlanBuilder() {
  const [selectedTier, setSelectedTier] = useState<PlanTier>('better');
  const [homeDetails, setHomeDetails] = useState<ServicePlanHomeDetails>(DEFAULT_PLAN_HOME_DETAILS);
  const [customer, setCustomer] = useState<ServicePlanCustomer>(DEFAULT_PLAN_CUSTOMER);
  const [selections, setSelections] = useState<ServiceSelection[]>(getSelectionsForTier('better'));
  const [isSaving, setIsSaving] = useState(false);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);

  const updateHomeDetails = useCallback((updates: Partial<ServicePlanHomeDetails>) => {
    setHomeDetails(prev => ({ ...prev, ...updates }));
  }, []);

  const updateCustomer = useCallback((updates: Partial<ServicePlanCustomer>) => {
    setCustomer(prev => ({ ...prev, ...updates }));
  }, []);

  const selectTier = useCallback((tier: PlanTier) => {
    setSelectedTier(tier);
    setSelections(getSelectionsForTier(tier));
  }, []);

  const currentTierConfig = useMemo(
    () => TIER_CONFIGS.find(t => t.id === selectedTier) || TIER_CONFIGS[1],
    [selectedTier],
  );

  const toggleService = useCallback((serviceId: PlanBuilderServiceId) => {
    setSelections(prev => prev.map(s => (s.id === serviceId ? { ...s, enabled: !s.enabled } : s)));
  }, []);

  const updateFrequency = useCallback((serviceId: PlanBuilderServiceId, frequency: 1 | 2 | 3 | 4) => {
    setSelections(prev => prev.map(s => (s.id === serviceId ? { ...s, frequency } : s)));
  }, []);

  // ---------------------------------------------------------------------------
  // Server-authoritative pricing: the current plan plus the three tier presets
  // (for the comparison cards) are priced in ONE batch request.
  // ---------------------------------------------------------------------------
  const hasHomeDetails = homeDetails.squareFootage > 0;

  const planInput = useMemo<PlanQuotesInput | null>(() => {
    if (!hasHomeDetails) return null;
    return {
      homeDetails: toEngineHome(homeDetails),
      scenarios: [
        toScenario('current', selections, homeDetails),
        toScenario('tier-good', getSelectionsForTier('good'), homeDetails),
        toScenario('tier-better', getSelectionsForTier('better'), homeDetails),
        toScenario('tier-best', getSelectionsForTier('best'), homeDetails),
      ],
    };
  }, [hasHomeDetails, homeDetails, selections]);

  const planQuotes = useServerPlanQuotes(planInput);
  const current = planQuotes.options['current'] ?? null;
  const pricingReady = !!current && current.isFirm;

  // Service rows for the UI. Prices come ONLY from the current server option;
  // when a firm price is not yet available every amount is null (no fallback,
  // no stale value).
  const services = useMemo<ServicePlanService[]>(() => {
    return selections.map(selection => {
      const info = PLAN_BUILDER_SERVICES.find(s => s.id === selection.id);
      const li = pricingReady
        ? current!.lineItems.find(l => l.key === SERVICE_KEY[selection.id])
        : undefined;
      return {
        id: selection.id,
        name: info?.name ?? '',
        description: info?.description ?? '',
        icon: info?.icon ?? 'Circle',
        enabled: selection.enabled,
        frequency: selection.frequency,
        calculatedPrice: li ? li.perVisitAmount : 0,
        annualTotal: li ? li.annualAmount : 0,
      };
    });
  }, [selections, pricingReady, current]);

  const payment = useMemo<ServicePlanPayment>(() => {
    if (!pricingReady || !current) {
      return { annualTotal: 0, downPayment: 0, monthlyPayment: 0, totalPayments: 12 };
    }
    return {
      annualTotal: current.annualTotal ?? 0,
      downPayment: current.downPayment ?? 0,
      monthlyPayment: current.recurringAmount ?? 0,
      totalPayments: 12,
    };
  }, [pricingReady, current]);

  const tierPrices = useMemo(() => {
    const forTier = (id: string) => {
      const o = planQuotes.options[id];
      if (o && o.isFirm) {
        return { monthly: o.recurringAmount ?? 0, annual: o.annualTotal ?? 0, savings: 0 };
      }
      return { monthly: 0, annual: 0, savings: 0 };
    };
    return {
      good: forTier('tier-good'),
      better: forTier('tier-better'),
      best: forTier('tier-best'),
    };
  }, [planQuotes.options]);

  const saveQuote = useCallback(async (): Promise<string | null> => {
    if (isSaving) return null;
    // Only a CURRENT, firm, server-returned option may be saved. Missing-info,
    // manual-review and unavailable states can never produce a quote.
    if (!current || !current.isSelectable) return null;

    setIsSaving(true);
    try {
      const enabledServices = services.filter(s => s.enabled);
      const servicesJson = {
        type: '12-month-plan',
        engineVersion: current.engineVersion,
        ruleVersion: current.ruleVersion,
        billingCadence: current.billingCadence,
        paymentStructure: { downPaymentPercent: 20, monthlyPayments: 11, totalPayments: 12 },
        services: enabledServices.map(s => ({
          id: s.id,
          name: s.name,
          frequency: s.frequency,
          pricePerVisit: s.calculatedPrice,
          annualTotal: s.annualTotal,
        })),
        lineItems: current.lineItems,
        payment: {
          annualTotal: payment.annualTotal,
          downPayment: payment.downPayment,
          monthlyPayment: payment.monthlyPayment,
        },
      };

      const homeDetailsJson = {
        ...homeDetails,
        customerAddress: {
          street: customer.address,
          city: customer.city,
          state: customer.state,
          zip: customer.zip,
        },
      };

      const { data, error } = await supabase
        .from('quotes')
        .insert({
          customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
          customer_email: customer.email,
          customer_phone: customer.phone,
          services_json: servicesJson,
          home_details_json: homeDetailsJson,
          subtotal: payment.annualTotal,
          total: payment.annualTotal,
          status: 'pending',
        })
        .select('id')
        .single();

      if (error) throw error;
      setSavedQuoteId(data.id);

      supabase.functions.invoke('send-sms', {
        body: { eventType: 'quote_created', quoteId: data.id },
      }).catch((e) => console.warn('Quote SMS dispatch failed:', e));

      return data.id;
    } catch (error) {
      console.error('Error saving quote:', error);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, current, services, payment, homeDetails, customer]);

  const isValid = useMemo(() => {
    const hasServices = services.some(s => s.enabled);
    const hasCustomerInfo =
      customer.firstName.trim() !== '' &&
      customer.lastName.trim() !== '' &&
      customer.email.trim() !== '' &&
      customer.phone.trim() !== '' &&
      customer.address.trim() !== '';
    // A quote can only be completed against a firm server price.
    return hasServices && hasHomeDetails && hasCustomerInfo && pricingReady;
  }, [services, hasHomeDetails, customer, pricingReady]);

  const hasSelectedServices = useMemo(() => services.some(s => s.enabled), [services]);

  const resetQuote = useCallback(() => setSavedQuoteId(null), []);

  return {
    selectedTier,
    homeDetails,
    customer,
    services,
    payment,
    savedQuoteId,
    isSaving,
    tierPrices,
    currentTierConfig,
    selectTier,
    updateHomeDetails,
    updateCustomer,
    toggleService,
    updateFrequency,
    saveQuote,
    resetQuote,
    isValid,
    hasSelectedServices,
    // Pricing status surfaced for UI guards (no local fallback anywhere).
    isLoading: planQuotes.loading,
    pricingReady,
    pricingUnavailable: planQuotes.unavailable,
  };
}
