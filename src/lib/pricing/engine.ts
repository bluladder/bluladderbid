/**
 * ============================================================================
 * BluLadder CANONICAL PRICING ENGINE  (single source of truth)
 * ============================================================================
 * This is a PURE, framework-agnostic module. It has NO React, Deno, Supabase
 * or network dependencies so the identical logic can run in:
 *   - the frontend (instant, clearly-labelled ESTIMATE)   -> src/lib/pricing/engine.ts
 *   - the server   (AUTHORITATIVE quote)                   -> supabase/functions/_shared/pricingEngine.ts
 *
 * The server copy MUST stay byte-identical to this file. A parity test
 * (engine.parity.test.ts) enforces that.
 *
 * Do NOT hard-code prices here. All monetary values come from the `pricing`
 * argument (the live `pricing_config` table). If required config is missing the
 * engine returns a safe status ('manual_review_required' / 'missing_information')
 * instead of guessing.
 */

export const PRICING_ENGINE_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Config shapes (mirror of the pricing_config table, keyed by config_key)
// ---------------------------------------------------------------------------
export interface ServiceModifiers {
  stories: Record<string, number>;
  condition?: Record<string, number>;
  hardWater?: number;
  frenchPanes?: number;
  solarScreens?: number;
  roofType?: Record<string, number>;
  severity?: Record<string, number>;
}

export interface PricingConfig {
  window_cleaning: {
    exteriorPerSqFt: number;
    interiorPerSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers;
  };
  window_addons: {
    ladderWork: Record<string, number>;
    sunroom: Record<string, number>;
  };
  house_wash: {
    perSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers;
    rustStainSurcharge?: number;
  };
  gutter_cleaning: {
    perSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers;
    undergroundDrainPricing?: Record<string, number>;
    minorRepairsPrice?: number;
    gutterGuardsPerLinearFoot?: number;
  };
  roof_cleaning: {
    perSqFt: number;
    minimumPrice: number;
    modifiers: ServiceModifiers;
  };
  driveway_cleaning: {
    perSqFt: number;
    minimumPrice: number;
    surfaceMultipliers: Record<string, number>;
  };
  pressure_washing: {
    perSqFt: number;
    minimumPrice: number;
    surfaceMultipliers: Record<string, number>;
  };
  /** Per-unit price for solar panel cleaning. */
  solar_panel_cleaning?: {
    perPanel: number;
    minimumPrice?: number;
  };
  /** Per-unit price for screen repair. */
  screen_repair?: {
    perScreen: number;
    minimumPrice?: number;
  };
  /** Optional administrator-controlled $99 window promotion. */
  window_promo_99?: PromotionConfig;
  /**
   * Optional administrator-controlled recurring/bundle configuration, keyed by
   * bundle identifier (e.g. "good" | "better" | "best"). Discounts are fractions
   * in the range 0..1 (e.g. 0.05 === 5%). This lives in the pricing_config table
   * so bundle/recurring rules are administrator-controlled, never client-supplied.
   */
  bundle_config?: Record<string, BundleConfigEntry>;
  /**
   * Administrator-controlled tier guardrail / structure rules (see
   * BundleRulesConfig). Stored under the `bundle_rules` key in pricing_config.
   */
  bundle_rules?: BundleRulesConfig;
}

export interface BundleConfigEntry {
  name?: string;
  label?: string;
  description?: string;
  /** Overall bundle discount applied to the annual subtotal (fraction 0..1). */
  bundleDiscount?: number;
  /** Discount applied to customer-added services (fraction 0..1). */
  addonDiscount?: number;
  exteriorWindowFrequency?: number;
  interiorWindowFrequency?: number;
  additionalServicesFrequency?: number;
  includedServices?: string[];
}

/**
 * Administrator-controlled guardrail/structure rules for the good/better/best
 * plan tiers. Stored under the `bundle_rules` key in pricing_config so the
 * values are versioned with the rest of pricing and never hard-coded in the
 * frontend. All values preserve the prior production behavior exactly.
 */
export interface BundleRulesConfig {
  /** Minimum dollar gap enforced between adjacent tiers (good<better<best). */
  minimumTierBuffer?: number;
  /** Ordered tier keys, lowest → highest. */
  tierOrder?: string[];
  /** Plan deposit percent (of annual total) taken up front. */
  planDownPaymentPercent?: number;
  /** Number of monthly installments the remaining balance is split into. */
  planMonthlyInstallments?: number;
  /** Tiers where roof cleaning is a base (full-price, included) service. */
  roofBaseIncludedTiers?: string[];
  /** Services that are ALWAYS customer add-ons (never base) in every tier. */
  alwaysAddonServices?: string[];
}

/**
 * Administrator-controlled promotional offer configuration. Stored under the
 * `window_promo_99` key in pricing_config. This is OPTIONAL — its absence simply
 * means no promotion is available (never a fallback price). Every field is
 * administrator-controlled; the engine never invents dates, limits or prices.
 */
export interface PromotionConfig {
  active: boolean;
  promoId: string;
  version: number;
  flatPrice: number;
  maxWindows: number;
  /** ISO date (yyyy-mm-dd) or null for no start bound. Administrator-controlled. */
  effectiveStart?: string | null;
  /** ISO date (yyyy-mm-dd) or null for no end bound. Administrator-controlled. */
  effectiveEnd?: string | null;
  /** Preparation requirement preserved into the quote snapshot and Jobber notes. */
  prepInstructions: string;
  /**
   * Stacking policy is administrator-configurable. Until an administrator
   * intentionally selects a policy other than "none", promotions never stack
   * with discount codes or other promotions.
   */
  stackingPolicy?: "none" | "allow_discount_codes";
  serviceLabel?: string;
  terms?: string;
}

// ---------------------------------------------------------------------------
// Input shapes (structural — match HomeDetails / AdditionalServices)
// ---------------------------------------------------------------------------
export interface EngineHomeDetails {
  squareFootage: number;
  stories: number;
  windowCleaningType?: string; // 'exterior' | 'both'
  condition?: string; // 'maintenance' | 'heavy'
  showAdvanced?: boolean;
  hardWaterStains?: boolean;
  hardWaterPercent?: number;
  frenchPanes?: boolean;
  frenchPanesPercent?: number;
  solarScreens?: boolean;
  solarScreensPercent?: number;
  ladderWork?: boolean;
  ladderWorkCount?: string;
  sunroom?: string;
}

export interface EngineAreaSelection {
  enabled: boolean;
  sqft: number;
}

export interface EngineAdditionalServices {
  windowCleaning?: boolean;
  /**
   * Interior-only window cleaning as a STANDALONE line item (used by the plan
   * builder, where interior windows have their own frequency). This is priced
   * with the same interior rule the plan builder historically used locally:
   * sqft × interiorPerSqFt with story+condition modifiers and a 0.6× minimum.
   * The one-time flow does NOT use this (it uses windowCleaningType='both').
   */
  interiorWindows?: boolean;
  houseWash?: boolean;
  houseWashDetails?: { stainType?: string };
  gutterCleaning?: boolean;
  gutterAddons?: {
    undergroundDrains?: { enabled: boolean; count: string };
    minorRepairs?: boolean;
    gutterGuards?: { enabled: boolean; linearFeet?: number };
  };
  roofCleaning?: boolean;
  roofType?: string;
  roofSeverity?: string;
  drivewayCleaning?: { enabled: boolean; sqft: number; surfaceType: string };
  pressureWashing?: {
    enabled: boolean;
    surfaceType: string;
    frontPorch: EngineAreaSelection;
    backPatio: EngineAreaSelection;
    poolDeck: EngineAreaSelection;
    walkways: EngineAreaSelection;
  };
  solarPanelCleaning?: { enabled: boolean; panelCount: number };
  screenRepair?: { enabled: boolean; screenCount: number };
}

export interface EngineDiscount {
  type: "percentage" | "fixed";
  value: number;
  code?: string;
}

/**
 * An explicit promotion selection. A promotion NEVER applies automatically —
 * the customer must explicitly select it (or supply its approved identifier),
 * so this field must be present and populated by the caller.
 */
export interface PromotionRequest {
  /** Approved promotional identifier (must match the configured promoId). */
  id: string;
  /** Number of standard exterior windows the customer wants cleaned. */
  windowCount: number;
}

