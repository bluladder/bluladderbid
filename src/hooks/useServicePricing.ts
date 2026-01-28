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

/**
 * SINGLE SOURCE OF TRUTH: Service pricing hook
 * 
 * All pricing calculations are gated by the corresponding selection boolean in additionalServices.
 * If a service is not selected (e.g., additionalServices.windowCleaning === false),
 * its price MUST be 0, ensuring UI selection state and pricing always match.
 * 
 * Components consuming servicePrices should:
 * - Always check additionalServices.[service] before showing a service as "selected"
 * - Use servicePrices.[service] > 0 as a secondary validation, not the primary source
 */
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
    // Only calculate if window cleaning is enabled
    // ==========================================
    let exteriorWindows = 0;
    let interiorWindows = 0;
    let hardWaterAddon = 0;
    let frenchPanesAddon = 0;
    let solarScreensAddon = 0;
    let ladderWorkAddon = 0;
    let sunroomAddon = 0;
    let windowCleaningTotal = 0;
    
    if (additionalServices.windowCleaning) {
      const windowConfig = PRICING.window_cleaning;
      const windowModifiers = windowConfig.modifiers;
      
      // Base price from square footage
      const baseExterior = squareFootage * windowConfig.exteriorPerSqFt;
      const baseInterior = windowCleaningType === 'both' 
        ? squareFootage * windowConfig.interiorPerSqFt
        : 0;
      
      // Collect all applicable modifiers
      const windowModifierPercents: number[] = [];
      
      // Story modifier
      const storyMod = windowModifiers.stories[stories.toString()] ?? 0;
      windowModifierPercents.push(storyMod);
      
      // Condition modifier
      const conditionMod = windowModifiers.condition?.[condition] ?? 0;
      windowModifierPercents.push(conditionMod);
      
      // Apply modifiers to get adjusted base
      exteriorWindows = Math.round(baseExterior * (1 + storyMod / 100 + conditionMod / 100));
      interiorWindows = Math.round(baseInterior * (1 + conditionMod / 100));
      const adjustedWindowBase = exteriorWindows + interiorWindows;
      
      // Calculate optional modifiers (only if advanced is shown)
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
      windowCleaningTotal = Math.max(windowCleaningCalculated, windowMinimum);
    }
    
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
      exteriorWindows,
      interiorWindows,
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
    
    const { 
      windowCleaningTotal, exteriorWindows, interiorWindows,
      gutterCleaning, houseWash, roofCleaning, drivewayCleaning, pressureWashing 
    } = servicePrices;
    
    const BUNDLE_CONFIG = PRICING.bundle_config;
    
    // Calculate raw tier pricing first
    const rawTiers = (['good', 'better', 'best'] as const).map((tier) => {
      const config = BUNDLE_CONFIG[tier];
      if (!config) return null;
      
      // Window cleaning costs (separate interior/exterior)
      const exteriorCost = exteriorWindows * config.exteriorWindowFrequency;
      const interiorCost = interiorWindows * config.interiorWindowFrequency;
      const windowCost = exteriorCost + interiorCost;
      
      // Calculate window frequency display
      const totalWindowFrequency = config.exteriorWindowFrequency + 
        (config.interiorWindowFrequency > 0 ? config.interiorWindowFrequency : 0);
      
      // Base included services based on tier config
      let baseServicesCost = 0;
      const includedServices: string[] = [];
      const baseServices: string[] = [];
      
      // Gutter cleaning - check if in includedServices
      if (config.includedServices.includes('gutter_cleaning') && additionalServices.gutterCleaning) {
        baseServicesCost += gutterCleaning * config.additionalServicesFrequency;
        includedServices.push(`Gutter Cleaning (${config.additionalServicesFrequency}x/year)`);
        baseServices.push('gutter_cleaning');
      }
      
      // House wash - check if in includedServices
      if (config.includedServices.includes('house_wash') && additionalServices.houseWash) {
        baseServicesCost += houseWash;
        includedServices.push('House Wash');
        baseServices.push('house_wash');
      }
      
      // Roof cleaning - Best only perk
      if (tier === 'best' && additionalServices.roofCleaning) {
        baseServicesCost += roofCleaning;
        includedServices.push('Roof Cleaning');
        baseServices.push('roof_cleaning');
      }
      
      // Customer-added services (apply tier addon discount)
      let addonsCost = 0;
      const addonsList: string[] = [];
      
      // Driveway - always an addon
      if (additionalServices.drivewayCleaning.enabled) {
        const discountedPrice = drivewayCleaning * (1 - config.addonDiscount);
        addonsCost += discountedPrice;
        addonsList.push('Driveway Cleaning');
      }
      
      // Pressure washing - always an addon
      if (additionalServices.pressureWashing.enabled) {
        const discountedPrice = pressureWashing * (1 - config.addonDiscount);
        addonsCost += discountedPrice;
        addonsList.push('Pressure Washing');
      }
      
      // Gutter cleaning as addon (if not in base)
      if (!config.includedServices.includes('gutter_cleaning') && additionalServices.gutterCleaning) {
        const discountedPrice = gutterCleaning * config.additionalServicesFrequency * (1 - config.addonDiscount);
        addonsCost += discountedPrice;
        addonsList.push(`Gutter Cleaning (${config.additionalServicesFrequency}x/year)`);
      }
      
      // House wash as addon (if not in base)
      if (!config.includedServices.includes('house_wash') && additionalServices.houseWash) {
        const discountedPrice = houseWash * (1 - config.addonDiscount);
        addonsCost += discountedPrice;
        addonsList.push('House Wash');
      }
      
      // Roof cleaning as addon (if not Best tier)
      if (tier !== 'best' && additionalServices.roofCleaning) {
        const discountedPrice = roofCleaning * (1 - config.addonDiscount);
        addonsCost += discountedPrice;
        addonsList.push('Roof Cleaning');
      }
      
      // Calculate totals
      const subtotal = windowCost + baseServicesCost + addonsCost;
      const bundleDiscount = subtotal * config.bundleDiscount;
      const annualTotal = Math.round(subtotal - bundleDiscount);
      const monthlyPayment = Math.round(annualTotal / 12);
      
      // Calculate addon savings (what they saved with tier discount)
      const fullPriceAddons = (additionalServices.drivewayCleaning.enabled ? drivewayCleaning : 0) +
        (additionalServices.pressureWashing.enabled ? pressureWashing : 0) +
        (!config.includedServices.includes('gutter_cleaning') && additionalServices.gutterCleaning ? gutterCleaning * config.additionalServicesFrequency : 0) +
        (!config.includedServices.includes('house_wash') && additionalServices.houseWash ? houseWash : 0) +
        (tier !== 'best' && additionalServices.roofCleaning ? roofCleaning : 0);
      const addonSavings = Math.round(fullPriceAddons - addonsCost);
      
      // Calculate total savings vs individual purchases
      const individualTotal = windowCost + baseServicesCost + fullPriceAddons;
      const savings = Math.round(individualTotal - annualTotal);
      const savingsPercent = individualTotal > 0 ? Math.round((savings / individualTotal) * 100) : 0;
      
      // Available addons for customization
      const availableAddons = [
        'driveway_cleaning',
        'pressure_washing',
        ...(!config.includedServices.includes('gutter_cleaning') ? ['gutter_cleaning'] : []),
        ...(!config.includedServices.includes('house_wash') ? ['house_wash'] : []),
        ...(tier !== 'best' ? ['roof_cleaning'] : []),
      ];
      
      return {
        tier,
        config,
        windowCost: Math.round(windowCost),
        baseServicesCost: Math.round(baseServicesCost),
        addonsCost: Math.round(addonsCost),
        bundleDiscount: Math.round(bundleDiscount),
        annualTotal,
        monthlyPayment,
        savings,
        savingsPercent,
        addonSavings,
        includedServices: [...includedServices, ...addonsList],
        baseServices,
        availableAddons,
        totalWindowFrequency,
        exteriorFreq: config.exteriorWindowFrequency,
        interiorFreq: config.interiorWindowFrequency,
      };
    }).filter(Boolean) as NonNullable<typeof rawTiers[number]>[];
    
    // Apply pricing guardrails: Good < Better < Best
    const MINIMUM_TIER_BUFFER = 25; // Minimum $25 difference between tiers
    const adjustedTiers = [...rawTiers];
    
    // Ensure Better > Good
    if (adjustedTiers[1] && adjustedTiers[0] && adjustedTiers[1].annualTotal <= adjustedTiers[0].annualTotal) {
      adjustedTiers[1].annualTotal = adjustedTiers[0].annualTotal + MINIMUM_TIER_BUFFER;
      adjustedTiers[1].monthlyPayment = Math.round(adjustedTiers[1].annualTotal / 12);
    }
    
    // Ensure Best > Better
    if (adjustedTiers[2] && adjustedTiers[1] && adjustedTiers[2].annualTotal <= adjustedTiers[1].annualTotal) {
      adjustedTiers[2].annualTotal = adjustedTiers[1].annualTotal + MINIMUM_TIER_BUFFER;
      adjustedTiers[2].monthlyPayment = Math.round(adjustedTiers[2].annualTotal / 12);
    }
    
    // Map to proper tier names
    const tierNameMap: Record<string, 'Good' | 'Better' | 'Best'> = {
      good: 'Good',
      better: 'Better',
      best: 'Best',
    };
    
    return adjustedTiers.map((t) => {
      const config = t.config;
      
      // Build features list
      const features: string[] = [];
      
      // Window frequency description
      if (t.interiorFreq > 0) {
        features.push(`Exterior windows ${t.exteriorFreq}x/year`);
        features.push(`Interior windows ${t.interiorFreq}x/year`);
      } else {
        features.push(`Exterior window cleaning ${t.exteriorFreq}x/year`);
      }
      
      if (t.tier === 'better' || t.tier === 'best') {
        features.push('Priority scheduling');
      }
      
      if (t.tier === 'best') {
        features.push('Free touch-ups between visits');
      }
      
      if (config.bundleDiscount > 0) {
        features.push(`${Math.round(config.bundleDiscount * 100)}% bundle discount`);
      }
      
      if (config.addonDiscount > 0) {
        features.push(`${Math.round(config.addonDiscount * 100)}% off additional services`);
      }
      
      return {
        name: tierNameMap[t.tier],
        tier: t.tier,
        label: config.label,
        description: config.description,
        features,
        windowFrequency: t.totalWindowFrequency,
        windowFrequencyConfig: {
          exteriorFrequency: config.exteriorWindowFrequency as 1 | 2 | 3 | 4,
          interiorFrequency: config.interiorWindowFrequency as 0 | 1 | 2,
        },
        additionalServicesIncluded: t.includedServices,
        baseServices: t.baseServices,
        availableAddons: t.availableAddons,
        annualTotal: t.annualTotal,
        monthlyPayment: t.monthlyPayment,
        savings: t.savings,
        savingsPercent: t.savingsPercent,
        addonDiscountPercent: Math.round(config.addonDiscount * 100),
        addonSavings: t.addonSavings,
        windowCost: t.windowCost,
        additionalServicesCost: t.baseServicesCost,
        addonsCost: t.addonsCost,
        bundleDiscount: t.bundleDiscount,
        isPopular: t.tier === 'better',
        isCustomized: false,
      };
    });
  }, [servicePrices, additionalServices, PRICING]);
  
  return { servicePrices, bundles, isLoading };
}
