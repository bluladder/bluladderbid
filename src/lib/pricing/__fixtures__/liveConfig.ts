import type {
  PricingConfig,
  EngineHomeDetails,
  EngineAdditionalServices,
} from "../engine";

/**
 * Snapshot of the LIVE production pricing_config values at the time of
 * centralization. Tests assert against these exact numbers so any accidental
 * price change is caught.
 */
export const LIVE_CONFIG: PricingConfig = {
  window_cleaning: {
    exteriorPerSqFt: 0.08,
    interiorPerSqFt: 0.075,
    minimumPrice: 185,
    modifiers: {
      stories: { "1": 0, "2": 12, "3": 18 },
      condition: { heavy: 15, maintenance: 0 },
      hardWater: 10,
      frenchPanes: 40,
      solarScreens: 20,
    },
  },
  window_addons: {
    ladderWork: { "1-3": 25, "4-8": 50, "9+": 75 },
    sunroom: { none: 0, small: 125, medium: 175, large: 225 },
  },
  house_wash: {
    perSqFt: 0.25,
    minimumPrice: 396,
    modifiers: { stories: { "1": 0, "2": 10, "3": 15 } },
    rustStainSurcharge: 15,
  },
  gutter_cleaning: {
    perSqFt: 0.08,
    minimumPrice: 200,
    modifiers: { stories: { "1": 0, "2": 10, "3": 12 } },
    undergroundDrainPricing: { "1": 75, "2": 125, "3": 175, "4+": 225 },
    minorRepairsPrice: 85,
    gutterGuardsPerLinearFoot: 8,
  },
  roof_cleaning: {
    perSqFt: 0.3,
    minimumPrice: 500,
    modifiers: {
      stories: { "1": 0, "2": 10, "3": 15 },
      roofType: { flat: 0, tile: 10, metal: 0, asphalt: 0 },
      severity: { heavy: 10, light: 0, moderate: 5 },
    },
  },
  driveway_cleaning: {
    perSqFt: 0.2,
    minimumPrice: 200,
    surfaceMultipliers: { concrete: 1, stamped: 1, pavers: 1.25, brick: 1, stone: 1, tile: 1 },
  },
  pressure_washing: {
    perSqFt: 0.25,
    minimumPrice: 75,
    surfaceMultipliers: { concrete: 1, stamped: 1.15, pavers: 1.25, brick: 1.2, stone: 1.3, tile: 1.35 },
  },
};

export function baseHome(overrides: Partial<EngineHomeDetails> = {}): EngineHomeDetails {
  return {
    squareFootage: 2000,
    stories: 1,
    windowCleaningType: "exterior",
    condition: "maintenance",
    showAdvanced: false,
    ...overrides,
  };
}

export function noServices(): EngineAdditionalServices {
  return {
    windowCleaning: false,
    houseWash: false,
    gutterCleaning: false,
    roofCleaning: false,
    drivewayCleaning: { enabled: false, sqft: 0, surfaceType: "concrete" },
    pressureWashing: {
      enabled: false,
      surfaceType: "concrete",
      frontPorch: { enabled: false, sqft: 0 },
      backPatio: { enabled: false, sqft: 0 },
      poolDeck: { enabled: false, sqft: 0 },
      walkways: { enabled: false, sqft: 0 },
    },
  };
}