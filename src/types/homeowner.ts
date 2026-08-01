// Home details and pricing types for homeowner bundle builder

export interface HomeDetails {
  squareFootage: number;
  stories: 1 | 2 | 3;
  windowCleaningType: 'exterior' | 'both' | 'promo_99';
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

  // Canonical Phase 0 amendment fields. Optional until the downstream web UI
  // adopts the shared question contract; absence never fabricates a modifier.
  screenProfile?: 'standard_removable' | 'no_screens' | 'solar' | 'mixed_standard_solar' | 'fixed_nonremovable_or_unknown';
  screenProfileProvenance?: 'captured' | 'verified' | 'corrected' | 'derived' | 'defaulted' | 'unanswered' | 'unknown';
  solarScreenCoverage?: 'all' | 'some';
  solarScreenAffectedWindowCount?: number;
  solarScreenServiceRequested?: boolean;
  enclosedPatioProfile?: 'none' | 'screened' | 'window_enclosed' | 'mixed_or_uncertain';
  screenedEnclosureSoftWash?: boolean;
  enclosureWindowCount?: number;
  enclosureWindowSides?: 'outside_only' | 'inside_and_outside';
  advancedWindowConditions?: boolean;
  hardWaterAffectedWindowEquivalents?: number;
  ladderAffectedWindowEquivalents?: number;
  addedInteriorWindowSides?: number;
  omittedWindowSides?: number | 'unknown';
}

// Driveway Cleaning - separate service with sqft-based pricing
export interface DrivewayCleaningOptions {
  enabled: boolean;
  sqft: number;
  surfaceType: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile' | 'exposed_aggregate' | 'asphalt' | 'other' | 'unknown';
}

// Flatwork area with sqft input and individual surface type
export interface FlatworkArea {
  enabled: boolean;
  sqft: number;
  surfaceType?: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile' | 'exposed_aggregate' | 'asphalt' | 'other' | 'unknown';
}

// Pressure Washing - for additional flatwork areas
export interface PressureWashingOptions {
  enabled: boolean;
  surfaceType: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile' | 'exposed_aggregate' | 'asphalt' | 'other' | 'unknown';
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

// Underground Drain Cleaning options
/** Legacy web control; the canonical contract for new channels uses an exact integer. */
export type DrainCount = '1' | '2' | '3' | '4+';

export type GutterRepairNeed =
  | 'leaking_seams'
  | 'loose_gutter_sections'
  | 'detached_gutter_sections'
  | 'loose_downspouts'
  | 'detached_downspouts'
  | 'none'
  | 'unsure'
  | 'another_repair_need';

// Gutter Cleaning Add-ons
export interface GutterCleaningAddons {
  undergroundDrains: {
    enabled: boolean;
    count: DrainCount;
  };
  minorRepairs: boolean;
  repairNeeds?: GutterRepairNeed[];
  repairNotes?: string;
  gutterGuards: {
    enabled: boolean;
    linearFeet: number;
  };
}

// House Wash Details
export type SidingMaterial = 'brick' | 'hardie' | 'vinyl' | 'stucco' | 'wood';
export type StainType = 'organic' | 'rust';

export interface HouseWashDetails {
  sidingMaterial: SidingMaterial;
  stainType: StainType;
}

// Roof pitch options (informational only)
export type RoofPitch = 'walkable' | 'moderate' | 'steep';

// Per-unit services with quantity input
export interface SolarPanelCleaningOptions {
  enabled: boolean;
  panelCount: number;
  stories?: 1 | 2 | 3;
  accessType?: 'standard_residential' | 'unusual_or_uncertain';
  knownDamage?: boolean;
  extremePitch?: boolean;
  fragileMaterial?: boolean;
  unusualAccess?: boolean;
}

export interface ScreenRepairOptions {
  enabled: boolean;
  screenCount: number;
  scopeType?: 'standard_removable_reusable_frame' | 'screen_door' | 'new_frame' | 'damaged_frame' | 'solar_screen' | 'specialty_or_oversized' | 'unknown';
}

export interface AdditionalServices {
  windowCleaning: boolean;
  drivewayCleaning: DrivewayCleaningOptions;
  pressureWashing: PressureWashingOptions;
  gutterCleaning: boolean;
  gutterAddons: GutterCleaningAddons;
  houseWash: boolean;
  houseWashDetails: HouseWashDetails;
  roofCleaning: boolean;
  roofType: 'asphalt' | 'tile' | 'metal' | 'flat';
  roofSeverity: 'light' | 'moderate' | 'heavy';
  roofRiskFlags?: { knownDamage: boolean; extremePitch: boolean; fragileMaterial: boolean; unusualAccess: boolean };
  roofPitch: RoofPitch;
  solarPanelCleaning: SolarPanelCleaningOptions;
  screenRepair: ScreenRepairOptions;
  houseWashPatios?: {
    pricingMethod?: 'simple_selection' | 'exact_square_footage';
    frontSelected?: boolean;
    backSelected?: boolean;
    frontSqft?: number;
    backSqft?: number;
  };
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
  
  // Gutter cleaning with add-ons
  gutterCleaning: number;
  gutterDrainCleaning: number;
  gutterMinorRepairs: number;
  gutterGuards: number;
  gutterCleaningTotal: number;
  
  // House wash with stain surcharge
  houseWash: number;
  houseWashRustSurcharge: number;
  houseWashTotal: number;
  
  // Roof cleaning
  roofCleaning: number;
  
  // Per-unit services
  solarPanelCleaning: number;
  screenRepair: number;

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
    frontPorch: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.frontPorch, surfaceType: 'concrete' },
    backPatio: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.backPatio, surfaceType: 'concrete' },
    poolDeck: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.poolDeck, surfaceType: 'concrete' },
    walkways: { enabled: false, sqft: FLATWORK_DEFAULT_SQFT.walkways, surfaceType: 'concrete' },
  },
  gutterCleaning: false,
  gutterAddons: {
    undergroundDrains: { enabled: false, count: '1' },
    minorRepairs: false,
    gutterGuards: { enabled: false, linearFeet: 150 },
  },
  houseWash: false,
  houseWashDetails: {
    sidingMaterial: 'vinyl',
    stainType: 'organic',
  },
  roofCleaning: false,
  roofType: 'asphalt',
  roofSeverity: 'light',
  roofPitch: 'walkable',
  solarPanelCleaning: {
    enabled: false,
    panelCount: 20,
  },
  screenRepair: {
    enabled: false,
    screenCount: 1,
  },
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
  gutterDrainCleaning: 0,
  gutterMinorRepairs: 0,
  gutterGuards: 0,
  gutterCleaningTotal: 0,
  houseWash: 0,
  houseWashRustSurcharge: 0,
  houseWashTotal: 0,
  roofCleaning: 0,
  solarPanelCleaning: 0,
  screenRepair: 0,
  additionalServicesTotal: 0,
  grandTotal: 0,
};
