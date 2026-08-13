import type { PricingConfig } from "../../src/lib/pricing/engine";

export const BLULADDER_KLAMATH_PRICING_PROFILE_KEY =
  "bluladder-klamath-pricing-draft";

/**
 * Independent Klamath starting point copied from the verified DFW pricing
 * snapshot. It is intentionally not imported from the DFW fixture so the two
 * markets cannot drift together accidentally. This draft is not runtime wired.
 */
export const BLULADDER_KLAMATH_PRICING_DRAFT: PricingConfig = {
  window_cleaning: {
    exteriorPerSqFt: 0.08,
    interiorPerSqFt: 0.075,
    insideAndOutsidePerSqFt: 0.15,
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
    surfaceMultipliers: {
      concrete: 1,
      stamped: 1,
      pavers: 1.25,
      exposed_aggregate: 1,
      brick: 1,
      stone: 1,
      asphalt: 1,
      tile: 1,
    },
  },
  pressure_washing: {
    perSqFt: 0.25,
    minimumPrice: 75,
    surfaceMultipliers: {
      concrete: 1,
      stamped: 1.15,
      pavers: 1.25,
      exposed_aggregate: 1.15,
      brick: 1.2,
      stone: 1.3,
      asphalt: 1,
      tile: 1.35,
    },
  },
  solar_panel_cleaning: { perPanel: 10, minimumPrice: 0 },
  screen_repair: { perScreen: 35, minimumPrice: 0 },
  tax_policy: {
    version: "oregon-no-general-sales-tax-2026-08-13",
    rate: 0,
    exemptLineItemKeys: [],
    customerLabel: "Tax",
  },
  duration_policy: {
    version: "klamath-draft-dfw-productivity-copy-2026-08-13",
    setupMinutes: 15,
    roundingIncrementMinutes: 15,
    hourlyRevenueTargets: {
      windowsAndScreens: 120,
      gutterWork: 150,
      exteriorCleaning: 175,
    },
  },
  window_promo_99: {
    active: false,
    promoId: "PROMO_99_WINDOWS",
    version: 1,
    flatPrice: 99,
    maxWindows: 10,
    effectiveStart: null,
    effectiveEnd: null,
    prepInstructions:
      "Customer must remove all window screens before BluLadder arrives. Screen removal and screen cleaning are not included. Interior window cleaning is not included. Tracks and sills are not included.",
    stackingPolicy: "none",
    serviceLabel: "$99 Exterior Window Cleaning (up to 10 windows)",
    terms:
      "Residential exterior window cleaning only. Covers up to 10 standard exterior windows.",
  },
  bundle_config: {
    good: {
      name: "Good",
      label: "Core Exterior Care",
      description:
        "Essential exterior window cleaning to keep your home looking great",
      addonDiscount: 0.05,
      bundleDiscount: 0,
      includedServices: [],
      exteriorWindowFrequency: 4,
      interiorWindowFrequency: 0,
      additionalServicesFrequency: 1,
    },
    better: {
      name: "Better",
      label: "Consistent Window Care",
      description: "Complete window care with interior cleaning included",
      addonDiscount: 0.1,
      bundleDiscount: 0.05,
      includedServices: ["gutter_cleaning"],
      exteriorWindowFrequency: 4,
      interiorWindowFrequency: 1,
      additionalServicesFrequency: 1,
    },
    best: {
      name: "Best",
      label: "Total Window & Home Care",
      description:
        "Maximum coverage with frequent interior cleaning and premium perks",
      addonDiscount: 0.15,
      bundleDiscount: 0.1,
      includedServices: ["gutter_cleaning", "house_wash"],
      exteriorWindowFrequency: 4,
      interiorWindowFrequency: 2,
      additionalServicesFrequency: 2,
    },
  },
  bundle_rules: {
    minimumTierBuffer: 25,
    tierOrder: ["good", "better", "best"],
    planDownPaymentPercent: 20,
    planMonthlyInstallments: 11,
    roofBaseIncludedTiers: ["best"],
    alwaysAddonServices: ["driveway_cleaning", "pressure_washing"],
  },
};

export const BLULADDER_KLAMATH_TRAVEL_DRAFT = Object.freeze({
  status: "manual_review" as const,
  includedOneWayMinutes: 45,
  waiveChargeAtSubtotal: 500,
  proposedFlatCharge: 100,
  mileageRate: null,
  unresolvedFields: ["mileage_rate", "distance_measurement_source"] as const,
});
