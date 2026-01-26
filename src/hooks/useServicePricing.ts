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
        drivewayCleaning: 0,
        pressureWashing: 0,
        pressureWashingBreakdown: {
          frontPorch: 0,
          backPatio: 0,
          poolDeck: 0,
          walkways: 0,
        },
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
    
    const windowCleaningCalculated = adjustedWindowBase + hardWaterAddon + 
      frenchPanesAddon + solarScreensAddon + ladderWorkAddon + sunroomAddon;
    
    // Apply minimum price for window cleaning
    const windowMinimum = windowConfig.minimumPrice ?? 0;
    const windowCleaningTotal = Math.max(windowCleaningCalculated, windowMinimum);
    
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
      
      const houseWashCalculated = applyModifiers(baseHouseWash, houseModifiers);
      const houseMinimum = houseConfig.minimumPrice ?? 0;
      houseWash = Math.max(houseWashCalculated, houseMinimum);
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
      
      const gutterCalculated = applyModifiers(baseGutter, gutterModifiers);
      const gutterMinimum = gutterConfig.minimumPrice ?? 0;
      gutterCleaning = Math.max(gutterCalculated, gutterMinimum);
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
      
      const roofCalculated = applyModifiers(baseRoof, roofModifiers);
      const roofMinimum = roofConfig.minimumPrice ?? 0;
      roofCleaning = Math.max(roofCalculated, roofMinimum);
    }
    
    // ==========================================
    // DRIVEWAY CLEANING (sqft-based pricing)
    // ==========================================
    let drivewayCleaning = 0;
    if (additionalServices.drivewayCleaning.enabled) {
      const dwConfig = PRICING.driveway_cleaning;
      const { sqft, surfaceType } = additionalServices.drivewayCleaning;
      const baseDriveway = sqft * dwConfig.perSqFt;
      const surfaceMult = dwConfig.surfaceMultipliers[surfaceType] ?? 1;
      const drivewayCalculated = Math.round(baseDriveway * surfaceMult);
      drivewayCleaning = Math.max(drivewayCalculated, dwConfig.minimumPrice ?? 0);
    }
    
    // ==========================================
    // PRESSURE WASHING (flatwork areas - sqft-based)
    // ==========================================
    let pressureWashing = 0;
    const pressureWashingBreakdown = {
      frontPorch: 0,
      backPatio: 0,
      poolDeck: 0,
      walkways: 0,
    };
    
    if (additionalServices.pressureWashing.enabled) {
      const pwConfig = PRICING.pressure_washing;
      const { surfaceType, frontPorch, backPatio, poolDeck, walkways } = additionalServices.pressureWashing;
      const surfaceMult = pwConfig.surfaceMultipliers[surfaceType] ?? 1;
      
      if (frontPorch.enabled) {
        const basePrice = frontPorch.sqft * pwConfig.perSqFt;
        pressureWashingBreakdown.frontPorch = Math.round(basePrice * surfaceMult);
      }
      
      if (backPatio.enabled) {
        const basePrice = backPatio.sqft * pwConfig.perSqFt;
        pressureWashingBreakdown.backPatio = Math.round(basePrice * surfaceMult);
      }
      
      if (poolDeck.enabled) {
        const basePrice = poolDeck.sqft * pwConfig.perSqFt;
        pressureWashingBreakdown.poolDeck = Math.round(basePrice * surfaceMult);
      }
      
      if (walkways.enabled) {
        const basePrice = walkways.sqft * pwConfig.perSqFt;
        pressureWashingBreakdown.walkways = Math.round(basePrice * surfaceMult);
      }
      
      pressureWashing = pressureWashingBreakdown.frontPorch + 
        pressureWashingBreakdown.backPatio + 
        pressureWashingBreakdown.poolDeck + 
        pressureWashingBreakdown.walkways;
      
      // Apply minimum if any area is enabled
      if (pressureWashing > 0) {
        pressureWashing = Math.max(pressureWashing, pwConfig.minimumPrice ?? 0);
      }
    }
    
    const additionalServicesTotal = drivewayCleaning + pressureWashing + 
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
      drivewayCleaning,
      pressureWashing,
      pressureWashingBreakdown,
      gutterCleaning,
      houseWash,
      roofCleaning,
      additionalServicesTotal,
      grandTotal: windowCleaningTotal + additionalServicesTotal,
    };
  }, [homeDetails, additionalServices, PRICING]);
  
  const bundles = useMemo<BundleTier[]>(() => {
    if (!PRICING) return [];
    
    const { windowCleaningTotal, gutterCleaning, houseWash, roofCleaning, drivewayCleaning, pressureWashing } = servicePrices;
    
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
      
      // Driveway cleaning (annual for all tiers if enabled)
      if (additionalServices.drivewayCleaning.enabled) {
        additionalAnnual += drivewayCleaning;
        includedServices.push('Driveway Cleaning');
      }
      
      // Pressure washing (annual for all tiers if enabled)
      if (additionalServices.pressureWashing.enabled) {
        additionalAnnual += pressureWashing;
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
      if (additionalServices.drivewayCleaning.enabled) {
        individualTotal += drivewayCleaning;
      }
      if (additionalServices.pressureWashing.enabled) {
        individualTotal += pressureWashing;
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
