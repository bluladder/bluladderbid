// Home details and pricing types for homeowner bundle builder

export interface HomeDetails {
  squareFootage: number;
  stories: 1 | 2 | 3;
  windowCleaningType: 'exterior' | 'both';
  condition: 'maintenance' | 'heavy';
  
  // Advanced window details
  showAdvanced: boolean;
  hardWaterStains: boolean;
  hardWaterPercent: 25 | 50 | 75 | 100;
  frenchPanes: boolean;
  frenchPanesPercent: 25 | 50 | 75 | 100;
  solarScreens: boolean;
  solarScreensPercent: 25 | 50 | 75 | 100;
  ladderWork: boolean;
  ladderWorkCount: '1-3' | '4-8' | '9+';
  sunroom: 'none' | 'small' | 'medium' | 'large';
}

export interface PressureWashingOptions {
  enabled: boolean;
  drivewaySize: 'small' | 'medium' | 'large';
  surfaceType: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile';
  frontPorch: boolean;
  backPatio: boolean;
  poolDeck: boolean;
  sidewalks: boolean;
}

export interface AdditionalServices {
  pressureWashing: PressureWashingOptions;
  gutterCleaning: boolean;
  houseWash: boolean;
  roofCleaning: boolean;
  roofType: 'asphalt' | 'tile' | 'metal' | 'flat';
  roofSeverity: 'light' | 'moderate' | 'heavy';
}

// All calculated service prices - the single source of truth
export interface ServicePrices {
  // Window cleaning
  exteriorWindows: number;
  interiorWindows: number;
  hardWaterAddon: number;
  frenchPanesAddon: number;
  solarScreensAddon: number;
  ladderWorkAddon: number;
  sunroomAddon: number;
  windowCleaningTotal: number;
  
  // Additional services
  pressureWashing: number;
  pressureWashingAddons: number;
  gutterCleaning: number;
  houseWash: number;
  roofCleaning: number;
  
  // Totals
  additionalServicesTotal: number;
  grandTotal: number;
}

// Bundle tier configuration
export interface BundleTier {
  name: 'Good' | 'Better' | 'Best';
  tier: 'good' | 'better' | 'best';
  label: string;
  description: string;
  features: string[];
  windowFrequency: number; // times per year
  additionalServicesIncluded: string[];
  annualTotal: number;
  monthlyPayment: number;
  savings: number;
  savingsPercent: number;
  isPopular?: boolean;
}

export const DEFAULT_HOME_DETAILS: HomeDetails = {
  squareFootage: 2000,
  stories: 1,
  windowCleaningType: 'exterior',
  condition: 'maintenance',
  showAdvanced: false,
  hardWaterStains: false,
  hardWaterPercent: 25,
  frenchPanes: false,
  frenchPanesPercent: 25,
  solarScreens: false,
  solarScreensPercent: 25,
  ladderWork: false,
  ladderWorkCount: '1-3',
  sunroom: 'none',
};

export const DEFAULT_ADDITIONAL_SERVICES: AdditionalServices = {
  pressureWashing: {
    enabled: false,
    drivewaySize: 'medium',
    surfaceType: 'concrete',
    frontPorch: false,
    backPatio: false,
    poolDeck: false,
    sidewalks: false,
  },
  gutterCleaning: false,
  houseWash: false,
  roofCleaning: false,
  roofType: 'asphalt',
  roofSeverity: 'light',
};

export const DEFAULT_SERVICE_PRICES: ServicePrices = {
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
