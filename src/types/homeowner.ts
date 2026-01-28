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

// Driveway Cleaning - separate service with sqft-based pricing
export interface DrivewayCleaningOptions {
  enabled: boolean;
  sqft: number;
  surfaceType: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile';
}

// Flatwork area with sqft input
export interface FlatworkArea {
  enabled: boolean;
  sqft: number;
}

// Pressure Washing - for additional flatwork areas
export interface PressureWashingOptions {
  enabled: boolean;
  surfaceType: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile';
  frontPorch: FlatworkArea;
  backPatio: FlatworkArea;
  poolDeck: FlatworkArea;
  walkways: FlatworkArea;
}

// Default sqft estimates for each area type
export const FLATWORK_DEFAULT_SQFT = {
  driveway: 400,      // Average 2-car driveway
  frontPorch: 80,     // Average front porch
  backPatio: 200,     // Average back patio
  poolDeck: 300,      // Average pool deck
  walkways: 100,      // Average total walkway area
} as const;

export interface AdditionalServices {
  windowCleaning: boolean;
  drivewayCleaning: DrivewayCleaningOptions;
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
  
  // Driveway cleaning (separate service)
  drivewayCleaning: number;
  
  // Pressure washing (flatwork)
  pressureWashing: number;
  pressureWashingBreakdown: {
    frontPorch: number;
    backPatio: number;
    poolDeck: number;
    walkways: number;
  };
  
  // Other services
  gutterCleaning: number;
  houseWash: number;
  roofCleaning: number;
  
  // Totals
  additionalServicesTotal: number;
  grandTotal: number;
}

// Window frequency configuration for bundles
export interface WindowFrequencyConfig {
  exteriorFrequency: 1 | 2 | 3 | 4;  // times per year
  interiorFrequency: 0 | 1 | 2;       // times per year (0 = not included)
}

// Bundle customization state
export interface BundleCustomization {
  windowFrequency: WindowFrequencyConfig;
  addedServices: string[];      // Services added beyond tier defaults
  swappedServices: { from: string; to: string }[];  // Service swaps
}

// Bundle tier configuration
export interface BundleTier {
  name: 'Good' | 'Better' | 'Best';
  tier: 'good' | 'better' | 'best';
  label: string;
  description: string;
  features: string[];
  
  // Window frequency details
  windowFrequency: number;  // Legacy: total visits (for backward compat)
  windowFrequencyConfig: WindowFrequencyConfig;
  
  // Services
  additionalServicesIncluded: string[];
  baseServices: string[];           // Services included by default
  availableAddons: string[];        // Services that can be added
  
  // Pricing
  annualTotal: number;
  monthlyPayment: number;
  savings: number;
  savingsPercent: number;
  
  // Addon discount for this tier (5%/10%/15%)
  addonDiscountPercent: number;
  addonSavings: number;
  
  // Pricing breakdown for transparency
  windowCost: number;
  additionalServicesCost: number;
  addonsCost: number;
  bundleDiscount: number;
  
  // Display
  isPopular?: boolean;
  isCustomized?: boolean;
}

export const DEFAULT_HOME_DETAILS: HomeDetails = {
  squareFootage: 0, // Changed from 2000 - blank by default, placeholder shows "e.g. 2,000 sq ft"
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
  // IMPORTANT: Window Cleaning should not be auto-selected globally.
  // Dedicated landing pages (e.g. /window-cleaning) may pre-select it locally.
  windowCleaning: false,
  drivewayCleaning: {
    enabled: false,
    sqft: FLATWORK_DEFAULT_SQFT.driveway,
    surfaceType: 'concrete',
  },
  pressureWashing: {
    enabled: false,
    surfaceType: 'concrete',
    frontPorch: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.frontPorch },
    backPatio: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.backPatio },
    poolDeck: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.poolDeck },
    walkways: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.walkways },
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
