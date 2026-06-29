import { useState, useMemo, useCallback, useEffect } from 'react';
import { usePricingConfig } from './usePricingConfig';
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

interface ServiceSelection {
  id: PlanBuilderServiceId;
  enabled: boolean;
  frequency: 1 | 2 | 3 | 4;
}

// Tier presets define default service configurations
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

function applyModifiers(basePrice: number, modifierPercents: number[]): number {
  const totalPercent = modifierPercents.reduce((sum, pct) => sum + pct, 0);
  return Math.round(basePrice * (1 + totalPercent / 100));
}

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

export function useServicePlanBuilder() {
  const { data: PRICING, isLoading } = usePricingConfig();
  
  // State
  const [selectedTier, setSelectedTier] = useState<PlanTier>('better');
  const [homeDetails, setHomeDetails] = useState<ServicePlanHomeDetails>(DEFAULT_PLAN_HOME_DETAILS);
  const [customer, setCustomer] = useState<ServicePlanCustomer>(DEFAULT_PLAN_CUSTOMER);
  const [selections, setSelections] = useState<ServiceSelection[]>(getSelectionsForTier('better'));
  const [isSaving, setIsSaving] = useState(false);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);
  
  // Update home details
  const updateHomeDetails = useCallback((updates: Partial<ServicePlanHomeDetails>) => {
    setHomeDetails(prev => ({ ...prev, ...updates }));
  }, []);
  
  // Update customer info
  const updateCustomer = useCallback((updates: Partial<ServicePlanCustomer>) => {
    setCustomer(prev => ({ ...prev, ...updates }));
  }, []);
  
  // Select a tier (applies preset configuration)
  const selectTier = useCallback((tier: PlanTier) => {
    setSelectedTier(tier);
    setSelections(getSelectionsForTier(tier));
  }, []);
  
  // Get current tier config
  const currentTierConfig = useMemo(() => {
    return TIER_CONFIGS.find(t => t.id === selectedTier) || TIER_CONFIGS[1];
  }, [selectedTier]);
  
  // Toggle service selection
  const toggleService = useCallback((serviceId: PlanBuilderServiceId) => {
    setSelections(prev =>
      prev.map(s =>
        s.id === serviceId ? { ...s, enabled: !s.enabled } : s
      )
    );
  }, []);
  
  // Update service frequency
  const updateFrequency = useCallback((serviceId: PlanBuilderServiceId, frequency: 1 | 2 | 3 | 4) => {
    setSelections(prev =>
      prev.map(s =>
        s.id === serviceId ? { ...s, frequency } : s
      )
    );
  }, []);
  
  // Calculate individual service prices
  const calculateServicePrice = useCallback((serviceId: PlanBuilderServiceId): number => {
    if (!PRICING || homeDetails.squareFootage === 0) return 0;
    
    const { squareFootage, stories, condition } = homeDetails;
    
    switch (serviceId) {
      case 'window-cleaning-exterior': {
        const config = PRICING.window_cleaning;
        const base = squareFootage * config.exteriorPerSqFt;
        const modifiers: number[] = [];
        modifiers.push(config.modifiers.stories[stories.toString()] ?? 0);
        modifiers.push(config.modifiers.condition?.[condition] ?? 0);
        let price = applyModifiers(base, modifiers);
        
        // Add advanced modifiers
        if (homeDetails.hardWaterStains && config.modifiers.hardWater) {
          const addon = Math.round(price * (config.modifiers.hardWater / 100) * (homeDetails.hardWaterPercent / 100));
          price += addon;
        }
        if (homeDetails.frenchPanes && config.modifiers.frenchPanes) {
          const addon = Math.round(price * (config.modifiers.frenchPanes / 100) * (homeDetails.frenchPanesPercent / 100));
          price += addon;
        }
        if (homeDetails.solarScreens && config.modifiers.solarScreens) {
          const addon = Math.round(price * (config.modifiers.solarScreens / 100) * (homeDetails.solarScreensPercent / 100));
          price += addon;
        }
        
        return Math.max(price, config.minimumPrice ?? 0);
      }
      
      case 'window-cleaning-interior': {
        const config = PRICING.window_cleaning;
        const base = squareFootage * config.interiorPerSqFt;
        const modifiers: number[] = [];
        modifiers.push(config.modifiers.stories[stories.toString()] ?? 0);
        modifiers.push(config.modifiers.condition?.[condition] ?? 0);
        let price = applyModifiers(base, modifiers);
        
        if (homeDetails.hardWaterStains && config.modifiers.hardWater) {
          const addon = Math.round(price * (config.modifiers.hardWater / 100) * (homeDetails.hardWaterPercent / 100));
          price += addon;
        }
        if (homeDetails.frenchPanes && config.modifiers.frenchPanes) {
          const addon = Math.round(price * (config.modifiers.frenchPanes / 100) * (homeDetails.frenchPanesPercent / 100));
          price += addon;
        }
        
        return Math.max(price, Math.round((config.minimumPrice ?? 0) * 0.6));
      }
      
      case 'gutter-cleaning': {
        const config = PRICING.gutter_cleaning;
        const base = squareFootage * config.perSqFt;
        const modifiers: number[] = [];
        modifiers.push(config.modifiers.stories[stories.toString()] ?? 0);
        const price = applyModifiers(base, modifiers);
        return Math.max(price, config.minimumPrice ?? 0);
      }
      
      case 'house-wash': {
        const config = PRICING.house_wash;
        const base = squareFootage * config.perSqFt;
        const modifiers: number[] = [];
        modifiers.push(config.modifiers.stories[stories.toString()] ?? 0);
        const price = applyModifiers(base, modifiers);
        return Math.max(price, config.minimumPrice ?? 0);
      }
      
      case 'roof-cleaning': {
        const config = PRICING.roof_cleaning;
        const base = squareFootage * config.perSqFt;
        const modifiers: number[] = [];
        modifiers.push(config.modifiers.stories[stories.toString()] ?? 0);
        modifiers.push(config.modifiers.roofType?.[homeDetails.roofType] ?? 0);
        modifiers.push(config.modifiers.severity?.[homeDetails.roofSeverity] ?? 0);
        const price = applyModifiers(base, modifiers);
        return Math.max(price, config.minimumPrice ?? 0);
      }
      
      case 'driveway-cleaning': {
        const config = PRICING.driveway_cleaning;
        const base = homeDetails.drivewaySqft * config.perSqFt;
        const surfaceMult = config.surfaceMultipliers[homeDetails.drivewaySurfaceType] ?? 1;
        const price = Math.round(base * surfaceMult);
        return Math.max(price, config.minimumPrice ?? 0);
      }
      
      case 'pressure-washing': {
        const config = PRICING.pressure_washing;
        const surfaceMult = config.surfaceMultipliers[homeDetails.flatworkSurfaceType] ?? 1;
        
        let total = 0;
        if (homeDetails.frontPorchSqft > 0) {
          total += homeDetails.frontPorchSqft * config.perSqFt * surfaceMult;
        }
        if (homeDetails.backPatioSqft > 0) {
          total += homeDetails.backPatioSqft * config.perSqFt * surfaceMult;
        }
        if (homeDetails.poolDeckSqft > 0) {
          total += homeDetails.poolDeckSqft * config.perSqFt * surfaceMult;
        }
        if (homeDetails.walkwaysSqft > 0) {
          total += homeDetails.walkwaysSqft * config.perSqFt * surfaceMult;
        }
        
        return Math.max(Math.round(total), config.minimumPrice ?? 0);
      }
      
      default:
        return 0;
    }
  }, [PRICING, homeDetails]);
  
  // Build service list with calculated prices
  const services = useMemo<ServicePlanService[]>(() => {
    return selections.map(selection => {
      const serviceInfo = PLAN_BUILDER_SERVICES.find(s => s.id === selection.id);
      const pricePerVisit = calculateServicePrice(selection.id);
      
      return {
        id: selection.id,
        name: serviceInfo?.name ?? '',
        description: serviceInfo?.description ?? '',
        icon: serviceInfo?.icon ?? 'Circle',
        enabled: selection.enabled,
        frequency: selection.frequency,
        calculatedPrice: pricePerVisit,
        annualTotal: pricePerVisit * selection.frequency,
      };
    });
  }, [selections, calculateServicePrice]);
  
  // Calculate payment breakdown
  const payment = useMemo<ServicePlanPayment>(() => {
    const enabledServices = services.filter(s => s.enabled);
    const annualTotal = enabledServices.reduce((sum, s) => sum + s.annualTotal, 0);
    
    // 20% down payment
    const downPayment = Math.round(annualTotal * 0.2);
    
    // Remaining 80% split into 11 monthly payments
    const remainingBalance = annualTotal - downPayment;
    const monthlyPayment = Math.round(remainingBalance / 11);
    
    return {
      annualTotal,
      downPayment,
      monthlyPayment,
      totalPayments: 12,
    };
  }, [services]);
  
  // Calculate tier prices for comparison display
  const tierPrices = useMemo(() => {
    const calculateTierPrice = (tier: PlanTier) => {
      const tierSelections = getSelectionsForTier(tier);
      let annual = 0;
      
      for (const selection of tierSelections) {
        if (selection.enabled) {
          const price = calculateServicePrice(selection.id);
          annual += price * selection.frequency;
        }
      }
      
      // Calculate one-time price for savings comparison
      const oneTimePrice = calculateServicePrice('window-cleaning-exterior') + 
                          calculateServicePrice('gutter-cleaning');
      
      return {
        monthly: Math.round((annual * 0.8) / 11), // Monthly payment (80% / 11)
        annual,
        savings: Math.max(0, Math.round(oneTimePrice * 2 - annual * 0.85)), // Rough savings estimate
      };
    };
    
    return {
      good: calculateTierPrice('good'),
      better: calculateTierPrice('better'),
      best: calculateTierPrice('best'),
    };
  }, [calculateServicePrice]);
  
  // Save quote to database
  const saveQuote = useCallback(async (): Promise<string | null> => {
    if (isSaving) return null;
    
    setIsSaving(true);
    
    try {
      const enabledServices = services.filter(s => s.enabled);
      
      // Build services JSON with payment plan info
      const servicesJson = {
        type: '12-month-plan',
        paymentStructure: {
          downPaymentPercent: 20,
          monthlyPayments: 11,
          totalPayments: 12,
        },
        services: enabledServices.map(s => ({
          id: s.id,
          name: s.name,
          frequency: s.frequency,
          pricePerVisit: s.calculatedPrice,
          annualTotal: s.annualTotal,
        })),
        payment: {
          annualTotal: payment.annualTotal,
          downPayment: payment.downPayment,
          monthlyPayment: payment.monthlyPayment,
        },
      };
      
      // Build home details JSON
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

      // Fire-and-forget: text the customer their quote link.
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
  }, [services, payment, homeDetails, customer, isSaving]);
  
  // Validation
  const isValid = useMemo(() => {
    const hasServices = services.some(s => s.enabled);
    const hasHomeDetails = homeDetails.squareFootage > 0;
    const hasCustomerInfo = 
      customer.firstName.trim() !== '' &&
      customer.lastName.trim() !== '' &&
      customer.email.trim() !== '' &&
      customer.phone.trim() !== '' &&
      customer.address.trim() !== '';
    
    return hasServices && hasHomeDetails && hasCustomerInfo;
  }, [services, homeDetails, customer]);
  
  const hasSelectedServices = useMemo(() => services.some(s => s.enabled), [services]);
  
  // Reset the saved quote state to allow creating a new one
  const resetQuote = useCallback(() => {
    setSavedQuoteId(null);
  }, []);
  
  return {
    // State
    selectedTier,
    homeDetails,
    customer,
    services,
    payment,
    savedQuoteId,
    isSaving,
    tierPrices,
    currentTierConfig,
    
    // Actions
    selectTier,
    updateHomeDetails,
    updateCustomer,
    toggleService,
    updateFrequency,
    saveQuote,
    resetQuote,
    
    // Validation
    isValid,
    hasSelectedServices,
    isLoading,
  };
}
