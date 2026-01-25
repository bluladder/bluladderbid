import { useMemo } from 'react';
import type { HomeDetails, AdditionalServices, ServicePrices, BundleTier } from '@/types/homeowner';
import { usePricingConfig, type PricingData } from './usePricingConfig';

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
    
    // Calculate base window price
    const storyMult = PRICING.story_multipliers[stories.toString()] ?? 1;
    const conditionMult = PRICING.condition_multipliers[condition] ?? 1;
    
    const baseExterior = Math.round(
      squareFootage * PRICING.window_base_rates.exteriorPerSqFt * storyMult * conditionMult
    );
    
    const baseInterior = windowCleaningType === 'both' 
      ? Math.round(squareFootage * PRICING.window_base_rates.interiorPerSqFt * conditionMult)
      : 0;
    
    const baseWindowPrice = baseExterior + baseInterior;
    
    // Calculate modifiers (only if advanced is shown)
    let hardWaterAddon = 0;
    let frenchPanesAddon = 0;
    let solarScreensAddon = 0;
    let ladderWorkAddon = 0;
    let sunroomAddon = 0;
    
    if (homeDetails.showAdvanced) {
      if (homeDetails.hardWaterStains) {
        hardWaterAddon = Math.round(
          baseWindowPrice * PRICING.window_modifiers.hardWaterMultiplier * (homeDetails.hardWaterPercent / 100)
        );
      }
      
      if (homeDetails.frenchPanes) {
        frenchPanesAddon = Math.round(
          baseWindowPrice * PRICING.window_modifiers.frenchPanesMultiplier * (homeDetails.frenchPanesPercent / 100)
        );
      }
      
      if (homeDetails.solarScreens) {
        solarScreensAddon = Math.round(
          baseWindowPrice * PRICING.window_modifiers.solarScreensMultiplier * (homeDetails.solarScreensPercent / 100)
        );
      }
      
      if (homeDetails.ladderWork) {
        ladderWorkAddon = PRICING.ladder_work[homeDetails.ladderWorkCount] ?? 0;
      }
      
      sunroomAddon = PRICING.sunroom[homeDetails.sunroom] ?? 0;
    }
    
    const windowCleaningTotal = baseExterior + baseInterior + hardWaterAddon + 
      frenchPanesAddon + solarScreensAddon + ladderWorkAddon + sunroomAddon;
    
    // Calculate pressure washing
    let pressureWashing = 0;
    let pressureWashingAddons = 0;
    
    if (additionalServices.pressureWashing.enabled) {
      const { drivewaySize, surfaceType } = additionalServices.pressureWashing;
      const drivewayBase = PRICING.driveway[drivewaySize] ?? 0;
      const surfaceMult = PRICING.surface_multipliers[surfaceType] ?? 1;
      pressureWashing = Math.round(drivewayBase * surfaceMult);
      
      if (additionalServices.pressureWashing.frontPorch) {
        pressureWashingAddons += PRICING.pressure_washing_addons.frontPorch ?? 0;
      }
      if (additionalServices.pressureWashing.backPatio) {
        pressureWashingAddons += PRICING.pressure_washing_addons.backPatio ?? 0;
      }
      if (additionalServices.pressureWashing.poolDeck) {
        pressureWashingAddons += PRICING.pressure_washing_addons.poolDeck ?? 0;
      }
      if (additionalServices.pressureWashing.sidewalks) {
        pressureWashingAddons += PRICING.pressure_washing_addons.sidewalks ?? 0;
      }
    }
    
    // Calculate gutter cleaning
    let gutterCleaning = 0;
    if (additionalServices.gutterCleaning) {
      gutterCleaning = Math.round(
        PRICING.gutter_cleaning.base + 
        (PRICING.gutter_cleaning.perStory * stories) + 
        (squareFootage * PRICING.gutter_cleaning.perSqFt)
      );
    }
    
    // Calculate house wash
    let houseWash = 0;
    if (additionalServices.houseWash) {
      const houseWashStoryMult = PRICING.house_wash.storyMultiplier[stories.toString()] ?? 1;
      houseWash = Math.round(
        squareFootage * PRICING.house_wash.perSqFt * houseWashStoryMult
      );
    }
    
    // Calculate roof cleaning
    let roofCleaning = 0;
    if (additionalServices.roofCleaning) {
      const roofBase = PRICING.roof_cleaning.base[additionalServices.roofType] ?? 0;
      const severityMult = PRICING.roof_cleaning.severityMultiplier[additionalServices.roofSeverity] ?? 1;
      roofCleaning = Math.round(
        (roofBase + (squareFootage * PRICING.roof_cleaning.perSqFt)) * severityMult
      );
    }
    
    const additionalServicesTotal = pressureWashing + pressureWashingAddons + 
      gutterCleaning + houseWash + roofCleaning;
    
    return {
      exteriorWindows: baseExterior,
      interiorWindows: baseInterior,
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
