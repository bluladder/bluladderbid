/**
 * FROZEN REFERENCE FIXTURE — an independent, verbatim copy of the good/better/
 * best tier pricing arithmetic that used to live in the frontend
 * `useServicePricing` hook (pre server-authoritative migration). It exists ONLY
 * to prove, in tests, that the canonical engine's `computeBundleTiers` reproduces
 * the exact prior customer prices. It must NOT be imported by production code.
 */
import type { PricingConfig, EngineHomeDetails, EngineAdditionalServices } from "../engine";

function applyModifiers(basePrice: number, modifierPercents: number[]): number {
  const totalPercent = modifierPercents.reduce((sum, pct) => sum + pct, 0);
  return Math.round(basePrice * (1 + totalPercent / 100));
}

export interface LegacyServiceBases {
  exteriorWindows: number;
  interiorWindows: number;
  gutterCleaning: number;
  houseWash: number;
  roofCleaning: number;
  drivewayCleaning: number;
  pressureWashing: number;
}

export function legacyServiceBases(
  home: EngineHomeDetails,
  svc: EngineAdditionalServices,
  PRICING: PricingConfig,
): LegacyServiceBases {
  const squareFootage = home.squareFootage;
  const stories = home.stories;

  let exteriorWindows = 0;
  let interiorWindows = 0;
  if (svc.windowCleaning) {
    const windowConfig = PRICING.window_cleaning;
    const windowModifiers = windowConfig.modifiers;
    const baseExterior = squareFootage * windowConfig.exteriorPerSqFt;
    const baseInterior =
      home.windowCleaningType === "both" ? squareFootage * windowConfig.interiorPerSqFt : 0;
    const storyMod = windowModifiers.stories[stories.toString()] ?? 0;
    const conditionMod = windowModifiers.condition?.[home.condition ?? ""] ?? 0;
    exteriorWindows = Math.round(baseExterior * (1 + storyMod / 100 + conditionMod / 100));
    interiorWindows = Math.round(baseInterior * (1 + conditionMod / 100));
  }

  let houseWash = 0;
  if (svc.houseWash) {
    const houseConfig = PRICING.house_wash;
    const baseHouseWash = squareFootage * houseConfig.perSqFt;
    const houseStoryMod = houseConfig.modifiers.stories[stories.toString()] ?? 0;
    const houseWashCalculated = applyModifiers(baseHouseWash, [houseStoryMod]);
    houseWash = Math.max(houseWashCalculated, houseConfig.minimumPrice ?? 0);
  }

  let gutterCleaning = 0;
  if (svc.gutterCleaning) {
    const gutterConfig = PRICING.gutter_cleaning;
    const baseGutter = squareFootage * gutterConfig.perSqFt;
    const gutterStoryMod = gutterConfig.modifiers.stories[stories.toString()] ?? 0;
    const gutterCalculated = applyModifiers(baseGutter, [gutterStoryMod]);
    gutterCleaning = Math.max(gutterCalculated, gutterConfig.minimumPrice ?? 0);
  }

  let roofCleaning = 0;
  if (svc.roofCleaning) {
    const roofConfig = PRICING.roof_cleaning;
    const baseRoof = squareFootage * roofConfig.perSqFt;
    const roofStoryMod = roofConfig.modifiers.stories[stories.toString()] ?? 0;
    const roofTypeMod = roofConfig.modifiers.roofType?.[svc.roofType ?? ""] ?? 0;
    const severityMod = roofConfig.modifiers.severity?.[svc.roofSeverity ?? ""] ?? 0;
    const roofCalculated = applyModifiers(baseRoof, [roofStoryMod, roofTypeMod, severityMod]);
    roofCleaning = Math.max(roofCalculated, roofConfig.minimumPrice ?? 0);
  }

  let drivewayCleaning = 0;
  if (svc.drivewayCleaning?.enabled) {
    const dwConfig = PRICING.driveway_cleaning;
    const { sqft, surfaceType } = svc.drivewayCleaning;
    const baseDriveway = sqft * dwConfig.perSqFt;
    const surfaceMult = dwConfig.surfaceMultipliers[surfaceType] ?? 1;
    const drivewayCalculated = Math.round(baseDriveway * surfaceMult);
    drivewayCleaning = Math.max(drivewayCalculated, dwConfig.minimumPrice ?? 0);
  }

  let pressureWashing = 0;
  if (svc.pressureWashing?.enabled) {
    const pwConfig = PRICING.pressure_washing;
    const { surfaceType, frontPorch, backPatio, poolDeck, walkways } = svc.pressureWashing;
    const surfaceMult = pwConfig.surfaceMultipliers[surfaceType] ?? 1;
    let sum = 0;
    if (frontPorch.enabled) sum += Math.round(frontPorch.sqft * pwConfig.perSqFt * surfaceMult);
    if (backPatio.enabled) sum += Math.round(backPatio.sqft * pwConfig.perSqFt * surfaceMult);
    if (poolDeck.enabled) sum += Math.round(poolDeck.sqft * pwConfig.perSqFt * surfaceMult);
    if (walkways.enabled) sum += Math.round(walkways.sqft * pwConfig.perSqFt * surfaceMult);
    pressureWashing = sum;
    if (pressureWashing > 0) pressureWashing = Math.max(pressureWashing, pwConfig.minimumPrice ?? 0);
  }

  return { exteriorWindows, interiorWindows, gutterCleaning, houseWash, roofCleaning, drivewayCleaning, pressureWashing };
}

