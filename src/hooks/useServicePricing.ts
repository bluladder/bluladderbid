import { useMemo } from 'react';
import type { HomeDetails, AdditionalServices, ServicePrices, BundleTier } from '@/types/homeowner';
import { usePricingConfig, type PricingData } from './usePricingConfig';

/**
 * Helper to apply percentage-based modifiers to a base price
 * @param basePrice - The starting price
 * @param modifierPercents - Array of percentage increases (e.g., 25 means +25%)
 * @returns The price after all modifiers are applied
 */
function applyModifiers(basePrice: number, modifierPercents: number[]): number {
  const totalPercent = modifierPercents.reduce((sum, pct) => sum + pct, 0);
  return Math.round(basePrice * (1 + totalPercent / 100));
}

export function useServicePricing(
  homeDetails: HomeDetails,
  additionalServices: AdditionalServices
): { servicePrices: ServicePrices; bundles: BundleTier[]; isLoading: boolean } {
  
  const { data: PRICING, isLoading } = usePricingConfig();
  
  const servicePrices = useMemo<ServicePrices>(() => {
    if (!PRICING) {
      return {
        exteriorWindows: 0,
        interiorWindows: 0,
        hardWaterAddon: 0,
        frenchPanesAddon: 0,
        solarScreensAddon: 0,
        ladderWorkAddon: 0,
        sunroomAddon: 0,
        windowCleaningTotal: 0,
        pressureWashing: 0,
        pressureWashingAddons: 0,
        gutterCleaning: 0,
        houseWash: 0,
        roofCleaning: 0,
        additionalServicesTotal: 0,
        grandTotal: 0,
      };
    }
    
    const { squareFootage, stories, windowCleaningType, condition } = homeDetails;
    
    // ==========================================
    // WINDOW CLEANING (sq ft based + modifiers)
    // ==========================================
    const windowConfig = PRICING.window_cleaning;
    const windowModifiers = windowConfig.modifiers;
    
    // Base price from square footage
    const baseExterior = squareFootage * windowConfig.exteriorPerSqFt;
    const baseInterior = windowCleaningType === 'both' 
      ? squareFootage * windowConfig.interiorPerSqFt
      : 0;
    const baseWindowPrice = baseExterior + baseInterior;
    
    // Collect all applicable modifiers
    const windowModifierPercents: number[] = [];
    
    // Story modifier
    const storyMod = windowModifiers.stories[stories.toString()] ?? 0;
    windowModifierPercents.push(storyMod);
    
    // Condition modifier
    const conditionMod = windowModifiers.condition?.[condition] ?? 0;
    windowModifierPercents.push(conditionMod);
    
    // Apply modifiers to get adjusted base
    const adjustedWindowBase = applyModifiers(baseWindowPrice, windowModifierPercents);
    
    // Calculate optional modifiers (only if advanced is shown)
    let hardWaterAddon = 0;
    let frenchPanesAddon = 0;
    let solarScreensAddon = 0;
    let ladderWorkAddon = 0;
    let sunroomAddon = 0;
    
    if (homeDetails.showAdvanced) {
      // Hard water stains - percentage of affected windows
      if (homeDetails.hardWaterStains && windowModifiers.hardWater) {
        const hardWaterPercent = windowModifiers.hardWater;
        const affectedPercent = homeDetails.hardWaterPercent / 100;
        hardWaterAddon = Math.round(adjustedWindowBase * (hardWaterPercent / 100) * affectedPercent);
      }
      
      // French panes - percentage of affected windows
      if (homeDetails.frenchPanes && windowModifiers.frenchPanes) {
        const frenchPercent = windowModifiers.frenchPanes;
        const affectedPercent = homeDetails.frenchPanesPercent / 100;
        frenchPanesAddon = Math.round(adjustedWindowBase * (frenchPercent / 100) * affectedPercent);
      }
      
      // Solar screens - percentage of affected windows
      if (homeDetails.solarScreens && windowModifiers.solarScreens) {
        const solarPercent = windowModifiers.solarScreens;
        const affectedPercent = homeDetails.solarScreensPercent / 100;
        solarScreensAddon = Math.round(adjustedWindowBase * (solarPercent / 100) * affectedPercent);
      }
      
      // Flat fee add-ons
      if (homeDetails.ladderWork) {
        ladderWorkAddon = PRICING.window_addons.ladderWork[homeDetails.ladderWorkCount] ?? 0;
      }
      
      sunroomAddon = PRICING.window_addons.sunroom[homeDetails.sunroom] ?? 0;
    }
    
    const windowCleaningTotal = adjustedWindowBase + hardWaterAddon + 
      frenchPanesAddon + solarScreensAddon + ladderWorkAddon + sunroomAddon;
    
    // ==========================================
    // HOUSE WASH (sq ft based + modifiers)
    // ==========================================
    let houseWash = 0;
    if (additionalServices.houseWash) {
      const houseConfig = PRICING.house_wash;
      const baseHouseWash = squareFootage * houseConfig.perSqFt;
      
      const houseModifiers: number[] = [];
      const houseStoryMod = houseConfig.modifiers.stories[stories.toString()] ?? 0;
      houseModifiers.push(houseStoryMod);
      
      houseWash = applyModifiers(baseHouseWash, houseModifiers);
    }
    
    // ==========================================
    // GUTTER CLEANING (sq ft based + modifiers)
    // ==========================================
    let gutterCleaning = 0;
    if (additionalServices.gutterCleaning) {
      const gutterConfig = PRICING.gutter_cleaning;
      const baseGutter = squareFootage * gutterConfig.perSqFt;
      
      const gutterModifiers: number[] = [];
      const gutterStoryMod = gutterConfig.modifiers.stories[stories.toString()] ?? 0;
      gutterModifiers.push(gutterStoryMod);
      
      gutterCleaning = applyModifiers(baseGutter, gutterModifiers);
    }
    
    // ==========================================
    // ROOF CLEANING (sq ft based + modifiers)
    // ==========================================
    let roofCleaning = 0;
    if (additionalServices.roofCleaning) {
      const roofConfig = PRICING.roof_cleaning;
      const baseRoof = squareFootage * roofConfig.perSqFt;
      
      const roofModifiers: number[] = [];
      
      // Story modifier
      const roofStoryMod = roofConfig.modifiers.stories[stories.toString()] ?? 0;
      roofModifiers.push(roofStoryMod);
      
      // Roof type modifier
      const roofTypeMod = roofConfig.modifiers.roofType?.[additionalServices.roofType] ?? 0;
      roofModifiers.push(roofTypeMod);
      
      // Severity modifier
      const severityMod = roofConfig.modifiers.severity?.[additionalServices.roofSeverity] ?? 0;
      roofModifiers.push(severityMod);
      
      roofCleaning = applyModifiers(baseRoof, roofModifiers);
    }
    
    // ==========================================
    // PRESSURE WASHING (driveway-based pricing)
    // ==========================================
    let pressureWashing = 0;
    let pressureWashingAddons = 0;
    
    if (additionalServices.pressureWashing.enabled) {
      const pwConfig = PRICING.pressure_washing;
      const { drivewaySize, surfaceType } = additionalServices.pressureWashing;
      
      const drivewayBase = pwConfig.driveway[drivewaySize] ?? 0;
      const surfaceMult = pwConfig.surfaceMultipliers[surfaceType] ?? 1;
      pressureWashing = Math.round(drivewayBase * surfaceMult);
      
      if (additionalServices.pressureWashing.frontPorch) {
        pressureWashingAddons += pwConfig.addons.frontPorch ?? 0;
      }
      if (additionalServices.pressureWashing.backPatio) {
        pressureWashingAddons += pwConfig.addons.backPatio ?? 0;
      }
      if (additionalServices.pressureWashing.poolDeck) {
        pressureWashingAddons += pwConfig.addons.poolDeck ?? 0;
      }
      if (additionalServices.pressureWashing.sidewalks) {
        pressureWashingAddons += pwConfig.addons.sidewalks ?? 0;
      }
    }
    
    const additionalServicesTotal = pressureWashing + pressureWashingAddons + 
      gutterCleaning + houseWash + roofCleaning;
    
    return {
      exteriorWindows: Math.round(baseExterior * (1 + storyMod / 100 + conditionMod / 100)),
      interiorWindows: Math.round(baseInterior * (1 + conditionMod / 100)),
      hardWaterAddon,
      frenchPanesAddon,
      solarScreensAddon,
      ladderWorkAddon,
      sunroomAddon,
      windowCleaningTotal,
      pressureWashing,
      pressureWashingAddons,
      gutterCleaning,
      houseWash,
      roofCleaning,
      additionalServicesTotal,
      grandTotal: windowCleaningTotal + additionalServicesTotal,
    };
  }, [homeDetails, additionalServices, PRICING]);
  
  const bundles = useMemo<BundleTier[]>(() => {
    if (!PRICING) return [];
    
    const { windowCleaningTotal, gutterCleaning, houseWash, roofCleaning, pressureWashing, pressureWashingAddons } = servicePrices;
    
    const BUNDLE_CONFIG = PRICING.bundle_config;
    
    return (['good', 'better', 'best'] as const).map((tier) => {
      const config = BUNDLE_CONFIG[tier];
      if (!config) {
        return {
          name: 'Good' as const,
          tier,
          label: tier,
          description: '',
          features: [],
          windowFrequency: 1,
          additionalServicesIncluded: [],
          annualTotal: 0,
          monthlyPayment: 0,
          savings: 0,
          savingsPercent: 0,
          isPopular: false,
        };
      }
      
      // Map tier to proper name type
      const tierNameMap: Record<string, 'Good' | 'Better' | 'Best'> = {
        good: 'Good',
        better: 'Better',
        best: 'Best',
      };
      
      // Window cleaning annual cost
      const windowAnnual = windowCleaningTotal * config.windowFrequency;
      
      // Additional services based on tier
      let additionalAnnual = 0;
      const includedServices: string[] = [];
      
      // Pressure washing (annual for all tiers if enabled)
      if (additionalServices.pressureWashing.enabled) {
        additionalAnnual += (pressureWashing + pressureWashingAddons);
        includedServices.push('Pressure Washing');
      }
      
      // Gutter cleaning frequency varies by tier
      if (additionalServices.gutterCleaning) {
        additionalAnnual += gutterCleaning * config.additionalServicesFrequency;
        includedServices.push(`Gutter Cleaning (${config.additionalServicesFrequency}x/year)`);
      }
      
      // House wash (annual for Better/Best only)
      if (additionalServices.houseWash && tier !== 'good') {
        additionalAnnual += houseWash;
        includedServices.push('House Wash');
      }
      
      // Roof cleaning (Best only)
      if (additionalServices.roofCleaning && tier === 'best') {
        additionalAnnual += roofCleaning;
        includedServices.push('Roof Cleaning');
      }
      
      const subtotal = windowAnnual + additionalAnnual;
      const discount = subtotal * config.discount;
      const annualTotal = Math.round(subtotal - discount);
      const monthlyPayment = Math.round(annualTotal / 12);
      
      // Calculate savings vs buying services individually
      let individualTotal = windowCleaningTotal * config.windowFrequency;
      if (additionalServices.pressureWashing.enabled) {
        individualTotal += pressureWashing + pressureWashingAddons;
      }
      if (additionalServices.gutterCleaning) {
        individualTotal += gutterCleaning * config.additionalServicesFrequency;
      }
      if (additionalServices.houseWash && tier !== 'good') {
        individualTotal += houseWash;
      }
      if (additionalServices.roofCleaning && tier === 'best') {
        individualTotal += roofCleaning;
      }
      
      const savings = Math.round(individualTotal - annualTotal);
      const savingsPercent = individualTotal > 0 ? Math.round((savings / individualTotal) * 100) : 0;
      
      // Build features list
      const features: string[] = [
        `Window Cleaning ${config.windowFrequency}x per year`,
      ];
      
      if (tier === 'better' || tier === 'best') {
        features.push('Priority scheduling');
      }
      
      if (tier === 'best') {
        features.push('Interior + Exterior windows');
        features.push('Free touch-ups between visits');
      }
      
      if (config.discount > 0) {
        features.push(`${Math.round(config.discount * 100)}% bundle discount`);
      }
      
      return {
        name: tierNameMap[tier],
        tier,
        label: config.label,
        description: config.description,
        features,
        windowFrequency: config.windowFrequency,
        additionalServicesIncluded: includedServices,
        annualTotal,
        monthlyPayment,
        savings,
        savingsPercent,
        isPopular: tier === 'better',
      };
    });
  }, [servicePrices, additionalServices, PRICING]);
  
  return { servicePrices, bundles, isLoading };
}
