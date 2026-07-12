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
}

export interface EngineDiscount {
  type: "percentage" | "fixed";
  value: number;
  code?: string;
}

export interface QuoteInput {
  homeDetails: EngineHomeDetails;
  additionalServices: EngineAdditionalServices;
  discount?: EngineDiscount | null;
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

  const anyServiceSelected =
    !!svc.windowCleaning ||
    !!svc.houseWash ||
    !!svc.gutterCleaning ||
    !!svc.roofCleaning ||
    !!svc.drivewayCleaning?.enabled ||
    !!svc.pressureWashing?.enabled;

  if (!anyServiceSelected) {
    missing.push("services");
  }

  // Square footage is required for every sqft-based service (all of them).
  const squareFootage = home.squareFootage;
  const needsSqft =
    !!svc.windowCleaning ||
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
      });
      trace.push(
        `window: ext=${exteriorWindows} int=${interiorWindows} storyMod=${storyMod}% condMod=${conditionMod}% -> ${amount} (min ${minimum})`,
      );
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
      for (const [label, area] of areas) {
        if (area?.enabled) {
          if (!isValidNumber(area.sqft) || area.sqft < 0 || area.sqft > MAX_SQFT) {
            invalid = true;
            continue;
          }
          const areaPrice = roundDollars(area.sqft * cfg.perSqFt * mult);
          adjustments.push({ label, amount: areaPrice });
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
  };
}