export interface LegacyTier {
  tier: string;
  annualTotal: number;
  monthlyPayment: number;
  savings: number;
  savingsPercent: number;
  addonSavings: number;
  windowCost: number;
  additionalServicesCost: number;
  addonsCost: number;
  bundleDiscount: number;
  windowFrequencyConfig: { exteriorFrequency: number; interiorFrequency: number };
  additionalServicesIncluded: string[];
  baseServices: string[];
  availableAddons: string[];
}

const MINIMUM_TIER_BUFFER = 25;

export function legacyBundles(
  home: EngineHomeDetails,
  svc: EngineAdditionalServices,
  PRICING: PricingConfig,
): LegacyTier[] {
  const bases = legacyServiceBases(home, svc, PRICING);
  const { exteriorWindows, interiorWindows, gutterCleaning, houseWash, roofCleaning, drivewayCleaning, pressureWashing } = bases;
  const BUNDLE_CONFIG = PRICING.bundle_config as Record<string, any>;

  const rawTiers = (["good", "better", "best"] as const)
    .map((tier) => {
      const config = BUNDLE_CONFIG[tier];
      if (!config) return null;

      const exteriorCost = exteriorWindows * config.exteriorWindowFrequency;
      const interiorCost = interiorWindows * config.interiorWindowFrequency;
      const windowCost = exteriorCost + interiorCost;

      let baseServicesCost = 0;
      const includedServices: string[] = [];
      const baseServices: string[] = [];

      if (config.includedServices.includes("gutter_cleaning") && svc.gutterCleaning) {
        baseServicesCost += gutterCleaning * config.additionalServicesFrequency;
        includedServices.push(`Gutter Cleaning (${config.additionalServicesFrequency}x/year)`);
        baseServices.push("gutter_cleaning");
      }
      if (config.includedServices.includes("house_wash") && svc.houseWash) {
        baseServicesCost += houseWash;
        includedServices.push("House Wash");
        baseServices.push("house_wash");
      }
      if (tier === "best" && svc.roofCleaning) {
        baseServicesCost += roofCleaning;
        includedServices.push("Roof Cleaning");
        baseServices.push("roof_cleaning");
      }

      let addonsCost = 0;
      const addonsList: string[] = [];
      if (svc.drivewayCleaning?.enabled) {
        addonsCost += drivewayCleaning * (1 - config.addonDiscount);
        addonsList.push("Driveway Cleaning");
      }
      if (svc.pressureWashing?.enabled) {
        addonsCost += pressureWashing * (1 - config.addonDiscount);
        addonsList.push("Pressure Washing");
      }
      if (!config.includedServices.includes("gutter_cleaning") && svc.gutterCleaning) {
        addonsCost += gutterCleaning * config.additionalServicesFrequency * (1 - config.addonDiscount);
        addonsList.push(`Gutter Cleaning (${config.additionalServicesFrequency}x/year)`);
      }
      if (!config.includedServices.includes("house_wash") && svc.houseWash) {
        addonsCost += houseWash * (1 - config.addonDiscount);
        addonsList.push("House Wash");
      }
      if (tier !== "best" && svc.roofCleaning) {
        addonsCost += roofCleaning * (1 - config.addonDiscount);
        addonsList.push("Roof Cleaning");
      }

      const subtotal = windowCost + baseServicesCost + addonsCost;
      const bundleDiscount = subtotal * config.bundleDiscount;
      const annualTotal = Math.round(subtotal - bundleDiscount);
      const monthlyPayment = Math.round(annualTotal / 12);

      const fullPriceAddons =
        (svc.drivewayCleaning?.enabled ? drivewayCleaning : 0) +
        (svc.pressureWashing?.enabled ? pressureWashing : 0) +
        (!config.includedServices.includes("gutter_cleaning") && svc.gutterCleaning ? gutterCleaning * config.additionalServicesFrequency : 0) +
        (!config.includedServices.includes("house_wash") && svc.houseWash ? houseWash : 0) +
        (tier !== "best" && svc.roofCleaning ? roofCleaning : 0);
      const addonSavings = Math.round(fullPriceAddons - addonsCost);

      const individualTotal = windowCost + baseServicesCost + fullPriceAddons;
      const savings = Math.round(individualTotal - annualTotal);
      const savingsPercent = individualTotal > 0 ? Math.round((savings / individualTotal) * 100) : 0;

      const availableAddons = [
        "driveway_cleaning",
        "pressure_washing",
        ...(!config.includedServices.includes("gutter_cleaning") ? ["gutter_cleaning"] : []),
        ...(!config.includedServices.includes("house_wash") ? ["house_wash"] : []),
        ...(tier !== "best" ? ["roof_cleaning"] : []),
      ];

      return {
        tier,
        config,
        annualTotal,
        monthlyPayment,
        savings,
        savingsPercent,
        addonSavings,
        includedServices: [...includedServices, ...addonsList],
        baseServices,
        availableAddons,
        windowCost: Math.round(windowCost),
        baseServicesCost: Math.round(baseServicesCost),
        addonsCost: Math.round(addonsCost),
        bundleDiscount: Math.round(bundleDiscount),
      };
    })
    .filter(Boolean) as any[];

  const adjustedTiers = [...rawTiers];
  if (adjustedTiers[1] && adjustedTiers[0] && adjustedTiers[1].annualTotal <= adjustedTiers[0].annualTotal) {
    adjustedTiers[1].annualTotal = adjustedTiers[0].annualTotal + MINIMUM_TIER_BUFFER;
    adjustedTiers[1].monthlyPayment = Math.round(adjustedTiers[1].annualTotal / 12);
  }
  if (adjustedTiers[2] && adjustedTiers[1] && adjustedTiers[2].annualTotal <= adjustedTiers[1].annualTotal) {
    adjustedTiers[2].annualTotal = adjustedTiers[1].annualTotal + MINIMUM_TIER_BUFFER;
    adjustedTiers[2].monthlyPayment = Math.round(adjustedTiers[2].annualTotal / 12);
  }

  return adjustedTiers.map((t) => ({
    tier: t.tier,
    annualTotal: t.annualTotal,
    monthlyPayment: t.monthlyPayment,
    savings: t.savings,
    savingsPercent: t.savingsPercent,
    addonSavings: t.addonSavings,
    windowCost: t.windowCost,
    additionalServicesCost: t.baseServicesCost,
    addonsCost: t.addonsCost,
    bundleDiscount: t.bundleDiscount,
    windowFrequencyConfig: {
      exteriorFrequency: t.config.exteriorWindowFrequency,
      interiorFrequency: t.config.interiorWindowFrequency,
    },
    additionalServicesIncluded: t.includedServices,
    baseServices: t.baseServices,
    availableAddons: t.availableAddons,
  }));
}