export interface QuoteInput {
  homeDetails: EngineHomeDetails;
  additionalServices: EngineAdditionalServices;
  discount?: EngineDiscount | null;
  /** Present ONLY when the customer explicitly selects a promotion. */
  promotion?: PromotionRequest | null;
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------
export type QuoteStatus =
  | "firm"
  | "estimated"
  | "manual_review_required"
  | "missing_information";

export interface QuoteLineItem {
  key: string;
  label: string;
  quantity: number;
  unit: string; // 'sqft' | 'each' | 'linear_ft' | 'flat'
  baseAmount: number;
  adjustments: { label: string; amount: number }[];
  minimumApplied: boolean;
  amount: number;
  jobberLineItem?: { name: string; description?: string; unitPrice: number };
  /** Optional structured sub-components (e.g. window exterior/interior split). */
  components?: Record<string, number>;
}

export interface QuoteResult {
  engineVersion: string;
  ruleVersion: number | null;
  status: QuoteStatus;
  firm: boolean;
  lineItems: QuoteLineItem[];
  subtotal: number;
  discount: { code?: string; type?: string; value?: number; amount: number } | null;
  total: number;
  estimatedDurationMinutes: number | null;
  missing: string[];
  manualReviewReasons: string[];
  explanation: string;
  trace: string[];
  jobberLineItems: { name: string; description?: string; unitPrice: number }[];
  /**
   * Applied promotion snapshot. Preserved into the quote snapshot and booking
   * notes so promo ID, version and terms travel with the record. Null when no
   * promotion was applied.
   */
  promotion: {
    id: string;
    version: number;
    flatPrice: number;
    maxWindows: number;
    windowCount: number;
    prepInstructions: string;
    terms?: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Money helpers — round only at defined points (per-service, and final discount)
// ---------------------------------------------------------------------------
function roundDollars(n: number): number {
  return Math.round(n);
}
function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function applyModifiers(basePrice: number, modifierPercents: number[]): number {
  const totalPercent = modifierPercents.reduce((sum, pct) => sum + pct, 0);
  return Math.round(basePrice * (1 + totalPercent / 100));
}
function isValidNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

const MAX_SQFT = 100000;
const VALID_STORIES = [1, 2, 3];

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export function calculateQuote(
  input: QuoteInput,
  pricing: PricingConfig,
  ruleVersion: number | null = null,
): QuoteResult {
  const trace: string[] = [];
  const missing: string[] = [];
  const manualReviewReasons: string[] = [];
  const lineItems: QuoteLineItem[] = [];

  const home = input.homeDetails ?? ({} as EngineHomeDetails);
  const svc = input.additionalServices ?? ({} as EngineAdditionalServices);

  // =========================================================================
  // PROMOTION BRANCH — only when the customer EXPLICITLY selected a promotion.
  // A promotion never applies automatically and never silently replaces the
  // normal window-cleaning price. It is handled in isolation and returns early.
  // =========================================================================
  if (input.promotion && input.promotion.id) {
    return calculatePromotion(input.promotion, pricing, ruleVersion, trace);
  }

  const anyServiceSelected =
    !!svc.windowCleaning ||
    !!svc.interiorWindows ||
    !!svc.houseWash ||
    !!svc.gutterCleaning ||
    !!svc.roofCleaning ||
    !!svc.drivewayCleaning?.enabled ||
    !!svc.pressureWashing?.enabled ||
    !!svc.solarPanelCleaning?.enabled ||
    !!svc.screenRepair?.enabled;

  if (!anyServiceSelected) {
    missing.push("services");
  }

  // Square footage is required for every sqft-based service (all of them).
  const squareFootage = home.squareFootage;
  const needsSqft =
    !!svc.windowCleaning ||
    !!svc.interiorWindows ||
    !!svc.houseWash ||
    !!svc.gutterCleaning ||
    !!svc.roofCleaning;
  if (needsSqft) {
    if (!isValidNumber(squareFootage) || squareFootage <= 0) {
      missing.push("squareFootage");
    } else if (squareFootage > MAX_SQFT) {
      manualReviewReasons.push(
        `Square footage ${squareFootage} exceeds automated range; manual review required`,
      );
    }
  }

  const stories = home.stories;
  const needsStories = needsSqft;
  if (needsStories && !VALID_STORIES.includes(stories)) {
    missing.push("stories");
  }

  // If we already know inputs are unusable, fail safely before doing math.
  if (missing.length > 0) {
    return finalize(
      {
        status: "missing_information",
        lineItems: [],
        subtotal: 0,
        discount: null,
        total: 0,
        trace,
        missing,
        manualReviewReasons,
      },
      ruleVersion,
    );
  }

  const sqft = squareFootage;

  // =========================================================================
  // WINDOW CLEANING
  // =========================================================================
  if (svc.windowCleaning) {
    const cfg = pricing.window_cleaning;
    if (!cfg) {
      manualReviewReasons.push("window_cleaning pricing not configured");
    } else {
      const mods = cfg.modifiers;
      const baseExterior = sqft * cfg.exteriorPerSqFt;
      const baseInterior =
        home.windowCleaningType === "both" ? sqft * cfg.interiorPerSqFt : 0;

      const storyMod = mods.stories[stories.toString()] ?? 0;
      const conditionMod = mods.condition?.[home.condition ?? ""] ?? 0;

      const exteriorWindows = roundDollars(
        baseExterior * (1 + storyMod / 100 + conditionMod / 100),
      );
      const interiorWindows = roundDollars(baseInterior * (1 + conditionMod / 100));
      const adjustedWindowBase = exteriorWindows + interiorWindows;

      const adjustments: { label: string; amount: number }[] = [];
      let hardWaterAddon = 0;
      let frenchPanesAddon = 0;
      let solarScreensAddon = 0;
      let ladderWorkAddon = 0;
      let sunroomAddon = 0;

      if (home.showAdvanced) {
        if (home.hardWaterStains && mods.hardWater) {
          hardWaterAddon = roundDollars(
            adjustedWindowBase * (mods.hardWater / 100) * ((home.hardWaterPercent ?? 0) / 100),
          );
        }
        if (home.frenchPanes && mods.frenchPanes) {
          frenchPanesAddon = roundDollars(
            adjustedWindowBase * (mods.frenchPanes / 100) * ((home.frenchPanesPercent ?? 0) / 100),
          );
        }
        if (home.solarScreens && mods.solarScreens) {
          solarScreensAddon = roundDollars(
            adjustedWindowBase * (mods.solarScreens / 100) * ((home.solarScreensPercent ?? 0) / 100),
          );
        }
        if (home.ladderWork) {
          ladderWorkAddon = pricing.window_addons?.ladderWork[home.ladderWorkCount ?? ""] ?? 0;
        }
        sunroomAddon = pricing.window_addons?.sunroom[home.sunroom ?? ""] ?? 0;
      }

      const calculated =
        adjustedWindowBase +
        hardWaterAddon +
        frenchPanesAddon +
        solarScreensAddon +
        ladderWorkAddon +
        sunroomAddon;
      const minimum = cfg.minimumPrice ?? 0;
      const amount = Math.max(calculated, minimum);

      if (storyMod) adjustments.push({ label: `${stories}-story`, amount: 0 });
      if (hardWaterAddon) adjustments.push({ label: "Hard water", amount: hardWaterAddon });
      if (frenchPanesAddon) adjustments.push({ label: "French panes", amount: frenchPanesAddon });
      if (solarScreensAddon) adjustments.push({ label: "Solar screens", amount: solarScreensAddon });
      if (ladderWorkAddon) adjustments.push({ label: "Ladder work", amount: ladderWorkAddon });
      if (sunroomAddon) adjustments.push({ label: "Sunroom", amount: sunroomAddon });

      lineItems.push({
        key: "window_cleaning",
        label:
          home.windowCleaningType === "both"
            ? "Window Cleaning (Interior & Exterior)"
            : "Window Cleaning (Exterior)",
        quantity: sqft,
        unit: "sqft",
        baseAmount: adjustedWindowBase,
        adjustments,
        minimumApplied: amount > calculated,
        amount,
        jobberLineItem: { name: "Window Cleaning", unitPrice: amount },
        components: {
          exteriorWindows,
          interiorWindows,
          hardWaterAddon,
          frenchPanesAddon,
          solarScreensAddon,
          ladderWorkAddon,
          sunroomAddon,
          windowCleaningTotal: amount,
        },
      });
      trace.push(
        `window: ext=${exteriorWindows} int=${interiorWindows} storyMod=${storyMod}% condMod=${conditionMod}% -> ${amount} (min ${minimum})`,
      );
    }
  }

  // =========================================================================
  // INTERIOR WINDOWS (standalone) — plan-builder rule promoted unchanged.
  // sqft × interiorPerSqFt with story+condition modifiers and a 0.6× minimum.
  // =========================================================================
  if (svc.interiorWindows) {
    const cfg = pricing.window_cleaning;
    if (!cfg) {
      manualReviewReasons.push("window_cleaning pricing not configured");
    } else {
      const mods = cfg.modifiers;
      const base = sqft * cfg.interiorPerSqFt;
      const storyMod = mods.stories[stories.toString()] ?? 0;
      const conditionMod = mods.condition?.[home.condition ?? ""] ?? 0;
      const calculated = applyModifiers(base, [storyMod, conditionMod]);
      const minimum = roundDollars((cfg.minimumPrice ?? 0) * 0.6);
      const amount = Math.max(calculated, minimum);
      lineItems.push({
        key: "interior_windows",
        label: "Interior Window Cleaning",
        quantity: sqft,
        unit: "sqft",
        baseAmount: amount,
        adjustments: [],
        minimumApplied: amount > calculated,
        amount,
        jobberLineItem: { name: "Interior Window Cleaning", unitPrice: amount },
      });
      trace.push(`interior_windows: base=${roundDollars(base)} storyMod=${storyMod}% condMod=${conditionMod}% -> ${amount} (min ${minimum})`);
    }
  }

  // =========================================================================
  // HOUSE WASH
  // =========================================================================
  if (svc.houseWash) {
    const cfg = pricing.house_wash;
    if (!cfg) {
      manualReviewReasons.push("house_wash pricing not configured");
    } else {
      const base = sqft * cfg.perSqFt;
      const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
      const calculated = applyModifiers(base, [storyMod]);
      const minimum = cfg.minimumPrice ?? 0;
      const houseWash = Math.max(calculated, minimum);

      let rustSurcharge = 0;
      if (svc.houseWashDetails?.stainType === "rust") {
        rustSurcharge = roundDollars(houseWash * ((cfg.rustStainSurcharge ?? 15) / 100));
      }
      const amount = houseWash + rustSurcharge;

      const adjustments: { label: string; amount: number }[] = [];
      if (rustSurcharge) adjustments.push({ label: "Rust/irrigation stain", amount: rustSurcharge });

      lineItems.push({
        key: "house_wash",
        label: "House Wash",
        quantity: sqft,
        unit: "sqft",
        baseAmount: houseWash,
        adjustments,
        minimumApplied: houseWash > calculated,
        amount,
        jobberLineItem: { name: "House Wash", unitPrice: amount },
        components: {
          houseWash,
          houseWashRustSurcharge: rustSurcharge,
          houseWashTotal: amount,
        },
      });
      trace.push(`house_wash: base=${roundDollars(base)} storyMod=${storyMod}% rust=${rustSurcharge} -> ${amount} (min ${minimum})`);
    }
  }

  // =========================================================================
  // GUTTER CLEANING (+ add-ons)
  // =========================================================================
  if (svc.gutterCleaning) {
    const cfg = pricing.gutter_cleaning;
    if (!cfg) {
      manualReviewReasons.push("gutter_cleaning pricing not configured");
    } else {
      const base = sqft * cfg.perSqFt;
      const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
      const calculated = applyModifiers(base, [storyMod]);
      const minimum = cfg.minimumPrice ?? 0;
      const gutterCleaning = Math.max(calculated, minimum);

      const addons = svc.gutterAddons;
      let drain = 0;
      let repairs = 0;
      let guards = 0;
      const adjustments: { label: string; amount: number }[] = [];

      if (addons?.undergroundDrains?.enabled) {
        const drainPricing = cfg.undergroundDrainPricing ?? {};
        drain = drainPricing[addons.undergroundDrains.count] ?? 0;
        if (drain) adjustments.push({ label: "Underground drains", amount: drain });
      }
      if (addons?.minorRepairs) {
        repairs = cfg.minorRepairsPrice ?? 0;
        if (repairs) adjustments.push({ label: "Minor repairs", amount: repairs });
      }
      if (addons?.gutterGuards?.enabled) {
        const linearFeet = addons.gutterGuards.linearFeet ?? 0;
        guards = linearFeet * (cfg.gutterGuardsPerLinearFoot ?? 0);
        if (guards) adjustments.push({ label: `Gutter guards (${linearFeet} lf)`, amount: guards });
      }

      const amount = gutterCleaning + drain + repairs + guards;
      lineItems.push({
        key: "gutter_cleaning",
        label: "Gutter Cleaning",
        quantity: sqft,
        unit: "sqft",
        baseAmount: gutterCleaning,
        adjustments,
        minimumApplied: gutterCleaning > calculated,
        amount,
        jobberLineItem: { name: "Gutter Cleaning", unitPrice: amount },
        components: {
          gutterCleaning,
          gutterDrainCleaning: drain,
          gutterMinorRepairs: repairs,
          gutterGuards: guards,
          gutterCleaningTotal: amount,
        },
      });
      trace.push(`gutter: base=${roundDollars(base)} storyMod=${storyMod}% addons=${drain + repairs + guards} -> ${amount} (min ${minimum})`);
    }
  }

  // =========================================================================
  // ROOF CLEANING
  // =========================================================================
  if (svc.roofCleaning) {
    const cfg = pricing.roof_cleaning;
    if (!cfg) {
      manualReviewReasons.push("roof_cleaning pricing not configured");
    } else {
      const base = sqft * cfg.perSqFt;
      const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
      const typeMod = cfg.modifiers.roofType?.[svc.roofType ?? ""] ?? 0;
      const severityMod = cfg.modifiers.severity?.[svc.roofSeverity ?? ""] ?? 0;
      const calculated = applyModifiers(base, [storyMod, typeMod, severityMod]);
      const minimum = cfg.minimumPrice ?? 0;
      const amount = Math.max(calculated, minimum);

      lineItems.push({
        key: "roof_cleaning",
        label: "Roof Cleaning",
        quantity: sqft,
        unit: "sqft",
        baseAmount: amount,
        adjustments: [],
        minimumApplied: amount > calculated,
        amount,
        jobberLineItem: { name: "Roof Cleaning", unitPrice: amount },
      });
      trace.push(`roof: base=${roundDollars(base)} story=${storyMod}% type=${typeMod}% sev=${severityMod}% -> ${amount} (min ${minimum})`);
    }
  }

  // =========================================================================
  // DRIVEWAY CLEANING
  // =========================================================================
  if (svc.drivewayCleaning?.enabled) {
    const cfg = pricing.driveway_cleaning;
    const { sqft: dSqft, surfaceType } = svc.drivewayCleaning;
    if (!cfg) {
      manualReviewReasons.push("driveway_cleaning pricing not configured");
    } else if (!isValidNumber(dSqft) || dSqft <= 0 || dSqft > MAX_SQFT) {
      manualReviewReasons.push("Invalid driveway square footage");
    } else {
      const base = dSqft * cfg.perSqFt;
      const mult = cfg.surfaceMultipliers[surfaceType] ?? 1;
      const calculated = roundDollars(base * mult);
      const minimum = cfg.minimumPrice ?? 0;
      const amount = Math.max(calculated, minimum);
      lineItems.push({
        key: "driveway_cleaning",
        label: "Driveway Cleaning",
        quantity: dSqft,
        unit: "sqft",
        baseAmount: amount,
        adjustments: [],
        minimumApplied: amount > calculated,
        amount,
        jobberLineItem: { name: "Driveway Cleaning", unitPrice: amount },
      });
      trace.push(`driveway: ${dSqft}sqft x${mult} -> ${amount} (min ${minimum})`);
    }
  }

  // =========================================================================
  // PRESSURE WASHING (flatwork areas)
  // =========================================================================
  if (svc.pressureWashing?.enabled) {
    const cfg = pricing.pressure_washing;
    if (!cfg) {
      manualReviewReasons.push("pressure_washing pricing not configured");
    } else {
      const pw = svc.pressureWashing;
      const mult = cfg.surfaceMultipliers[pw.surfaceType] ?? 1;
      const areas: [string, EngineAreaSelection][] = [
        ["Front porch", pw.frontPorch],
        ["Back patio", pw.backPatio],
        ["Pool deck", pw.poolDeck],
        ["Walkways", pw.walkways],
      ];
      const adjustments: { label: string; amount: number }[] = [];
      let sum = 0;
      let invalid = false;
      const areaKeyByLabel: Record<string, string> = {
        "Front porch": "frontPorch",
        "Back patio": "backPatio",
        "Pool deck": "poolDeck",
        "Walkways": "walkways",
      };
      const breakdown: Record<string, number> = {
        frontPorch: 0,
        backPatio: 0,
        poolDeck: 0,
        walkways: 0,
      };
      for (const [label, area] of areas) {
        if (area?.enabled) {
          if (!isValidNumber(area.sqft) || area.sqft < 0 || area.sqft > MAX_SQFT) {
            invalid = true;
            continue;
          }
          const areaPrice = roundDollars(area.sqft * cfg.perSqFt * mult);
          adjustments.push({ label, amount: areaPrice });
          breakdown[areaKeyByLabel[label]] = areaPrice;
          sum += areaPrice;
        }
      }
      if (invalid) {
        manualReviewReasons.push("Invalid pressure washing area square footage");
      } else if (sum > 0) {
        const minimum = cfg.minimumPrice ?? 0;
        const amount = Math.max(sum, minimum);
        lineItems.push({
          key: "pressure_washing",
          label: "Pressure Washing",
          quantity: 1,
          unit: "flat",
          baseAmount: sum,
          adjustments,
          minimumApplied: amount > sum,
          amount,
          jobberLineItem: { name: "Pressure Washing", unitPrice: amount },
          components: {
            frontPorch: breakdown.frontPorch,
            backPatio: breakdown.backPatio,
            poolDeck: breakdown.poolDeck,
            walkways: breakdown.walkways,
            pressureWashingTotal: amount,
          },
        });
        trace.push(`pressure: areas=${sum} x${mult} -> ${amount} (min ${minimum})`);
      }
    }
  }

  // =========================================================================
  // TOTALS + DISCOUNT
  // =========================================================================
  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);

  let discount: QuoteResult["discount"] = null;
  let discountAmount = 0;
  if (input.discount && subtotal > 0) {
    const d = input.discount;
    if (d.type === "percentage" && isValidNumber(d.value) && d.value > 0) {
      discountAmount = roundCents(subtotal * (d.value / 100));
    } else if (d.type === "fixed" && isValidNumber(d.value) && d.value > 0) {
      discountAmount = Math.min(roundCents(d.value), subtotal);
    }
    if (discountAmount > 0) {
      discount = { code: d.code, type: d.type, value: d.value, amount: discountAmount };
    }
  }

  const total = roundCents(subtotal - discountAmount);

  return finalize(
    {
      status: manualReviewReasons.length > 0 ? "manual_review_required" : "firm",
      lineItems,
      subtotal,
      discount,
      total,
      trace,
      missing,
      manualReviewReasons,
    },
    ruleVersion,
  );
}

// ---------------------------------------------------------------------------
function finalize(
  partial: {
    status: QuoteStatus;
    lineItems: QuoteLineItem[];
    subtotal: number;
    discount: QuoteResult["discount"];
    total: number;
    trace: string[];
    missing: string[];
    manualReviewReasons: string[];
    promotion?: QuoteResult["promotion"];
  },
  ruleVersion: number | null,
): QuoteResult {
  const firm = partial.status === "firm";
  let explanation: string;
  if (partial.status === "missing_information") {
    explanation = `More information is needed before a price can be given: ${partial.missing.join(", ")}.`;
  } else if (partial.status === "manual_review_required") {
    explanation = `This quote requires manual review: ${partial.manualReviewReasons.join("; ")}.`;
  } else {
    const parts = partial.lineItems.map((li) => `${li.label}: $${li.amount}`);
    explanation =
      parts.join(", ") +
      (partial.discount ? `, discount -$${partial.discount.amount}` : "") +
      `. Total $${partial.total}.`;
  }

  return {
    engineVersion: PRICING_ENGINE_VERSION,
    ruleVersion,
    status: partial.status,
    firm,
    lineItems: partial.lineItems,
    subtotal: partial.subtotal,
    discount: partial.discount,
    total: partial.total,
    estimatedDurationMinutes: null,
    missing: partial.missing,
    manualReviewReasons: partial.manualReviewReasons,
    explanation,
    trace: partial.trace,
    jobberLineItems: partial.lineItems
      .map((li) => li.jobberLineItem)
      .filter((x): x is NonNullable<typeof x> => !!x),
    promotion: partial.promotion ?? null,
  };
}

// ---------------------------------------------------------------------------
// PROMOTION ENGINE — $99 exterior-window offer (administrator-controlled)
// ---------------------------------------------------------------------------
// A promotion is applied ONLY when explicitly requested. It never stacks with
// other discounts unless an administrator sets an explicit stacking policy, and
// it never silently covers more than the configured number of windows.
function calculatePromotion(
  req: PromotionRequest,
  pricing: PricingConfig,
  ruleVersion: number | null,
  trace: string[],
): QuoteResult {
  const promo = pricing.window_promo_99;

  // Reject unknown / unconfigured promotions — never invent a price.
  if (!promo || typeof promo !== "object") {
    return finalize(
      {
        status: "manual_review_required",
        lineItems: [],
        subtotal: 0,
        discount: null,
        total: 0,
        trace,
        missing: [],
        manualReviewReasons: ["Requested promotion is not available"],
      },
      ruleVersion,
    );
  }

  // The supplied identifier must match the configured, approved promotion id.
  if (promo.promoId !== req.id) {
    return finalize(
      {
        status: "manual_review_required",
        lineItems: [],
        subtotal: 0,
        discount: null,
        total: 0,
        trace,
        missing: [],
        manualReviewReasons: ["Requested promotion identifier is not recognized"],
      },
      ruleVersion,
    );
  }

  // Reject inactive / unpublished promotions.
  if (!promo.active) {
    return finalize(
      {
        status: "manual_review_required",
        lineItems: [],
        subtotal: 0,
        discount: null,
        total: 0,
        trace,
        missing: [],
        manualReviewReasons: ["This promotion is not currently active"],
      },
      ruleVersion,
    );
  }

  // Administrator-controlled effective-date gating (both bounds optional).
  const now = new Date();
  if (promo.effectiveStart) {
    const start = new Date(promo.effectiveStart);
    if (Number.isFinite(start.getTime()) && now < start) {
      return finalize(
        {
          status: "manual_review_required",
          lineItems: [],
          subtotal: 0,
          discount: null,
          total: 0,
          trace,
          missing: [],
          manualReviewReasons: ["This promotion has not started yet"],
        },
        ruleVersion,
      );
    }
  }
  if (promo.effectiveEnd) {
    const end = new Date(promo.effectiveEnd);
    if (Number.isFinite(end.getTime()) && now > end) {
      return finalize(
        {
          status: "manual_review_required",
          lineItems: [],
          subtotal: 0,
          discount: null,
          total: 0,
          trace,
          missing: [],
          manualReviewReasons: ["This promotion has ended"],
        },
        ruleVersion,
      );
    }
  }

  // Window count is required to validate the offer's window cap.
  const count = req.windowCount;
  if (!isValidNumber(count) || count <= 0) {
    return finalize(
      {
        status: "missing_information",
        lineItems: [],
        subtotal: 0,
        discount: null,
        total: 0,
        trace,
        missing: ["windowCount"],
        manualReviewReasons: [],
      },
      ruleVersion,
    );
  }

  const maxWindows = isValidNumber(promo.maxWindows) ? promo.maxWindows : 10;
  // More than the cap must NOT silently remain $99 — send to a standard quote.
  if (count > maxWindows) {
    return finalize(
      {
        status: "manual_review_required",
        lineItems: [],
        subtotal: 0,
        discount: null,
        total: 0,
        trace,
        missing: [],
        manualReviewReasons: [
          `The ${promo.promoId} promotion covers up to ${maxWindows} exterior windows; ${count} windows require a standard quote`,
        ],
      },
      ruleVersion,
    );
  }

  if (!isValidNumber(promo.flatPrice) || promo.flatPrice <= 0) {
    return finalize(
      {
        status: "manual_review_required",
        lineItems: [],
        subtotal: 0,
        discount: null,
        total: 0,
        trace,
        missing: [],
        manualReviewReasons: ["Promotion price is not configured"],
      },
      ruleVersion,
    );
  }

  const amount = roundCents(promo.flatPrice);
  const prep = promo.prepInstructions ?? "";
  const label =
    promo.serviceLabel ?? `Exterior Window Cleaning Promotion (up to ${maxWindows} windows)`;
  const jobberDescription = prep
    ? `${count} exterior windows. PREP REQUIRED: ${prep}`
    : `${count} exterior windows`;

  trace.push(`promo: ${promo.promoId} v${promo.version} count=${count}/${maxWindows} -> $${amount}`);

  return finalize(
    {
      status: "firm",
      lineItems: [
        {
          key: "window_promo_99",
          label,
          quantity: count,
          unit: "each",
          baseAmount: amount,
          adjustments: [],
          minimumApplied: false,
          amount,
          jobberLineItem: {
            name: label,
            description: jobberDescription,
            unitPrice: amount,
          },
        },
      ],
      subtotal: amount,
      // Stacking is disabled by default; the promotion is a flat, all-in price.
      discount: null,
      total: amount,
      trace,
      missing: [],
      manualReviewReasons: [],
      promotion: {
        id: promo.promoId,
        version: promo.version,
        flatPrice: amount,
        maxWindows,
        windowCount: count,
        prepInstructions: prep,
        terms: promo.terms,
      },
    },
    ruleVersion,
  );
}
// ===========================================================================
// PLAN OPTIONS ENGINE — recurring & bundle pricing (single source of truth)
// ===========================================================================
// The plan builder needs several priced scenarios at once (one-time, quarterly,
// semiannual, annual, bundles, add-ons). This computes each option from the SAME
// canonical `calculateQuote` per-service math, then applies recurring frequency
// and administrator-controlled bundle rules. There is NO second pricing engine
// and NO client-supplied price/discount — every dollar originates here.
//
// The 12-month installment structure (20% down, 11 monthly payments) reflects
// current production behavior; it is expressed as named constants below.
export const PLAN_DOWN_PAYMENT_PERCENT = 20;
export const PLAN_MONTHLY_INSTALLMENTS = 11;

export type PlanBillingCadence = "one_time" | "monthly" | "annual";

export interface PlanScenario {
  /** Stable option identifier chosen by the caller (echoed back). */
  id: string;
  label?: string;
  billingCadence?: PlanBillingCadence;
  /** The services selected for this option (same shape as a one-time quote). */
  additionalServices: EngineAdditionalServices;
  /** Visits/year keyed by canonical line-item key (window_cleaning, house_wash…). Default 1. */
  serviceFrequencies?: Record<string, number>;
  /** Optional bundle key referencing pricing.bundle_config for bundle discounts. */
  bundleKey?: string;
  discount?: EngineDiscount | null;
  promotion?: PromotionRequest | null;
}

export interface PlanOptionLineItem {
  key: string;
  label: string;
  perVisitAmount: number;
  frequency: number;
  annualAmount: number;
  jobberLineItem?: { name: string; description?: string; unitPrice: number };
}

export interface PlanOptionResult {
  optionId: string;
  status: QuoteStatus;
  engineVersion: string;
  ruleVersion: number | null;
  billingCadence: PlanBillingCadence | null;
  frequency: number | null;
  lineItems: PlanOptionLineItem[];
  frequencyAdjustment: number;
  bundleAdjustment: number;
  perVisitTotal: number | null;
  annualTotal: number | null;
  recurringAmount: number | null;
  downPayment: number | null;
  estimatedDurationMinutes: number | null;
  missing: string[];
  manualReviewReasons: string[];
  prepInstructions: string | null;
  promotion: QuoteResult["promotion"];
}

export interface PlanOptionsInput {
  homeDetails: EngineHomeDetails;
  scenarios: PlanScenario[];
}

export interface PlanOptionsResult {
  engineVersion: string;
  ruleVersion: number | null;
  options: PlanOptionResult[];
}

export function calculatePlanOptions(
  input: PlanOptionsInput,
  pricing: PricingConfig,
  ruleVersion: number | null = null,
): PlanOptionsResult {
  const scenarios = Array.isArray(input?.scenarios) ? input.scenarios : [];
  const options = scenarios.map((s) =>
    // Each option is computed independently: a manual-review or missing-info
    // option NEVER corrupts a sibling firm option.
    calculateSinglePlanOption(input.homeDetails, s, pricing, ruleVersion),
  );
  return { engineVersion: PRICING_ENGINE_VERSION, ruleVersion, options };
}

function calculateSinglePlanOption(
  home: EngineHomeDetails,
  scenario: PlanScenario,
  pricing: PricingConfig,
  ruleVersion: number | null,
): PlanOptionResult {
  const cadence: PlanBillingCadence = scenario.billingCadence ?? "monthly";
  const q = calculateQuote(
    {
      homeDetails: home,
      additionalServices: scenario.additionalServices,
      discount: scenario.discount ?? null,
      promotion: scenario.promotion ?? null,
    },
    pricing,
    ruleVersion,
  );

  if (q.status !== "firm") {
    return {
      optionId: scenario.id,
      status: q.status,
      engineVersion: PRICING_ENGINE_VERSION,
      ruleVersion,
      billingCadence: cadence,
      frequency: null,
      lineItems: [],
      frequencyAdjustment: 0,
      bundleAdjustment: 0,
      perVisitTotal: null,
      annualTotal: null,
      recurringAmount: null,
      downPayment: null,
      estimatedDurationMinutes: q.estimatedDurationMinutes,
      missing: q.missing,
      manualReviewReasons: q.manualReviewReasons,
      prepInstructions: null,
      promotion: q.promotion,
    };
  }

  // Promotion option: a flat, one-time, all-in price. Never multiplied by a
  // frequency and never bundle-discounted.
  if (q.promotion) {
    const lineItems: PlanOptionLineItem[] = q.lineItems.map((li) => ({
      key: li.key,
      label: li.label,
      perVisitAmount: li.amount,
      frequency: 1,
      annualAmount: li.amount,
      jobberLineItem: li.jobberLineItem,
    }));
    return {
      optionId: scenario.id,
      status: "firm",
      engineVersion: PRICING_ENGINE_VERSION,
      ruleVersion,
      billingCadence: "one_time",
      frequency: 1,
      lineItems,
      frequencyAdjustment: 0,
      bundleAdjustment: 0,
      perVisitTotal: q.total,
      annualTotal: q.total,
      recurringAmount: null,
      downPayment: null,
      estimatedDurationMinutes: q.estimatedDurationMinutes,
      missing: [],
      manualReviewReasons: [],
      prepInstructions: q.promotion.prepInstructions || null,
      promotion: q.promotion,
    };
  }

  const freqs = scenario.serviceFrequencies ?? {};
  const lineItems: PlanOptionLineItem[] = q.lineItems.map((li) => {
    const raw = freqs[li.key];
    const f = isValidNumber(raw) && raw > 0 ? Math.floor(raw) : 1;
    return {
      key: li.key,
      label: li.label,
      perVisitAmount: li.amount,
      frequency: f,
      annualAmount: li.amount * f,
      jobberLineItem: li.jobberLineItem,
    };
  });

  const perVisitTotal = lineItems.reduce((s, li) => s + li.perVisitAmount, 0);
  const annualSubtotal = lineItems.reduce((s, li) => s + li.annualAmount, 0);
  const frequency = lineItems.reduce((m, li) => Math.max(m, li.frequency), 0) || 1;

  // Bundle adjustment comes ONLY from the administrator-controlled bundle_config.
  let bundleAdjustment = 0;
  if (scenario.bundleKey && pricing.bundle_config?.[scenario.bundleKey]) {
    const b = pricing.bundle_config[scenario.bundleKey];
    const frac = isValidNumber(b.bundleDiscount) ? b.bundleDiscount : 0;
    if (frac > 0 && frac < 1) {
      bundleAdjustment = roundDollars(annualSubtotal * frac);
    }
  }

  const annualTotal = Math.max(0, annualSubtotal - bundleAdjustment);

  let recurringAmount: number | null = null;
  let downPayment: number | null = null;
  if (cadence === "monthly") {
    downPayment = roundDollars(annualTotal * (PLAN_DOWN_PAYMENT_PERCENT / 100));
    recurringAmount = roundDollars((annualTotal - downPayment) / PLAN_MONTHLY_INSTALLMENTS);
  } else if (cadence === "annual") {
    recurringAmount = annualTotal;
  }

  return {
    optionId: scenario.id,
    status: "firm",
    engineVersion: PRICING_ENGINE_VERSION,
    ruleVersion,
    billingCadence: cadence,
    frequency,
    lineItems,
    frequencyAdjustment: 0,
    bundleAdjustment,
    perVisitTotal,
    annualTotal,
    recurringAmount,
    downPayment,
    estimatedDurationMinutes: q.estimatedDurationMinutes,
    missing: [],
    manualReviewReasons: [],
    prepInstructions: null,
    promotion: null,
  };
}

// ===========================================================================
// GOOD / BETTER / BEST BUNDLE TIERS — canonical, server-authoritative pricing
// ===========================================================================
// Reproduces the EXACT good/better/best tier math that previously lived in the
// frontend `useServicePricing` hook. Every dollar originates here from the SAME
// per-service base math used by `calculateQuote`, plus administrator-controlled
// `bundle_config` (per-tier frequencies, included services, bundle & add-on
// discounts) and `bundle_rules` (tier ordering + minimum tier buffer). No price
// is hard-coded and no client-supplied discount is honored.

/**
 * Per-tier customization applied AFTER base tier pricing (mirrors the prior
 * frontend "Customize plan" flow exactly): a changed window cadence and/or
 * added/swapped services adjust the tier's annual total by a delta computed from
 * the canonical per-service base prices. The delta is NOT re-bundle-discounted —
 * this preserves the exact prior customer total.
 */
export interface BundleTierCustomization {
  windowFrequency?: { exteriorFrequency: number; interiorFrequency: number };
  serviceSwaps?: { from: string; to: string }[];
  addedServices?: string[];
}

export interface BundleTiersInput {
  homeDetails: EngineHomeDetails;
  additionalServices: EngineAdditionalServices;
  /** Optional per-tier customization keyed by tier (good|better|best). */
  customizations?: Record<string, BundleTierCustomization>;
}

export interface BundleTierServiceBases {
  exteriorWindows: number;
  interiorWindows: number;
  gutterCleaning: number;
  houseWash: number;
  roofCleaning: number;
  drivewayCleaning: number;
  pressureWashing: number;
}

export interface BundleTierOption {
  tier: string;
  name: string;
  label: string;
  description: string;
  features: string[];
  windowFrequency: number;
  windowFrequencyConfig: { exteriorFrequency: number; interiorFrequency: number };
  additionalServicesIncluded: string[];
  baseServices: string[];
  availableAddons: string[];
  annualTotal: number;
  monthlyPayment: number;
  downPayment: number;
  recurringMonthly: number;
  savings: number;
  savingsPercent: number;
  addonDiscountPercent: number;
  addonSavings: number;
  windowCost: number;
  additionalServicesCost: number;
  addonsCost: number;
  bundleDiscount: number;
  /** Amount added to this tier by the minimum-tier-buffer guardrail (admin-visible). */
  tierBufferAdjustment: number;
  isPopular: boolean;
  isCustomized: boolean;
  trace: string[];
}

export interface BundleTiersResult {
  engineVersion: string;
  ruleVersion: number | null;
  status: QuoteStatus;
  minimumTierBuffer: number;
  tierOrder: string[];
  serviceBases: BundleTierServiceBases;
  tiers: BundleTierOption[];
  missing: string[];
  manualReviewReasons: string[];
}

function computeBundleServiceBases(
  home: EngineHomeDetails,
  svc: EngineAdditionalServices,
  pricing: PricingConfig,
): BundleTierServiceBases {
  const sqft = home.squareFootage;
  const stories = home.stories;

  let exteriorWindows = 0;
  let interiorWindows = 0;
  if (svc.windowCleaning && pricing.window_cleaning) {
    const cfg = pricing.window_cleaning;
    const baseExterior = sqft * cfg.exteriorPerSqFt;
    const baseInterior =
      home.windowCleaningType === "both" ? sqft * cfg.interiorPerSqFt : 0;
    const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
    const conditionMod = cfg.modifiers.condition?.[home.condition ?? ""] ?? 0;
    exteriorWindows = roundDollars(
      baseExterior * (1 + storyMod / 100 + conditionMod / 100),
    );
    interiorWindows = roundDollars(baseInterior * (1 + conditionMod / 100));
  }

  let gutterCleaning = 0;
  if (svc.gutterCleaning && pricing.gutter_cleaning) {
    const cfg = pricing.gutter_cleaning;
    const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
    gutterCleaning = Math.max(
      applyModifiers(sqft * cfg.perSqFt, [storyMod]),
      cfg.minimumPrice ?? 0,
    );
  }

  let houseWash = 0;
  if (svc.houseWash && pricing.house_wash) {
    const cfg = pricing.house_wash;
    const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
    houseWash = Math.max(
      applyModifiers(sqft * cfg.perSqFt, [storyMod]),
      cfg.minimumPrice ?? 0,
    );
  }

  let roofCleaning = 0;
  if (svc.roofCleaning && pricing.roof_cleaning) {
    const cfg = pricing.roof_cleaning;
    const storyMod = cfg.modifiers.stories[stories.toString()] ?? 0;
    const typeMod = cfg.modifiers.roofType?.[svc.roofType ?? ""] ?? 0;
    const severityMod = cfg.modifiers.severity?.[svc.roofSeverity ?? ""] ?? 0;
    roofCleaning = Math.max(
      applyModifiers(sqft * cfg.perSqFt, [storyMod, typeMod, severityMod]),
      cfg.minimumPrice ?? 0,
    );
  }

  let drivewayCleaning = 0;
  if (svc.drivewayCleaning?.enabled && pricing.driveway_cleaning) {
    const cfg = pricing.driveway_cleaning;
    const { sqft: dSqft, surfaceType } = svc.drivewayCleaning;
    const mult = cfg.surfaceMultipliers[surfaceType] ?? 1;
    drivewayCleaning = Math.max(
      roundDollars(dSqft * cfg.perSqFt * mult),
      cfg.minimumPrice ?? 0,
    );
  }

  let pressureWashing = 0;
  if (svc.pressureWashing?.enabled && pricing.pressure_washing) {
    const cfg = pricing.pressure_washing;
    const pw = svc.pressureWashing;
    const mult = cfg.surfaceMultipliers[pw.surfaceType] ?? 1;
    let sum = 0;
    for (const area of [pw.frontPorch, pw.backPatio, pw.poolDeck, pw.walkways]) {
      if (area?.enabled) sum += roundDollars(area.sqft * cfg.perSqFt * mult);
    }
    if (sum > 0) pressureWashing = Math.max(sum, cfg.minimumPrice ?? 0);
  }

  return {
    exteriorWindows,
    interiorWindows,
    gutterCleaning,
    houseWash,
    roofCleaning,
    drivewayCleaning,
    pressureWashing,
  };
}

export function computeBundleTiers(
  input: BundleTiersInput,
  pricing: PricingConfig,
  ruleVersion: number | null = null,
): BundleTiersResult {
  const home = input.homeDetails ?? ({} as EngineHomeDetails);
  const svc = input.additionalServices ?? ({} as EngineAdditionalServices);

  const rules = pricing.bundle_rules ?? {};
  const minimumTierBuffer = isValidNumber(rules.minimumTierBuffer)
    ? rules.minimumTierBuffer
    : 25;
  const tierOrder =
    Array.isArray(rules.tierOrder) && rules.tierOrder.length
      ? rules.tierOrder
      : ["good", "better", "best"];
  const downPct = isValidNumber(rules.planDownPaymentPercent)
    ? rules.planDownPaymentPercent
    : PLAN_DOWN_PAYMENT_PERCENT;
  const installments =
    isValidNumber(rules.planMonthlyInstallments) &&
    rules.planMonthlyInstallments > 0
      ? rules.planMonthlyInstallments
      : PLAN_MONTHLY_INSTALLMENTS;
  const roofBaseTiers = Array.isArray(rules.roofBaseIncludedTiers)
    ? rules.roofBaseIncludedTiers
    : ["best"];

  const empty: BundleTierServiceBases = {
    exteriorWindows: 0,
    interiorWindows: 0,
    gutterCleaning: 0,
    houseWash: 0,
    roofCleaning: 0,
    drivewayCleaning: 0,
    pressureWashing: 0,
  };

  // Validate the same inputs the one-time engine requires for sqft-based
  // services. Missing/invalid inputs yield NO tier prices (never a fallback).
  const missing: string[] = [];
  const manualReviewReasons: string[] = [];
  const anyServiceSelected =
    !!svc.windowCleaning ||
    !!svc.houseWash ||
    !!svc.gutterCleaning ||
    !!svc.roofCleaning ||
    !!svc.drivewayCleaning?.enabled ||
    !!svc.pressureWashing?.enabled;
  if (!anyServiceSelected) missing.push("services");
  const needsSqft =
    !!svc.windowCleaning ||
    !!svc.houseWash ||
    !!svc.gutterCleaning ||
    !!svc.roofCleaning;
  if (needsSqft) {
    if (!isValidNumber(home.squareFootage) || home.squareFootage <= 0) {
      missing.push("squareFootage");
    } else if (home.squareFootage > MAX_SQFT) {
      manualReviewReasons.push(
        `Square footage ${home.squareFootage} exceeds automated range; manual review required`,
      );
    }
    if (!VALID_STORIES.includes(home.stories)) missing.push("stories");
  }
  if (!pricing.bundle_config) {
    manualReviewReasons.push("bundle_config not configured");
  }

  if (missing.length > 0 || manualReviewReasons.length > 0) {
    return {
      engineVersion: PRICING_ENGINE_VERSION,
      ruleVersion,
      status: missing.length > 0 ? "missing_information" : "manual_review_required",
      minimumTierBuffer,
      tierOrder,
      serviceBases: empty,
      tiers: [],
      missing,
      manualReviewReasons,
    };
  }

  const bases = computeBundleServiceBases(home, svc, pricing);
  const BUNDLE_CONFIG = pricing.bundle_config as Record<string, BundleConfigEntry>;
  const customizations = input.customizations ?? {};

  interface RawTier {
    tier: string;
    config: BundleConfigEntry;
    annualTotal: number;
    monthlyPayment: number;
    savings: number;
    savingsPercent: number;
    addonSavings: number;
    includedServices: string[];
    baseServices: string[];
    availableAddons: string[];
    totalWindowFrequency: number;
    exteriorFreq: number;
    interiorFreq: number;
    windowCost: number;
    baseServicesCost: number;
    addonsCost: number;
    bundleDiscount: number;
    tierBufferAdjustment: number;
  }

  const rawTiers: RawTier[] = [];
  for (const tier of tierOrder) {
    const config = BUNDLE_CONFIG[tier];
    if (!config) continue;

    const exteriorFreq = config.exteriorWindowFrequency ?? 0;
    const interiorFreq = config.interiorWindowFrequency ?? 0;
    const addFreq = config.additionalServicesFrequency ?? 1;
    const addonDiscount = config.addonDiscount ?? 0;
    const bundleDiscountFrac = config.bundleDiscount ?? 0;
    const included = config.includedServices ?? [];

    const exteriorCost = bases.exteriorWindows * exteriorFreq;
    const interiorCost = bases.interiorWindows * interiorFreq;
    const windowCost = exteriorCost + interiorCost;
    const totalWindowFrequency =
      exteriorFreq + (interiorFreq > 0 ? interiorFreq : 0);

    let baseServicesCost = 0;
    const includedServices: string[] = [];
    const baseServices: string[] = [];

    if (included.includes("gutter_cleaning") && svc.gutterCleaning) {
      baseServicesCost += bases.gutterCleaning * addFreq;
      includedServices.push(`Gutter Cleaning (${addFreq}x/year)`);
      baseServices.push("gutter_cleaning");
    }
    if (included.includes("house_wash") && svc.houseWash) {
      baseServicesCost += bases.houseWash;
      includedServices.push("House Wash");
      baseServices.push("house_wash");
    }
    if (roofBaseTiers.includes(tier) && svc.roofCleaning) {
      baseServicesCost += bases.roofCleaning;
      includedServices.push("Roof Cleaning");
      baseServices.push("roof_cleaning");
    }

    let addonsCost = 0;
    const addonsList: string[] = [];

    if (svc.drivewayCleaning?.enabled) {
      addonsCost += bases.drivewayCleaning * (1 - addonDiscount);
      addonsList.push("Driveway Cleaning");
    }
    if (svc.pressureWashing?.enabled) {
      addonsCost += bases.pressureWashing * (1 - addonDiscount);
      addonsList.push("Pressure Washing");
    }
    if (!included.includes("gutter_cleaning") && svc.gutterCleaning) {
      addonsCost += bases.gutterCleaning * addFreq * (1 - addonDiscount);
      addonsList.push(`Gutter Cleaning (${addFreq}x/year)`);
    }
    if (!included.includes("house_wash") && svc.houseWash) {
      addonsCost += bases.houseWash * (1 - addonDiscount);
      addonsList.push("House Wash");
    }
    if (!roofBaseTiers.includes(tier) && svc.roofCleaning) {
      addonsCost += bases.roofCleaning * (1 - addonDiscount);
      addonsList.push("Roof Cleaning");
    }

    const subtotal = windowCost + baseServicesCost + addonsCost;
    const bundleDiscountAmt = subtotal * bundleDiscountFrac;
    const annualTotal = Math.round(subtotal - bundleDiscountAmt);
    const monthlyPayment = Math.round(annualTotal / 12);

    const fullPriceAddons =
      (svc.drivewayCleaning?.enabled ? bases.drivewayCleaning : 0) +
      (svc.pressureWashing?.enabled ? bases.pressureWashing : 0) +
      (!included.includes("gutter_cleaning") && svc.gutterCleaning
        ? bases.gutterCleaning * addFreq
        : 0) +
      (!included.includes("house_wash") && svc.houseWash ? bases.houseWash : 0) +
      (!roofBaseTiers.includes(tier) && svc.roofCleaning
        ? bases.roofCleaning
        : 0);
    const addonSavings = Math.round(fullPriceAddons - addonsCost);

    const individualTotal = windowCost + baseServicesCost + fullPriceAddons;
    const savings = Math.round(individualTotal - annualTotal);
    const savingsPercent =
      individualTotal > 0 ? Math.round((savings / individualTotal) * 100) : 0;

    const availableAddons = [
      "driveway_cleaning",
      "pressure_washing",
      ...(!included.includes("gutter_cleaning") ? ["gutter_cleaning"] : []),
      ...(!included.includes("house_wash") ? ["house_wash"] : []),
      ...(!roofBaseTiers.includes(tier) ? ["roof_cleaning"] : []),
    ];

    rawTiers.push({
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
      totalWindowFrequency,
      exteriorFreq,
      interiorFreq,
      windowCost: Math.round(windowCost),
      baseServicesCost: Math.round(baseServicesCost),
      addonsCost: Math.round(addonsCost),
      bundleDiscount: Math.round(bundleDiscountAmt),
      tierBufferAdjustment: 0,
    });
  }

  // Tier guardrail: ensure each tier is strictly greater than the one below it.
  // Mirrors the legacy `<=` comparison and the sequential adjustment exactly.
  for (let i = 1; i < rawTiers.length; i++) {
    const prev = rawTiers[i - 1];
    const cur = rawTiers[i];
    if (cur.annualTotal <= prev.annualTotal) {
      const before = cur.annualTotal;
      cur.annualTotal = prev.annualTotal + minimumTierBuffer;
      cur.monthlyPayment = Math.round(cur.annualTotal / 12);
      cur.tierBufferAdjustment = cur.annualTotal - before;
    }
  }

  const tiers: BundleTierOption[] = rawTiers.map((t) => {
    const config = t.config;
    const bundleDiscountFrac = config.bundleDiscount ?? 0;
    const addonDiscount = config.addonDiscount ?? 0;

    const features: string[] = [];
    if (t.interiorFreq > 0) {
      features.push(`Exterior windows ${t.exteriorFreq}x/year`);
      features.push(`Interior windows ${t.interiorFreq}x/year`);
    } else {
      features.push(`Exterior window cleaning ${t.exteriorFreq}x/year`);
    }
    if (t.tier === "better" || t.tier === "best") {
      features.push("Priority scheduling");
    }
    if (t.tier === "best") {
      features.push("Free touch-ups between visits");
    }
    if (bundleDiscountFrac > 0) {
      features.push(`${Math.round(bundleDiscountFrac * 100)}% bundle discount`);
    }
    if (addonDiscount > 0) {
      features.push(`${Math.round(addonDiscount * 100)}% off additional services`);
    }

    // Apply optional per-tier customization (exact legacy delta math).
    let annualTotal = t.annualTotal;
    let monthlyPayment = t.monthlyPayment;
    let isCustomized = false;
    let windowFrequencyConfig = {
      exteriorFrequency: t.exteriorFreq,
      interiorFrequency: t.interiorFreq,
    };
    const custom = customizations[t.tier];
    if (custom) {
      const freqConfig = custom.windowFrequency ?? windowFrequencyConfig;
      const originalFreqCost =
        bases.exteriorWindows * t.exteriorFreq +
        bases.interiorWindows * t.interiorFreq;
      const newFreqCost =
        bases.exteriorWindows * freqConfig.exteriorFrequency +
        bases.interiorWindows * freqConfig.interiorFrequency;
      const freqDiff = newFreqCost - originalFreqCost;

      const getServicePrice = (svcKey: string): number =>
        svcKey === "gutter_cleaning"
          ? bases.gutterCleaning
          : svcKey === "house_wash"
            ? bases.houseWash
            : svcKey === "roof_cleaning"
              ? bases.roofCleaning
              : 0;

      let serviceDiff = 0;
      const swaps = custom.serviceSwaps ?? [];
      for (const swap of swaps) {
        serviceDiff += getServicePrice(swap.to) - getServicePrice(swap.from);
      }
      for (const added of custom.addedServices ?? []) {
        if (!swaps.some((sw) => sw.to === added)) {
          serviceDiff += getServicePrice(added);
        }
      }

      annualTotal = Math.round(t.annualTotal + freqDiff + serviceDiff);
      monthlyPayment = Math.round(annualTotal / 12);
      windowFrequencyConfig = freqConfig;
      isCustomized = true;
    }

    const downPayment = roundDollars(annualTotal * (downPct / 100));
    const recurringMonthly = roundDollars(
      (annualTotal - downPayment) / installments,
    );

    const trace: string[] = [
      `tier=${t.tier} windowCost=${t.windowCost} baseServices=${t.baseServicesCost} addons=${t.addonsCost} bundleDiscount=${t.bundleDiscount} annualTotal=${annualTotal}${t.tierBufferAdjustment ? ` (buffer +${t.tierBufferAdjustment})` : ""}${isCustomized ? " (customized)" : ""}`,
    ];

    return {
      tier: t.tier,
      name: config.name ?? t.tier.charAt(0).toUpperCase() + t.tier.slice(1),
      label: config.label ?? "",
      description: config.description ?? "",
      features,
      windowFrequency: t.totalWindowFrequency,
      windowFrequencyConfig,
      additionalServicesIncluded: t.includedServices,
      baseServices: t.baseServices,
      availableAddons: t.availableAddons,
      annualTotal,
      monthlyPayment,
      downPayment,
      recurringMonthly,
      savings: t.savings,
      savingsPercent: t.savingsPercent,
      addonDiscountPercent: Math.round(addonDiscount * 100),
      addonSavings: t.addonSavings,
      windowCost: t.windowCost,
      additionalServicesCost: t.baseServicesCost,
      addonsCost: t.addonsCost,
      bundleDiscount: t.bundleDiscount,
      tierBufferAdjustment: t.tierBufferAdjustment,
      isPopular: t.tier === "better",
      isCustomized,
      trace,
    };
  });

  return {
    engineVersion: PRICING_ENGINE_VERSION,
    ruleVersion,
    status: "firm",
    minimumTierBuffer,
    tierOrder,
    serviceBases: bases,
    tiers,
    missing: [],
    manualReviewReasons: [],
  };
}

// ===========================================================================
// RECURRING PLAN BOOKING — server-authoritative selection & Jobber line items
// ===========================================================================
// These helpers turn a recalculated Good/Better/Best tier (from
// `computeBundleTiers`) into (a) a validated canonical selection and (b) Jobber
// line items whose sum reconciles EXACTLY to the tier's annual total. They are
// the single source of truth shared by the client display and the
// `jobber-create-service-request` Edge Function — no pricing math is duplicated
// or trusted from the browser.

export interface PlanJobberLineItem {
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Build Jobber quote line items from a recalculated tier. Interior windows are
 * ALWAYS a separate line item. Every bundle discount, add-on discount,
 * tier-buffer adjustment, customization delta and rounding difference is folded
 * into a single reconciling "plan services & savings" line so the line-item sum
 * equals `tier.annualTotal` to the dollar.
 */
export function buildPlanJobberLineItems(
  tier: BundleTierOption,
  serviceBases: BundleTierServiceBases,
): PlanJobberLineItem[] {
  const cfg = tier.windowFrequencyConfig;
  const items: PlanJobberLineItem[] = [];

  const extAnnual = Math.round(serviceBases.exteriorWindows * cfg.exteriorFrequency);
  if (extAnnual > 0) {
    items.push({
      name: "Exterior Window Cleaning",
      description: `${cfg.exteriorFrequency}x per year — annual total`,
      quantity: 1,
      unitPrice: extAnnual,
    });
  }

  // Interior windows are ALWAYS represented as their own line item.
  const intAnnual = Math.round(serviceBases.interiorWindows * cfg.interiorFrequency);
  if (intAnnual > 0) {
    items.push({
      name: "Interior Window Cleaning",
      description: `${cfg.interiorFrequency}x per year — annual total (billed separately)`,
      quantity: 1,
      unitPrice: intAnnual,
    });
  }

  // Fold everything else (included services, add-ons, all discounts, tier
  // buffer, customization deltas, rounding) into ONE reconciling line so the
  // Jobber line-item sum equals the canonical annual total exactly.
  const remainder = tier.annualTotal - extAnnual - intAnnual;
  const serviceList = tier.additionalServicesIncluded.length
    ? tier.additionalServicesIncluded.join(", ")
    : "Plan membership";
  const savingsBits: string[] = [];
  if (tier.bundleDiscount > 0) savingsBits.push(`bundle discount -$${tier.bundleDiscount}`);
  if (tier.addonSavings > 0) savingsBits.push(`add-on discount -$${tier.addonSavings}`);
  if (tier.tierBufferAdjustment > 0) savingsBits.push(`tier adjustment +$${tier.tierBufferAdjustment}`);
  const descParts = [`${tier.name} plan includes: ${serviceList}`];
  if (savingsBits.length) descParts.push(savingsBits.join("; "));
  if (remainder !== 0 || items.length === 0) {
    items.push({
      name: `${tier.name} Plan Services & Savings`,
      description: descParts.join(" · "),
      quantity: 1,
      unitPrice: remainder,
    });
  }
  return items;
}

export function planJobberLineItemsTotal(items: PlanJobberLineItem[]): number {
  return items.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);
}

export type PlanSelectionOutcome =
  | { ok: false; reason: "missing_information"; missing: string[] }
  | { ok: false; reason: "manual_review_required"; manualReviewReasons: string[] }
  | { ok: false; reason: "unknown_option"; detail: string }
  | {
      ok: false;
      reason: "pricing_changed";
      option: BundleTierOption;
      lineItems: PlanJobberLineItem[];
      engineVersion: string;
      ruleVersion: number | null;
    }
  | {
      ok: true;
      option: BundleTierOption;
      lineItems: PlanJobberLineItem[];
      engineVersion: string;
      ruleVersion: number | null;
    };

export interface PlanSelectionRequest {
  tier: string;
  expectedEngineVersion?: string | null;
  expectedRuleVersion?: number | null;
  expectedAnnualTotal?: number | null;
  confirmPricingChange?: boolean;
  /** Dollar tolerance for total drift; harmless rounding never triggers a mismatch. */
  totalTolerance?: number;
}

/**
 * Validate a recalculated tiers result against the customer's submitted
 * selection. Rejects missing-information, manual-review and unknown options, and
 * flags `pricing_changed` when the engine/rule version or total no longer
 * matches what the customer saw (unless they explicitly reconfirmed). Browser
 * totals are used ONLY for mismatch detection and are never authoritative.
 */
export function evaluatePlanSelection(
  result: BundleTiersResult,
  req: PlanSelectionRequest,
): PlanSelectionOutcome {
  if (result.status === "missing_information") {
    return { ok: false, reason: "missing_information", missing: result.missing ?? [] };
  }
  if (result.status === "manual_review_required") {
    return {
      ok: false,
      reason: "manual_review_required",
      manualReviewReasons: result.manualReviewReasons ?? [],
    };
  }

  const option = result.tiers.find((t) => t.tier === req.tier);
  if (!option) {
    return { ok: false, reason: "unknown_option", detail: `Unknown plan option: ${req.tier}` };
  }

  const lineItems = buildPlanJobberLineItems(option, result.serviceBases);
  const engineVersion = result.engineVersion;
  const ruleVersion = result.ruleVersion;

  const tol = isValidNumber(req.totalTolerance) ? (req.totalTolerance as number) : 1;
  const versionChanged =
    (req.expectedEngineVersion != null && req.expectedEngineVersion !== engineVersion) ||
    (req.expectedRuleVersion != null && req.expectedRuleVersion !== ruleVersion);
  const totalChanged =
    req.expectedAnnualTotal != null &&
    Math.abs((req.expectedAnnualTotal as number) - option.annualTotal) > tol;

  if ((versionChanged || totalChanged) && !req.confirmPricingChange) {
    return { ok: false, reason: "pricing_changed", option, lineItems, engineVersion, ruleVersion };
  }

  return { ok: true, option, lineItems, engineVersion, ruleVersion };
}
