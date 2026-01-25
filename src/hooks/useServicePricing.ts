import { useMemo } from 'react';
import type { HomeDetails, AdditionalServices, ServicePrices, BundleTier } from '@/types/homeowner';

// Pricing constants - easily adjustable
const PRICING = {
  // Base window cleaning per sq ft
  exteriorPerSqFt: 0.045,
  interiorPerSqFt: 0.035,
  
  // Story multipliers
  storyMultiplier: {
    1: 1,
    2: 1.25,
    3: 1.5,
  },
  
  // Condition multipliers
  conditionMultiplier: {
    maintenance: 1,
    heavy: 1.4,
  },
  
  // Window modifiers (% of base price)
  hardWaterMultiplier: 0.25,
  frenchPanesMultiplier: 0.30,
  solarScreensMultiplier: 0.20,
  
  // Ladder work flat fees
  ladderWork: {
    '1-3': 45,
    '4-8': 85,
    '9+': 135,
  },
  
  // Sunroom flat fees
  sunroom: {
    none: 0,
    small: 75,
    medium: 125,
    large: 200,
  },
  
  // Pressure washing driveway pricing
  driveway: {
    small: 150,
    medium: 225,
    large: 350,
  },
  
  // Surface type multipliers
  surfaceMultiplier: {
    concrete: 1,
    stamped: 1.15,
    pavers: 1.25,
    brick: 1.20,
    stone: 1.30,
    tile: 1.35,
  },
  
  // Pressure washing add-ons
  pressureWashingAddons: {
    frontPorch: 75,
    backPatio: 95,
    poolDeck: 125,
    sidewalks: 65,
  },
  
  // Gutter cleaning base + per story
  gutterBase: 125,
  gutterPerStory: 50,
  gutterPerSqFt: 0.025,
  
  // House wash
  houseWashPerSqFt: 0.12,
  houseWashStoryMultiplier: {
    1: 1,
    2: 1.3,
    3: 1.6,
  },
  
  // Roof cleaning
  roofBase: {
    asphalt: 300,
    tile: 400,
    metal: 275,
    flat: 250,
  },
  roofSeverityMultiplier: {
    light: 1,
    moderate: 1.25,
    heavy: 1.5,
  },
  roofPerSqFt: 0.08,
};

// Bundle tier configurations
const BUNDLE_CONFIG = {
  good: {
    name: 'Good' as const,
    label: 'Essential Care',
    description: 'Keep your home looking great with regular exterior cleaning',
    windowFrequency: 2, // 2x per year
    additionalServicesFrequency: 1,
    discount: 0,
  },
  better: {
    name: 'Better' as const,
    label: 'Complete Care',
    description: 'More frequent cleaning for a consistently sparkling home',
    windowFrequency: 3, // 3x per year
    additionalServicesFrequency: 1,
    discount: 0.05,
  },
  best: {
    name: 'Best' as const,
    label: 'Premium Care',
    description: 'The ultimate in home maintenance with maximum coverage',
    windowFrequency: 4, // 4x per year
    additionalServicesFrequency: 2, // gutters 2x
    discount: 0.10,
  },
};

export function useServicePricing(
  homeDetails: HomeDetails,
  additionalServices: AdditionalServices
): { servicePrices: ServicePrices; bundles: BundleTier[] } {
  
  const servicePrices = useMemo<ServicePrices>(() => {
    const { squareFootage, stories, windowCleaningType, condition } = homeDetails;
    
    // Calculate base window price
    const storyMult = PRICING.storyMultiplier[stories];
    const conditionMult = PRICING.conditionMultiplier[condition];
    
    const baseExterior = Math.round(
      squareFootage * PRICING.exteriorPerSqFt * storyMult * conditionMult
    );
    
    const baseInterior = windowCleaningType === 'both' 
      ? Math.round(squareFootage * PRICING.interiorPerSqFt * conditionMult)
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
          baseWindowPrice * PRICING.hardWaterMultiplier * (homeDetails.hardWaterPercent / 100)
        );
      }
      
      if (homeDetails.frenchPanes) {
        frenchPanesAddon = Math.round(
          baseWindowPrice * PRICING.frenchPanesMultiplier * (homeDetails.frenchPanesPercent / 100)
        );
      }
      
      if (homeDetails.solarScreens) {
        solarScreensAddon = Math.round(
          baseWindowPrice * PRICING.solarScreensMultiplier * (homeDetails.solarScreensPercent / 100)
        );
      }
      
      if (homeDetails.ladderWork) {
        ladderWorkAddon = PRICING.ladderWork[homeDetails.ladderWorkCount];
      }
      
      sunroomAddon = PRICING.sunroom[homeDetails.sunroom];
    }
    
    const windowCleaningTotal = baseExterior + baseInterior + hardWaterAddon + 
      frenchPanesAddon + solarScreensAddon + ladderWorkAddon + sunroomAddon;
    
    // Calculate pressure washing
    let pressureWashing = 0;
    let pressureWashingAddons = 0;
    
    if (additionalServices.pressureWashing.enabled) {
      const { drivewaySize, surfaceType } = additionalServices.pressureWashing;
      pressureWashing = Math.round(
        PRICING.driveway[drivewaySize] * PRICING.surfaceMultiplier[surfaceType]
      );
      
      if (additionalServices.pressureWashing.frontPorch) {
        pressureWashingAddons += PRICING.pressureWashingAddons.frontPorch;
      }
      if (additionalServices.pressureWashing.backPatio) {
        pressureWashingAddons += PRICING.pressureWashingAddons.backPatio;
      }
      if (additionalServices.pressureWashing.poolDeck) {
        pressureWashingAddons += PRICING.pressureWashingAddons.poolDeck;
      }
      if (additionalServices.pressureWashing.sidewalks) {
        pressureWashingAddons += PRICING.pressureWashingAddons.sidewalks;
      }
    }
    
    // Calculate gutter cleaning
    let gutterCleaning = 0;
    if (additionalServices.gutterCleaning) {
      gutterCleaning = Math.round(
        PRICING.gutterBase + 
        (PRICING.gutterPerStory * stories) + 
        (squareFootage * PRICING.gutterPerSqFt)
      );
    }
    
    // Calculate house wash
    let houseWash = 0;
    if (additionalServices.houseWash) {
      houseWash = Math.round(
        squareFootage * PRICING.houseWashPerSqFt * 
        PRICING.houseWashStoryMultiplier[stories]
      );
    }
    
    // Calculate roof cleaning
    let roofCleaning = 0;
    if (additionalServices.roofCleaning) {
      roofCleaning = Math.round(
        (PRICING.roofBase[additionalServices.roofType] + 
        (squareFootage * PRICING.roofPerSqFt)) * 
        PRICING.roofSeverityMultiplier[additionalServices.roofSeverity]
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
  }, [homeDetails, additionalServices]);
  
  const bundles = useMemo<BundleTier[]>(() => {
    const { windowCleaningTotal, gutterCleaning, houseWash, roofCleaning, pressureWashing, pressureWashingAddons } = servicePrices;
    
    // Calculate one-time service price (for comparison)
    const singleServiceTotal = servicePrices.grandTotal;
    
    return (['good', 'better', 'best'] as const).map((tier) => {
      const config = BUNDLE_CONFIG[tier];
      
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
        name: config.name,
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
  }, [servicePrices, additionalServices]);
  
  return { servicePrices, bundles };
}
