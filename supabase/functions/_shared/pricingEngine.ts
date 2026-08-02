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

export const PRICING_ENGINE_VERSION = "1.2.0";

/** Stable machine identifiers shared by quote snapshots and every channel. */
export const QUOTE_RULE_IDS = Object.freeze({
  screenedEnclosureSoftWash: "screened_enclosure_soft_wash",
  enclosureWindowCleaning: "enclosure_window_cleaning",
  noScreenDiscount: "window_no_screen_discount",
  solarScreenService: "window_solar_screen_service",
  undergroundDrainClearing: "underground_gutter_drain_clearing",
  minorGutterRepairs: "minor_gutter_downspout_repairs",
  houseWashFrontPatio: "house_wash_front_patio",
  houseWashBackPatio: "house_wash_back_patio",
  houseWashWindowBundle: "house_wash_window_cleaning_bundle",
  addedInteriorWindowSides: "window_added_interior_sides",
  omittedWindowSides: "window_omitted_sides",
  hardWaterRemoval: "window_hard_water_removal",
  frenchPaneAdjustment: "window_french_pane_adjustment",
  unusualLadderAccess: "window_unusual_ladder_access",
  promotionAdditionalWindows: "window_promo_additional_windows",
} as const);

/** Owner-confirmed Phase 0 rules. These are contract rules, not UI defaults. */
export const CONFIRMED_QUOTE_RULES = Object.freeze({
  screenedEnclosureFlatRate: 150,
  enclosureWindowExteriorEach: 10,
  enclosureWindowBothEach: 20,
  noScreenDiscountPercent: 5,
  solarScreenExteriorPercent: 50,
  solarScreenFullServicePercent: 25,
  undergroundDrainFirstTwoTotal: 100,
  undergroundDrainEachAfterTwo: 25,
  minorGutterRepairPercent: 30,
  houseWashPatioPercentEach: 10,
  houseWashPatioPerSqFt: 0.25,
  houseWashWindowBundleDiscount: 50,
  wholeHomeOutsidePerSqFt: 0.08,
  wholeHomeInsideAndOutsidePerSqFt: 0.15,
  addedInteriorWindowSideEach: 10,
  omittedWindowSideEach: 8,
  hardWaterAffectedWindowEach: 10,
  frenchPaneBasePercent: 50,
  unusualLadderAffectedWindowEach: 5,
  promotionAdditionalWindowEach: 10,
} as const);

export interface TaxPolicyConfig {
  version: string;
  rate: number;
  exemptLineItemKeys: string[];
  customerLabel?: string;
}

export interface DurationPolicyConfig {
  version: string;
  setupMinutes: number;
  roundingIncrementMinutes: number;
  hourlyRevenueTargets: {
    windowsAndScreens: number;
    gutterWork: number;
    exteriorCleaning: number;
  };
}

export const APPROVED_TAX_POLICY: Readonly<TaxPolicyConfig> = Object.freeze({
  version: "texas-estimated-sales-tax-2026-07-31",
  rate: 0.0825,
  exemptLineItemKeys: [
    "gutter_cleaning",
    "underground_gutter_drain_clearing",
    "minor_gutter_downspout_repairs",
  ],
  customerLabel: "Estimated tax",
});

export const APPROVED_DURATION_POLICY: Readonly<DurationPolicyConfig> = Object.freeze({
  version: "dfw-duration-productivity-2026-07-31",
  setupMinutes: 15,
  roundingIncrementMinutes: 15,
  hourlyRevenueTargets: {
    windowsAndScreens: 120,
    gutterWork: 150,
    exteriorCleaning: 175,
  },
});

export const QUOTE_CALCULATION_ORDER = Object.freeze([
  "base_service_prices",
  "count_or_measurement_addons",
  "service_specific_percentage_adjustments",
  "fixed_bundle_discounts",
  "other_authorized_promotions",
  "final_total",
] as const);

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
    /** Canonical whole-home combined rate. Legacy configs may omit it. */
    insideAndOutsidePerSqFt?: number;
    minimumPrice: number;
    omissionMinimumPrice?: number;
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
    /** @deprecated Phase 0 owner rules use an exact count formula. Read-only legacy config. */
    undergroundDrainPricing?: Record<string, number>;
    /** @deprecated Phase 0 owner rules use one 30% base-service adjustment. */
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
  /** Versioned policy sections; approved constants are the compatibility fallback. */
  tax_policy?: TaxPolicyConfig;
  duration_policy?: DurationPolicyConfig;
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
  /**
   * Optional per-service frequency overrides (per-year) for services listed in
   * `includedServices`. When a service key is present here it takes precedence
   * over `additionalServicesFrequency`. Supported keys:
   * "gutter_cleaning" | "house_wash" | "roof_cleaning" |
   * "driveway_cleaning" | "pressure_washing".
   */
  includedServiceFrequencies?: Record<string, number>;
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
  screenProfile?: "standard_removable" | "no_screens" | "solar" | "mixed_standard_solar" | "fixed_nonremovable_or_unknown";
  screenProfileProvenance?: "captured" | "verified" | "corrected" | "derived" | "defaulted" | "unanswered" | "unknown";
  solarScreenCoverage?: "all" | "some";
  solarScreenAffectedWindowCount?: number;
  solarScreenServiceRequested?: boolean;
  enclosedPatioProfile?: "none" | "screened" | "window_enclosed" | "mixed_or_uncertain";
  screenedEnclosureSoftWash?: boolean;
  enclosureWindowCount?: number;
  enclosureWindowSides?: "outside_only" | "inside_and_outside";
  advancedWindowConditions?: boolean;
  hardWaterAffectedWindowEquivalents?: number;
  ladderAffectedWindowEquivalents?: number;
  addedInteriorWindowSides?: number;
  omittedWindowSides?: number | "unknown";
}

export interface EngineAreaSelection {
  enabled: boolean;
  sqft: number;
  surfaceType?: string;
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
    undergroundDrains?: { enabled: boolean; count?: number | string };
    minorRepairs?: boolean;
    repairNeeds?: Array<
      | "leaking_seams"
      | "loose_gutter_sections"
      | "detached_gutter_sections"
      | "loose_downspouts"
      | "detached_downspouts"
      | "none"
      | "unsure"
      | "another_repair_need"
    >;
    repairNotes?: string;
    gutterGuards?: { enabled: boolean; linearFeet?: number };
  };
  houseWashPatios?: {
    pricingMethod?: "simple_selection" | "exact_square_footage";
    frontSelected?: boolean;
    backSelected?: boolean;
    frontSqft?: number;
    backSqft?: number;
  };
  roofCleaning?: boolean;
  roofType?: string;
  roofSeverity?: string;
  roofRiskFlags?: {
    knownDamage: boolean;
    extremePitch: boolean;
    fragileMaterial: boolean;
    unusualAccess: boolean;
  };
  drivewayCleaning?: { enabled: boolean; sqft: number; surfaceType: string };
  pressureWashing?: {
    enabled: boolean;
    surfaceType: string;
    frontPorch: EngineAreaSelection;
    backPatio: EngineAreaSelection;
    poolDeck: EngineAreaSelection;
    walkways: EngineAreaSelection;
  };
  solarPanelCleaning?: {
    enabled: boolean;
    panelCount: number;
    stories?: number;
    accessType?: "standard_residential" | "unusual_or_uncertain";
    knownDamage?: boolean;
    extremePitch?: boolean;
    fragileMaterial?: boolean;
    unusualAccess?: boolean;
  };
  screenRepair?: {
    enabled: boolean;
    screenCount: number;
    scopeType?: "standard_removable_reusable_frame" | "screen_door" | "new_frame" | "damaged_frame" | "solar_screen" | "specialty_or_oversized" | "unknown";
  };
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
  adjustments: { key?: string; label: string; amount: number }[];
  minimumApplied: boolean;
  amount: number;
  jobberLineItem?: { name: string; description?: string; unitPrice: number };
  customerExplanation?: string;
  /** Optional structured sub-components (e.g. window exterior/interior split). */
  components?: Record<string, number>;
}

export interface QuotePriceAdjustment {
  key: string;
  label: string;
  kind: "discount" | "surcharge";
  amount: number;
  appliesToLineItemKey?: string;
}

export interface QuoteDisclosure {
  key: string;
  text: string;
}

export interface QuoteResult {
  engineVersion: string;
  ruleVersion: number | null;
  status: QuoteStatus;
  firm: boolean;
  lineItems: QuoteLineItem[];
  subtotal: number;
  discount: { code?: string; type?: string; value?: number; amount: number } | null;
  /** Contract discounts/adjustments kept distinct from legacy discount codes. */
  priceAdjustments?: QuotePriceAdjustment[];
  disclosures?: QuoteDisclosure[];
  calculationOrder?: readonly string[];
  total: number;
  estimatedDurationMinutes: number | null;
  durationSource: "deterministic_duration_engine" | null;
  durationVersion: string | null;
  serviceSubtotal: number;
  discountsAndAdjustments: number;
  taxableSubtotal: number;
  estimatedTax: number;
  estimatedTotal: number;
  taxRate: number;
  taxPolicyVersion: string;
  taxLabel: string;
  bookableServiceKeys: string[];
  manualReviewServiceKeys: string[];
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
function exactNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "string" && /^[0-9]+$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Canonical window-equivalent quantity: positive, finite, and in 0.5 steps. */
export function isValidWindowEquivalentCount(value: unknown, allowZero = false): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0) && Number.isInteger(value * 2);
}

const APPROVED_FLATWORK_SURFACES = new Set([
  "concrete", "pavers", "exposed_aggregate", "stone", "asphalt",
  // Persisted compatibility values remain priceable.
  "stamped", "brick", "tile",
]);

function durationTargetForLineItem(key: string, policy: DurationPolicyConfig): number {
  if (key === "window_cleaning" || key === "interior_windows" || key === "window_promo_99" ||
    key === QUOTE_RULE_IDS.promotionAdditionalWindows || key === QUOTE_RULE_IDS.addedInteriorWindowSides ||
    key === "enclosure_window_cleaning" || key === "screen_repair") {
    return policy.hourlyRevenueTargets.windowsAndScreens;
  }
  if (key === "gutter_cleaning" || key === QUOTE_RULE_IDS.undergroundDrainClearing ||
    key === QUOTE_RULE_IDS.minorGutterRepairs || key === "gutter_guards") {
    return policy.hourlyRevenueTargets.gutterWork;
  }
  return policy.hourlyRevenueTargets.exteriorCleaning;
}

export function calculateDeterministicDuration(args: {
  lineItems: readonly QuoteLineItem[];
  manualReviewServiceKeys?: readonly string[];
  policy?: DurationPolicyConfig;
}): { minutes: number | null; version: string; bookableServiceKeys: string[] } {
  const policy = args.policy ?? APPROVED_DURATION_POLICY;
  const reviewed = new Set(args.manualReviewServiceKeys ?? []);
  const bookable = args.lineItems.filter((line) => !reviewed.has(line.key) && line.amount > 0);
  if (bookable.length === 0) return { minutes: null, version: policy.version, bookableServiceKeys: [] };
  const serviceMinutes = bookable.reduce((sum, line) => {
    // `baseAmount` and `amount` are both pre-discount/pre-tax. Use the larger so
    // a minimum or promotion never makes actual work appear faster.
    const workValue = Math.max(line.baseAmount, line.amount);
    return sum + (workValue / durationTargetForLineItem(line.key, policy)) * 60;
  }, 0);
  const increment = Math.max(1, policy.roundingIncrementMinutes);
  const minutes = Math.ceil((serviceMinutes + policy.setupMinutes) / increment) * increment;
  return { minutes: Math.max(increment, minutes), version: policy.version, bookableServiceKeys: bookable.map((line) => line.key) };
}

function calculateTaxSummary(args: {
  lineItems: readonly QuoteLineItem[];
  priceAdjustments: readonly QuotePriceAdjustment[];
  discountAmount: number;
  policy?: TaxPolicyConfig;
}) {
  const policy = args.policy ?? APPROVED_TAX_POLICY;
  const exempt = new Set(policy.exemptLineItemKeys);
  const subtotal = roundCents(args.lineItems.reduce((sum, line) => sum + line.amount, 0));
  const taxableBeforeDiscounts = roundCents(args.lineItems
    .filter((line) => !exempt.has(line.key))
    .reduce((sum, line) => sum + line.amount, 0));
  const contractDiscounts = args.priceAdjustments.filter((item) => item.kind === "discount");
  const taxableContractDiscount = roundCents(contractDiscounts.reduce((sum, item) => {
    if (item.appliesToLineItemKey) return sum + (exempt.has(item.appliesToLineItemKey) ? 0 : item.amount);
    // Unscoped bundle discounts in the current contract apply to taxable services.
    return sum + item.amount;
  }, 0));
  const contractDiscountTotal = roundCents(contractDiscounts.reduce((sum, item) => sum + item.amount, 0));
  const afterContract = Math.max(0, subtotal - contractDiscountTotal);
  const taxableAfterContract = Math.max(0, taxableBeforeDiscounts - taxableContractDiscount);
  const taxableShare = afterContract > 0 ? taxableAfterContract / afterContract : 0;
  const taxableGeneralDiscount = roundCents(args.discountAmount * taxableShare);
  const taxableSubtotal = roundCents(Math.max(0, taxableAfterContract - taxableGeneralDiscount));
  const estimatedTax = roundCents(taxableSubtotal * policy.rate);
  const preTaxTotal = roundCents(Math.max(0, afterContract - args.discountAmount));
  return {
    serviceSubtotal: subtotal,
    discountsAndAdjustments: roundCents(-(contractDiscountTotal + args.discountAmount)),
    taxableSubtotal,
    estimatedTax,
    estimatedTotal: roundCents(preTaxTotal + estimatedTax),
    taxRate: policy.rate,
    taxPolicyVersion: policy.version,
    taxLabel: policy.customerLabel ?? "Estimated tax",
  };
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
  const addonMissing: string[] = [];
  const manualReviewReasons: string[] = [];
  const manualReviewServiceKeys = new Set<string>();
  const lineItems: QuoteLineItem[] = [];
  const priceAdjustments: QuotePriceAdjustment[] = [];
  const disclosures: QuoteDisclosure[] = [];
  const markServiceReview = (serviceKey: string, reason: string) => {
    manualReviewServiceKeys.add(serviceKey);
    manualReviewReasons.push(reason);
  };

  const home = input.homeDetails ?? ({} as EngineHomeDetails);
  const svc = input.additionalServices ?? ({} as EngineAdditionalServices);

  // =========================================================================
  // PROMOTION BRANCH — only when the customer EXPLICITLY selected a promotion.
  // A promotion never applies automatically and never silently replaces the
  // normal window-cleaning price. It is handled in isolation and returns early.
  // =========================================================================
  if (input.promotion && input.promotion.id) {
    return calculatePromotion(input, pricing, ruleVersion, trace);
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
      for (const serviceKey of [
        svc.windowCleaning && "window_cleaning",
        svc.interiorWindows && "interior_windows",
        svc.houseWash && "house_wash",
        svc.gutterCleaning && "gutter_cleaning",
        svc.roofCleaning && "roof_cleaning",
      ].filter((key): key is string => !!key)) {
        markServiceReview(serviceKey, `Square footage ${squareFootage} exceeds automated range; manual review required`);
      }
    }
  }

  const stories = home.stories;
  const needsStories = needsSqft;
  if (needsStories && !VALID_STORIES.includes(stories)) {
    missing.push("stories");
  }
  // Window sides are price-changing and must be explicit. Legacy callers may
  // still supply `windowCleaningType`, but omission must never silently become
  // exterior-only.
  if (svc.windowCleaning && home.windowCleaningType !== "exterior" && home.windowCleaningType !== "both") {
    missing.push("windowCleaningSides");
  }
  if (svc.windowCleaning) {
    if (home.hardWaterStains === true && !isValidWindowEquivalentCount(home.hardWaterAffectedWindowEquivalents)) {
      missing.push("hardWaterAffectedWindowEquivalents");
    }
    if (home.ladderWork === true && !isValidWindowEquivalentCount(home.ladderAffectedWindowEquivalents)) {
      missing.push("ladderAffectedWindowEquivalents");
    }
    if (home.addedInteriorWindowSides !== undefined && !isValidWindowEquivalentCount(home.addedInteriorWindowSides)) {
      missing.push("addedInteriorWindowSides");
    }
    if (home.omittedWindowSides !== undefined && home.omittedWindowSides !== "unknown" &&
      !isValidWindowEquivalentCount(home.omittedWindowSides)) {
      missing.push("omittedWindowSides");
    }
    if (home.advancedWindowConditions === false &&
      (home.hardWaterStains || home.frenchPanes || home.ladderWork)) {
      markServiceReview("window_cleaning", "Advanced window answers contradict the confirmed no-conditions screening response");
    }
  }
  if (svc.drivewayCleaning?.enabled) {
    if (!isValidNumber(svc.drivewayCleaning.sqft) || svc.drivewayCleaning.sqft <= 0) missing.push("drivewaySqft");
    if (!svc.drivewayCleaning.surfaceType) missing.push("drivewaySurface");
    else if (!APPROVED_FLATWORK_SURFACES.has(svc.drivewayCleaning.surfaceType)) {
      markServiceReview("driveway_cleaning", `Driveway surface ${svc.drivewayCleaning.surfaceType} needs clarification`);
    }
  }
  if (svc.pressureWashing?.enabled) {
    const pw = svc.pressureWashing;
    if (!pw.surfaceType) missing.push("pressureWashingSurface");
    const areas = [pw.frontPorch, pw.backPatio, pw.poolDeck, pw.walkways];
    if (!areas.some((area) => area?.enabled && isValidNumber(area.sqft) && area.sqft > 0)) {
      missing.push("pressureWashingAreas");
    }
  }
  if (svc.solarPanelCleaning?.enabled && (!isValidNumber(svc.solarPanelCleaning.panelCount) || svc.solarPanelCleaning.panelCount <= 0)) {
    missing.push("solarPanelCount");
  }
  if (svc.solarPanelCleaning?.enabled && svc.solarPanelCleaning.panelCount > 0) {
    const solar = svc.solarPanelCleaning;
    const canonicalAccessProvided = solar.stories !== undefined || solar.accessType !== undefined ||
      solar.knownDamage !== undefined || solar.extremePitch !== undefined ||
      solar.fragileMaterial !== undefined || solar.unusualAccess !== undefined;
    if (!canonicalAccessProvided) missing.push("solarAccessProfile");
    if (canonicalAccessProvided && solar.stories !== 1 && solar.stories !== 2 && solar.stories !== 3) missing.push("solarAccessStories");
    if (canonicalAccessProvided && !solar.accessType) missing.push("solarAccessType");
    if (canonicalAccessProvided && [solar.knownDamage, solar.extremePitch, solar.fragileMaterial, solar.unusualAccess].some((flag) => typeof flag !== "boolean")) {
      missing.push("solarAccessRiskFlags");
    }
    if (solar.stories === 3 || solar.accessType === "unusual_or_uncertain" || solar.knownDamage ||
      solar.extremePitch || solar.fragileMaterial || solar.unusualAccess) {
      markServiceReview("solar_panel_cleaning", "Solar-panel cleaning access or safety scope requires photo-assisted remote review");
    }
  }
  if (svc.screenRepair?.enabled && (!isValidNumber(svc.screenRepair.screenCount) || svc.screenRepair.screenCount <= 0)) {
    missing.push("screenRepairCount");
  }
  if (svc.screenRepair?.enabled && svc.screenRepair.screenCount > 0) {
    if (!svc.screenRepair.scopeType) missing.push("screenRepairScopeType");
    else if (svc.screenRepair.scopeType !== "standard_removable_reusable_frame") {
      markServiceReview("screen_repair", "Screen-repair scope is outside standard removable-screen mesh replacement");
    }
  }
  if (svc.roofCleaning) {
    if (!svc.roofType) missing.push("roofType");
    if (!svc.roofSeverity) missing.push("roofSeverity");
    if (!svc.roofRiskFlags || Object.values(svc.roofRiskFlags).some((flag) => typeof flag !== "boolean")) {
      missing.push("roofRiskFlags");
    }
    const ordinaryAsphalt = svc.roofType === "asphalt" || svc.roofType === "asphalt_shingle";
    const ordinarySeverity = svc.roofSeverity === "light" || svc.roofSeverity === "moderate";
    const risk = svc.roofRiskFlags;
    if ((svc.roofType && !ordinaryAsphalt) || (svc.roofSeverity && !ordinarySeverity) || stories === 3 ||
      (risk && (risk.knownDamage || risk.extremePitch || risk.fragileMaterial || risk.unusualAccess))) {
      markServiceReview("roof_cleaning", "Roof-wash material, severity, height, condition, pitch, or access requires photo-assisted remote review");
    }
  }

  // Optional add-ons never become universal requirements. Once selected,
  // only the information needed to price that add-on becomes required.
  if (home.enclosedPatioProfile === "window_enclosed" && svc.windowCleaning) {
    if (!isValidNumber(home.enclosureWindowCount) || !Number.isInteger(home.enclosureWindowCount) || home.enclosureWindowCount <= 0) addonMissing.push("enclosureWindowCount");
    if (home.enclosureWindowSides !== "outside_only" && home.enclosureWindowSides !== "inside_and_outside") {
      addonMissing.push("enclosureWindowSides");
    }
  }
  if (home.enclosedPatioProfile === "mixed_or_uncertain") {
    if (svc.houseWash) markServiceReview("house_wash", "Enclosed patio type needs clarification");
    if (svc.windowCleaning) markServiceReview("window_cleaning", "Enclosed patio type needs clarification");
  }
  if (home.screenedEnclosureSoftWash && home.enclosedPatioProfile !== "screened") {
    manualReviewReasons.push("Screened-enclosure soft wash was selected without a confirmed screened enclosure");
  }
  if (
    home.solarScreenServiceRequested &&
    (home.screenProfile === "solar" || home.screenProfile === "mixed_standard_solar")
  ) {
    if (home.solarScreenCoverage !== "all" && home.solarScreenCoverage !== "some") {
      addonMissing.push("solarScreenCoverage");
    } else if (
      home.solarScreenCoverage === "some" &&
      (!isValidNumber(home.solarScreenAffectedWindowCount) || !Number.isInteger(home.solarScreenAffectedWindowCount) || home.solarScreenAffectedWindowCount <= 0)
    ) {
      addonMissing.push("solarScreenAffectedWindowCount");
    }
  }
  if (home.solarScreenServiceRequested && home.screenProfile === "fixed_nonremovable_or_unknown") {
    manualReviewReasons.push("Solar/fixed screen service needs clarification");
  }
  if (home.solarScreenServiceRequested && !home.screenProfile) addonMissing.push("screenProfile");
  if (home.solarScreenServiceRequested && (home.screenProfile === "standard_removable" || home.screenProfile === "no_screens")) {
    manualReviewReasons.push("Solar-screen service was selected without confirmed solar screens");
  }

  // Missing information is service-scoped. Continue far enough to price other
  // independently complete services, while the aggregate status remains
  // non-actionable until every selected service is resolved.
  const hasMissing = (...fields: string[]) => fields.some((field) => missing.includes(field));
  const sharedPropertyReady = !hasMissing("squareFootage", "stories") &&
    isValidNumber(squareFootage) && squareFootage > 0 && squareFootage <= MAX_SQFT;
  const sqft = sharedPropertyReady ? squareFootage : 0;

  // =========================================================================
  // WINDOW CLEANING
  // =========================================================================
  if (svc.windowCleaning && sharedPropertyReady && !hasMissing(
    "windowCleaningSides", "hardWaterAffectedWindowEquivalents", "ladderAffectedWindowEquivalents",
    "addedInteriorWindowSides", "omittedWindowSides",
  ) && !manualReviewServiceKeys.has("window_cleaning")) {
    const cfg = pricing.window_cleaning;
    if (!cfg) {
      manualReviewReasons.push("window_cleaning pricing not configured");
    } else {
      const mods = cfg.modifiers;
      const baseExterior = sqft * cfg.exteriorPerSqFt;
      const combinedRate = cfg.insideAndOutsidePerSqFt ??
        (cfg.exteriorPerSqFt + cfg.interiorPerSqFt);
      const baseInterior = home.windowCleaningType === "both"
        ? sqft * Math.max(0, combinedRate - cfg.exteriorPerSqFt)
        : 0;

      const storyMod = mods.stories[stories.toString()] ?? 0;
      const conditionMod = mods.condition?.[home.condition ?? ""] ?? 0;

      const exteriorWindows = roundDollars(
        baseExterior * (1 + storyMod / 100 + conditionMod / 100),
      );
      const interiorWindows = roundDollars(baseInterior * (1 + conditionMod / 100));
      const adjustedWindowBase = exteriorWindows + interiorWindows;

      const adjustments: { key?: string; label: string; amount: number }[] = [];
      let hardWaterAddon = 0;
      let frenchPanesAddon = 0;
      let solarScreensAddon = 0;
      let canonicalSolarScreenAdjustment = 0;
      let ladderWorkAddon = 0;
      let sunroomAddon = 0;

      if (home.hardWaterStains && isValidWindowEquivalentCount(home.hardWaterAffectedWindowEquivalents)) {
        hardWaterAddon = roundCents(
          home.hardWaterAffectedWindowEquivalents * CONFIRMED_QUOTE_RULES.hardWaterAffectedWindowEach,
        );
      } else if (home.showAdvanced && home.hardWaterStains && mods.hardWater && isValidNumber(home.hardWaterPercent)) {
        // Read-only compatibility for persisted percentage-based answers.
        hardWaterAddon = roundDollars(
          adjustedWindowBase * (mods.hardWater / 100) * (home.hardWaterPercent / 100),
        );
      }
      if (home.frenchPanes) {
        frenchPanesAddon = roundDollars(
          Math.max(adjustedWindowBase, cfg.minimumPrice ?? 0) *
            (CONFIRMED_QUOTE_RULES.frenchPaneBasePercent / 100),
        );
      }
      if (home.ladderWork && isValidWindowEquivalentCount(home.ladderAffectedWindowEquivalents)) {
        ladderWorkAddon = roundCents(
          home.ladderAffectedWindowEquivalents * CONFIRMED_QUOTE_RULES.unusualLadderAffectedWindowEach,
        );
      }
      if (home.showAdvanced) {
        // Legacy percentage coverage remains readable for persisted records.
        // New writes use screenProfile + solarScreenCoverage below.
        if (!home.screenProfile && home.solarScreens && mods.solarScreens) {
          solarScreensAddon = roundDollars(
            adjustedWindowBase * (mods.solarScreens / 100) * ((home.solarScreensPercent ?? 0) / 100),
          );
        }
        if (home.ladderWork && !isValidWindowEquivalentCount(home.ladderAffectedWindowEquivalents)) {
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
      const windowServiceBeforeCanonicalSolar = Math.max(calculated, minimum);

      if (
        home.solarScreenServiceRequested &&
        (home.screenProfile === "solar" || home.screenProfile === "mixed_standard_solar")
      ) {
        if (home.solarScreenCoverage === "some") {
          manualReviewReasons.push(
            "Partial solar-screen service requires clarification because the current whole-home architecture cannot allocate the surcharge by affected-window count",
          );
        } else if (home.solarScreenCoverage === "all") {
          const percent = home.windowCleaningType === "both"
            ? CONFIRMED_QUOTE_RULES.solarScreenFullServicePercent
            : CONFIRMED_QUOTE_RULES.solarScreenExteriorPercent;
          const applicablePrice = home.windowCleaningType === "both"
            ? Math.max(adjustedWindowBase, minimum)
            : Math.max(exteriorWindows, minimum);
          canonicalSolarScreenAdjustment = roundDollars(applicablePrice * (percent / 100));
        }
      }
      const amount = windowServiceBeforeCanonicalSolar + canonicalSolarScreenAdjustment;

      if (storyMod) adjustments.push({ label: `${stories}-story`, amount: 0 });
      if (hardWaterAddon) adjustments.push({ key: QUOTE_RULE_IDS.hardWaterRemoval, label: "Hard-water stain removal", amount: hardWaterAddon });
      if (frenchPanesAddon) adjustments.push({ key: QUOTE_RULE_IDS.frenchPaneAdjustment, label: "Small French panes (+50% of base window service)", amount: frenchPanesAddon });
      if (solarScreensAddon) adjustments.push({ label: "Solar screens", amount: solarScreensAddon });
      if (canonicalSolarScreenAdjustment) adjustments.push({
        key: QUOTE_RULE_IDS.solarScreenService,
        label: "Solar-screen removal, cleaning, and reinstallation",
        amount: canonicalSolarScreenAdjustment,
      });
      if (canonicalSolarScreenAdjustment) priceAdjustments.push({
        key: QUOTE_RULE_IDS.solarScreenService,
        label: "Solar-screen removal, cleaning, and reinstallation",
        kind: "surcharge",
        amount: canonicalSolarScreenAdjustment,
        appliesToLineItemKey: "window_cleaning",
      });
      if (ladderWorkAddon) adjustments.push({ key: QUOTE_RULE_IDS.unusualLadderAccess, label: "Unusual dedicated ladder access", amount: ladderWorkAddon });
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
        minimumApplied: windowServiceBeforeCanonicalSolar > calculated,
        amount,
        jobberLineItem: { name: "Window Cleaning", unitPrice: amount },
        components: {
          exteriorWindows,
          interiorWindows,
          hardWaterAddon,
          frenchPanesAddon,
          solarScreensAddon,
          canonicalSolarScreenAdjustment,
          ladderWorkAddon,
          sunroomAddon,
          windowCleaningTotal: amount,
        },
        customerExplanation: canonicalSolarScreenAdjustment
          ? `Window cleaning: $${windowServiceBeforeCanonicalSolar}; solar-screen removal, cleaning, and reinstallation +$${canonicalSolarScreenAdjustment}; window subtotal $${amount}.`
          : undefined,
      });
      trace.push(
        `window: ext=${exteriorWindows} int=${interiorWindows} storyMod=${storyMod}% condMod=${conditionMod}% -> ${amount} (min ${minimum})`,
      );

      if (isValidWindowEquivalentCount(home.addedInteriorWindowSides)) {
        const addedAmount = roundCents(home.addedInteriorWindowSides * CONFIRMED_QUOTE_RULES.addedInteriorWindowSideEach);
        lineItems.push({
          key: QUOTE_RULE_IDS.addedInteriorWindowSides,
          label: "Added interior window-sides",
          quantity: home.addedInteriorWindowSides,
          unit: "window_side",
          baseAmount: addedAmount,
          adjustments: [],
          minimumApplied: false,
          amount: addedAmount,
          jobberLineItem: { name: "Added Interior Window-Sides", description: `${home.addedInteriorWindowSides} window-side equivalents`, unitPrice: addedAmount },
          customerExplanation: `${home.addedInteriorWindowSides} added interior window-side equivalents × $${CONFIRMED_QUOTE_RULES.addedInteriorWindowSideEach} = $${addedAmount}.`,
        });
      }
      if (isValidWindowEquivalentCount(home.omittedWindowSides)) {
        const requestedDeduction = roundCents(home.omittedWindowSides * CONFIRMED_QUOTE_RULES.omittedWindowSideEach);
        const omissionFloor = cfg.omissionMinimumPrice ?? cfg.minimumPrice ?? 0;
        const deduction = Math.min(requestedDeduction, Math.max(0, amount - omissionFloor));
        if (deduction > 0) priceAdjustments.push({
          key: QUOTE_RULE_IDS.omittedWindowSides,
          label: "Customer-requested omitted window-sides",
          kind: "discount",
          amount: deduction,
          appliesToLineItemKey: "window_cleaning",
        });
      } else if (home.omittedWindowSides === "unknown") {
        disclosures.push({
          key: QUOTE_RULE_IDS.omittedWindowSides,
          text: `The onsite pre-tax price will be reduced by $${CONFIRMED_QUOTE_RULES.omittedWindowSideEach} for each confirmed omitted window-side, subject to the configured window-service minimum.`,
        });
      }

      const explicitlyConfirmed = home.screenProfileProvenance === "captured" ||
        home.screenProfileProvenance === "verified" ||
        home.screenProfileProvenance === "corrected";
      if (home.screenProfile === "no_screens" && explicitlyConfirmed) {
        const noScreenDiscount = roundCents(amount * (CONFIRMED_QUOTE_RULES.noScreenDiscountPercent / 100));
        if (noScreenDiscount > 0) {
          priceAdjustments.push({
            key: QUOTE_RULE_IDS.noScreenDiscount,
            label: "5% no-screen discount",
            kind: "discount",
            amount: noScreenDiscount,
            appliesToLineItemKey: "window_cleaning",
          });
          disclosures.push({
            key: QUOTE_RULE_IDS.noScreenDiscount,
            text: "This quote includes a 5% no-screen discount. If removable screens are present when we arrive, the discount will be removed before work begins.",
          });
        }
      }
    }
  }

  // =========================================================================
  // INTERIOR WINDOWS (standalone) — plan-builder rule promoted unchanged.
  // sqft × interiorPerSqFt with story+condition modifiers and a 0.6× minimum.
  // =========================================================================
  if (svc.interiorWindows && sharedPropertyReady && !manualReviewServiceKeys.has("interior_windows")) {
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
  if (svc.houseWash && sharedPropertyReady && !manualReviewServiceKeys.has("house_wash")) {
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

      const patios = svc.houseWashPatios;
      const patioRequested = !!patios && (
        patios.frontSelected === true || patios.backSelected === true ||
        (isValidNumber(patios.frontSqft) && patios.frontSqft > 0) ||
        (isValidNumber(patios.backSqft) && patios.backSqft > 0)
      );
      if (patioRequested && patios) {
        if (patios.pricingMethod === "simple_selection") {
          for (const [selected, key, label] of [
            [patios.frontSelected, QUOTE_RULE_IDS.houseWashFrontPatio, "Front-patio pressure washing"],
            [patios.backSelected, QUOTE_RULE_IDS.houseWashBackPatio, "Back-patio pressure washing"],
          ] as const) {
            if (!selected) continue;
            const patioAmount = roundDollars(houseWash * (CONFIRMED_QUOTE_RULES.houseWashPatioPercentEach / 100));
            lineItems.push({
              key,
              label,
              quantity: 1,
              unit: "flat",
              baseAmount: patioAmount,
              adjustments: [],
              minimumApplied: false,
              amount: patioAmount,
              jobberLineItem: { name: label, description: "Simple-selection patio add-on", unitPrice: patioAmount },
              components: { percentageOfBaseHouseWash: CONFIRMED_QUOTE_RULES.houseWashPatioPercentEach, patioTotal: patioAmount },
            });
          }
        } else if (patios.pricingMethod === "exact_square_footage") {
          for (const [selected, sqftValue, key, label, missingField] of [
            [patios.frontSelected, patios.frontSqft, QUOTE_RULE_IDS.houseWashFrontPatio, "Front-patio pressure washing", "houseWashFrontPatioSqft"],
            [patios.backSelected, patios.backSqft, QUOTE_RULE_IDS.houseWashBackPatio, "Back-patio pressure washing", "houseWashBackPatioSqft"],
          ] as const) {
            if (!selected && !isValidNumber(sqftValue)) continue;
            if (!isValidNumber(sqftValue) || sqftValue <= 0 || sqftValue > MAX_SQFT) {
              addonMissing.push(missingField);
              continue;
            }
            const patioAmount = roundCents(sqftValue * CONFIRMED_QUOTE_RULES.houseWashPatioPerSqFt);
            lineItems.push({
              key,
              label,
              quantity: sqftValue,
              unit: "sqft",
              baseAmount: patioAmount,
              adjustments: [],
              minimumApplied: false,
              amount: patioAmount,
              jobberLineItem: { name: label, description: `${sqftValue} sq ft`, unitPrice: patioAmount },
              components: { squareFootage: sqftValue, perSqFt: CONFIRMED_QUOTE_RULES.houseWashPatioPerSqFt, patioTotal: patioAmount },
            });
          }
        } else {
          addonMissing.push("houseWashPatioPricingMethod");
        }
      }
    }
  }

  // =========================================================================
  // GUTTER CLEANING (+ add-ons)
  // =========================================================================
  if (svc.gutterCleaning && sharedPropertyReady && !manualReviewServiceKeys.has("gutter_cleaning")) {
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
      const adjustments: { key?: string; label: string; amount: number }[] = [];
      const gutterAddonLineItems: QuoteLineItem[] = [];

      if (addons?.undergroundDrains?.enabled) {
        const drainCount = exactNonNegativeInteger(addons.undergroundDrains.count);
        if (drainCount === null) {
          addonMissing.push("gutterUndergroundDrainCount");
        } else if (drainCount > 0) {
          drain = CONFIRMED_QUOTE_RULES.undergroundDrainFirstTwoTotal +
            Math.max(0, drainCount - 2) * CONFIRMED_QUOTE_RULES.undergroundDrainEachAfterTwo;
          gutterAddonLineItems.push({
            key: QUOTE_RULE_IDS.undergroundDrainClearing,
            label: "Clear clogs or debris from underground gutter drains",
            quantity: drainCount,
            unit: "each",
            baseAmount: drain,
            adjustments: [],
            minimumApplied: false,
            amount: drain,
            jobberLineItem: {
              name: "Underground Gutter Drain Clearing",
              description: `${drainCount} drain${drainCount === 1 ? "" : "s"}; ordinary clogs and debris only`,
              unitPrice: drain,
            },
            components: { drainCount, undergroundDrainClearingTotal: drain },
            customerExplanation: `${drainCount} underground drain${drainCount === 1 ? "" : "s"}: $${drain}.`,
          });
          disclosures.push({
            key: QUOTE_RULE_IDS.undergroundDrainClearing,
            text: "Underground-drain clearing covers ordinary clogs and debris. Damaged, collapsed, root-intruded, disconnected, or inaccessible drainage may require separate repair or specialized work; excavation and pipe replacement are not included.",
          });
        }
      }
      const repairNeeds = addons?.repairNeeds ?? [];
      const knownRepairNeeds = new Set([
        "leaking_seams", "loose_gutter_sections", "detached_gutter_sections",
        "loose_downspouts", "detached_downspouts", "none", "unsure", "another_repair_need",
      ]);
      const qualifyingRepairNeeds = repairNeeds.filter((need) =>
        need === "leaking_seams" || need === "loose_gutter_sections" ||
        need === "detached_gutter_sections" || need === "loose_downspouts" ||
        need === "detached_downspouts"
      );
      const repairNeedsClarification = repairNeeds.some((need) => !knownRepairNeeds.has(need)) ||
        repairNeeds.includes("unsure") || repairNeeds.includes("another_repair_need") ||
        (repairNeeds.includes("none") && qualifyingRepairNeeds.length > 0);
      if (repairNeedsClarification) {
        manualReviewReasons.push("Gutter/downspout repair scope needs clarification; base gutter cleaning remains priced independently");
      } else if (addons?.minorRepairs || qualifyingRepairNeeds.length > 0) {
        repairs = roundDollars(gutterCleaning * (CONFIRMED_QUOTE_RULES.minorGutterRepairPercent / 100));
        gutterAddonLineItems.push({
          key: QUOTE_RULE_IDS.minorGutterRepairs,
          label: "Minor gutter/downspout repairs: +30%",
          quantity: 1,
          unit: "flat",
          baseAmount: repairs,
          adjustments: [],
          minimumApplied: false,
          amount: repairs,
          jobberLineItem: {
            name: "Minor Gutter/Downspout Repairs",
            description: "Ordinary minor labor and materials, including sealant and a limited number of common brackets or fasteners",
            unitPrice: repairs,
          },
          components: { repairPercent: CONFIRMED_QUOTE_RULES.minorGutterRepairPercent, minorRepairTotal: repairs },
          customerExplanation: `Minor gutter/downspout repairs: +30% ($${repairs}).`,
        });
        disclosures.push({
          key: QUOTE_RULE_IDS.minorGutterRepairs,
          text: "The minor-repair adjustment covers ordinary resealing and reattachment work plus a limited number of common brackets or fasteners. Major reconstruction, long-section replacement, fascia/soffit/roof work, substantial pitch correction, underground pipe repair, specialty fabrication, storm damage, and gutter-guard work are not included.",
        });
      }
      if (addons?.gutterGuards?.enabled) {
        const linearFeet = addons.gutterGuards.linearFeet ?? 0;
        guards = linearFeet * (cfg.gutterGuardsPerLinearFoot ?? 0);
        if (guards) {
          gutterAddonLineItems.push({
            key: "gutter_guards",
            label: `Gutter guards (${linearFeet} lf)`,
            quantity: linearFeet,
            unit: "linear_ft",
            baseAmount: guards,
            adjustments: [],
            minimumApplied: false,
            amount: guards,
            jobberLineItem: { name: "Gutter Guards", description: `${linearFeet} linear feet`, unitPrice: guards },
          });
        }
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
        amount: gutterCleaning,
        jobberLineItem: { name: "Gutter Cleaning", unitPrice: gutterCleaning },
        components: {
          gutterCleaning,
          gutterDrainCleaning: drain,
          gutterMinorRepairs: repairs,
          gutterGuards: guards,
          gutterCleaningTotal: amount,
        },
      });
      lineItems.push(...gutterAddonLineItems);
      trace.push(`gutter: base=${roundDollars(base)} storyMod=${storyMod}% drains=${drain} repairs=${repairs} guards=${guards} -> ${amount} (min ${minimum})`);
    }
  }

  // =========================================================================
  // ROOF CLEANING
  // =========================================================================
  if (svc.roofCleaning && sharedPropertyReady && !hasMissing("roofType", "roofSeverity", "roofRiskFlags")) {
    const cfg = pricing.roof_cleaning;
    if (!cfg) {
      markServiceReview("roof_cleaning", "roof_cleaning pricing not configured");
    } else if (manualReviewServiceKeys.has("roof_cleaning")) {
      trace.push("roof: held for photo-assisted remote review; other services remain independently priceable");
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
  if (svc.drivewayCleaning?.enabled && !hasMissing("drivewaySqft", "drivewaySurface")) {
    const cfg = pricing.driveway_cleaning;
    const { sqft: dSqft, surfaceType } = svc.drivewayCleaning;
    if (!cfg) {
      markServiceReview("driveway_cleaning", "driveway_cleaning pricing not configured");
    } else if (!isValidNumber(dSqft) || dSqft <= 0 || dSqft > MAX_SQFT) {
      markServiceReview("driveway_cleaning", "Invalid driveway square footage");
    } else if (manualReviewServiceKeys.has("driveway_cleaning")) {
      trace.push("driveway: held for surface clarification; other services remain independently priceable");
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
  if (svc.pressureWashing?.enabled && !hasMissing("pressureWashingSurface", "pressureWashingAreas")) {
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
          if (!isValidNumber(area.sqft) || area.sqft <= 0 || area.sqft > MAX_SQFT) {
            invalid = true;
            continue;
          }
          const areaSurface = area.surfaceType ?? pw.surfaceType;
          if (!APPROVED_FLATWORK_SURFACES.has(areaSurface)) {
            markServiceReview(`pressure_washing:${areaKeyByLabel[label]}`, `${label} surface ${areaSurface} needs clarification`);
            continue;
          }
          const areaMultiplier = cfg.surfaceMultipliers[areaSurface] ?? mult;
          const areaPrice = roundDollars(area.sqft * cfg.perSqFt * areaMultiplier);
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
  // SOLAR PANEL CLEANING — flat per-panel price × quantity
  // =========================================================================
  if (svc.solarPanelCleaning?.enabled && !hasMissing(
    "solarPanelCount", "solarAccessProfile", "solarAccessStories", "solarAccessType", "solarAccessRiskFlags",
  )) {
    const cfg = pricing.solar_panel_cleaning;
    if (!cfg) {
      markServiceReview("solar_panel_cleaning", "solar_panel_cleaning pricing not configured");
    } else if (manualReviewServiceKeys.has("solar_panel_cleaning")) {
      trace.push("solar: held for photo-assisted remote review; other services remain independently priceable");
    } else {
      const panels = Math.floor(svc.solarPanelCleaning.panelCount ?? 0);
      if (!isValidNumber(panels) || panels <= 0) {
        missing.push("solarPanelCount");
      } else if (panels > 1000) {
        manualReviewReasons.push(
          `Solar panel count ${panels} exceeds automated range; manual review required`,
        );
      } else {
        const perPanel = cfg.perPanel;
        const calculated = roundDollars(panels * perPanel);
        const minimum = cfg.minimumPrice ?? 0;
        const amount = Math.max(calculated, minimum);
        lineItems.push({
          key: "solar_panel_cleaning",
          label: "Solar Panel Cleaning",
          quantity: panels,
          unit: "each",
          baseAmount: calculated,
          adjustments: [],
          minimumApplied: amount > calculated,
          amount,
          jobberLineItem: {
            name: "Solar Panel Cleaning",
            description: `${panels} solar panels`,
            unitPrice: amount,
          },
          components: {
            panelCount: panels,
            perPanel,
            solarPanelCleaningTotal: amount,
          },
        });
        trace.push(`solar: ${panels} x $${perPanel} -> ${amount}`);
      }
    }
  }

  // =========================================================================
  // SCREEN REPAIR — flat per-screen price × quantity
  // =========================================================================
  if (svc.screenRepair?.enabled && !hasMissing("screenRepairCount", "screenRepairScopeType")) {
    const cfg = pricing.screen_repair;
    if (!cfg) {
      markServiceReview("screen_repair", "screen_repair pricing not configured");
    } else if (manualReviewServiceKeys.has("screen_repair")) {
      trace.push("screen repair: held for scope review; other services remain independently priceable");
    } else {
      const screens = Math.floor(svc.screenRepair.screenCount ?? 0);
      if (!isValidNumber(screens) || screens <= 0) {
        missing.push("screenRepairCount");
      } else if (screens > 500) {
        manualReviewReasons.push(
          `Screen count ${screens} exceeds automated range; manual review required`,
        );
      } else {
        const perScreen = cfg.perScreen;
        const calculated = roundDollars(screens * perScreen);
        const minimum = cfg.minimumPrice ?? 0;
        const amount = Math.max(calculated, minimum);
        lineItems.push({
          key: "screen_repair",
          label: "Screen Repair",
          quantity: screens,
          unit: "each",
          baseAmount: calculated,
          adjustments: [],
          minimumApplied: amount > calculated,
          amount,
          jobberLineItem: {
            name: "Screen Repair",
            description: `${screens} screen${screens === 1 ? "" : "s"}`,
            unitPrice: amount,
          },
          components: {
            screenCount: screens,
            perScreen,
            screenRepairTotal: amount,
          },
        });
        trace.push(`screen: ${screens} x $${perScreen} -> ${amount}`);
      }
    }
  }

  // =========================================================================
  // ENCLOSED PATIO ADD-ONS — independent from whole-home square-footage math
  // =========================================================================
  const enclosureEligible = !!svc.windowCleaning || !!svc.houseWash;
  if (enclosureEligible && home.enclosedPatioProfile === "screened" && home.screenedEnclosureSoftWash) {
    const amount = CONFIRMED_QUOTE_RULES.screenedEnclosureFlatRate;
    lineItems.push({
      key: QUOTE_RULE_IDS.screenedEnclosureSoftWash,
      label: "Screened-enclosure soft wash",
      quantity: 1,
      unit: "flat",
      baseAmount: amount,
      adjustments: [],
      minimumApplied: false,
      amount,
      jobberLineItem: {
        name: "Screened-Enclosure Soft Wash",
        description: "One screened enclosure; flat rate",
        unitPrice: amount,
      },
      components: { enclosureCount: 1, flatRate: amount, screenedEnclosureTotal: amount },
      customerExplanation: "One screened enclosure at the confirmed $150 flat rate.",
    });
  }
  if (
    svc.windowCleaning && home.enclosedPatioProfile === "window_enclosed" &&
    isValidNumber(home.enclosureWindowCount) && Number.isInteger(home.enclosureWindowCount) && home.enclosureWindowCount > 0 &&
    (home.enclosureWindowSides === "outside_only" || home.enclosureWindowSides === "inside_and_outside")
  ) {
    const unitPrice = home.enclosureWindowSides === "inside_and_outside"
      ? CONFIRMED_QUOTE_RULES.enclosureWindowBothEach
      : CONFIRMED_QUOTE_RULES.enclosureWindowExteriorEach;
    const amount = roundCents(home.enclosureWindowCount * unitPrice);
    lineItems.push({
      key: QUOTE_RULE_IDS.enclosureWindowCleaning,
      label: home.enclosureWindowSides === "inside_and_outside"
        ? "Enclosure window cleaning (inside and outside)"
        : "Enclosure window cleaning (exterior only)",
      quantity: home.enclosureWindowCount,
      unit: "each",
      baseAmount: amount,
      adjustments: [],
      minimumApplied: false,
      amount,
      jobberLineItem: {
        name: "Enclosure Window Cleaning",
        description: `${home.enclosureWindowCount} windows, ${home.enclosureWindowSides === "inside_and_outside" ? "inside and outside" : "exterior only"}, $${unitPrice} each`,
        unitPrice: amount,
      },
      components: {
        enclosureWindowCount: home.enclosureWindowCount,
        enclosureWindowUnitPrice: unitPrice,
        enclosureWindowTotal: amount,
      },
      customerExplanation: `${home.enclosureWindowCount} enclosure windows × $${unitPrice} each = $${amount}.`,
    });
  }

  // =========================================================================
  // TOTALS + DISCOUNT
  // =========================================================================
  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);

  const hasPricedWindows = lineItems.some((li) => li.key === "window_cleaning");
  const hasPricedHouseWash = lineItems.some((li) => li.key === "house_wash");
  if (hasPricedWindows && hasPricedHouseWash) {
    const amount = Math.min(CONFIRMED_QUOTE_RULES.houseWashWindowBundleDiscount, subtotal);
    if (amount > 0) {
      priceAdjustments.push({
        key: QUOTE_RULE_IDS.houseWashWindowBundle,
        label: "House wash + window cleaning bundle",
        kind: "discount",
        amount,
      });
    }
  }

  const contractDiscountAmount = priceAdjustments
    .filter((adjustment) => adjustment.kind === "discount")
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const discountableAfterContractRules = Math.max(0, subtotal - contractDiscountAmount);

  let discount: QuoteResult["discount"] = null;
  let discountAmount = 0;
  if (input.discount && discountableAfterContractRules > 0) {
    const d = input.discount;
    if (d.type === "percentage" && isValidNumber(d.value) && d.value > 0) {
      discountAmount = roundCents(discountableAfterContractRules * (d.value / 100));
    } else if (d.type === "fixed" && isValidNumber(d.value) && d.value > 0) {
      discountAmount = Math.min(roundCents(d.value), discountableAfterContractRules);
    }
    if (discountAmount > 0) {
      discount = { code: d.code, type: d.type, value: d.value, amount: discountAmount };
    }
  }

  missing.push(...addonMissing.filter((fieldId) => !missing.includes(fieldId)));
  const total = Math.max(0, roundCents(subtotal - contractDiscountAmount - discountAmount));

  return finalize(
    {
      status: missing.length > 0
        ? "missing_information"
        : manualReviewReasons.length > 0 ? "manual_review_required" : "firm",
      lineItems,
      subtotal,
      discount,
      priceAdjustments,
      disclosures,
      total,
      trace,
      missing,
      manualReviewReasons,
      manualReviewServiceKeys: [...manualReviewServiceKeys],
    },
    ruleVersion,
    pricing,
  );
}

// ---------------------------------------------------------------------------
function finalize(
  partial: {
    status: QuoteStatus;
    lineItems: QuoteLineItem[];
    subtotal: number;
    discount: QuoteResult["discount"];
    priceAdjustments?: QuotePriceAdjustment[];
    disclosures?: QuoteDisclosure[];
    total: number;
    trace: string[];
    missing: string[];
    manualReviewReasons: string[];
    manualReviewServiceKeys?: string[];
    promotion?: QuoteResult["promotion"];
  },
  ruleVersion: number | null,
  pricing: PricingConfig,
): QuoteResult {
  const firm = partial.status === "firm";
  const priceAdjustments = partial.priceAdjustments ?? [];
  const tax = calculateTaxSummary({
    lineItems: partial.lineItems,
    priceAdjustments,
    discountAmount: partial.discount?.amount ?? 0,
    policy: pricing.tax_policy,
  });
  const duration = partial.status === "missing_information"
    ? { minutes: null, version: (pricing.duration_policy ?? APPROVED_DURATION_POLICY).version, bookableServiceKeys: [] as string[] }
    : calculateDeterministicDuration({
        lineItems: partial.lineItems,
        manualReviewServiceKeys: partial.manualReviewServiceKeys,
        policy: pricing.duration_policy,
      });
  let explanation: string;
  if (partial.status === "missing_information") {
    const priced = partial.lineItems.length > 0
      ? ` Independently priced items: ${partial.lineItems.map((li) => `${li.label} $${li.amount}`).join(", ")}.`
      : "";
    explanation = `More information is needed to complete the quote: ${partial.missing.join(", ")}.${priced}`;
  } else if (partial.status === "manual_review_required") {
    const priced = partial.lineItems.length > 0
      ? ` Independently priced items: ${partial.lineItems.map((li) => `${li.label} $${li.amount}`).join(", ")}.`
      : "";
    explanation = `Part of this quote requires manual review: ${partial.manualReviewReasons.join("; ")}.${priced}`;
  } else {
    const parts = partial.lineItems.map((li) => li.customerExplanation ?? `${li.label}: $${li.amount}`);
    explanation =
      parts.join(", ") +
      (partial.discount ? `, discount -$${partial.discount.amount}` : "") +
      ((partial.priceAdjustments?.filter((adjustment) => adjustment.kind === "discount").length ?? 0) > 0
        ? `, ${partial.priceAdjustments!.filter((adjustment) => adjustment.kind === "discount").map((adjustment) => `${adjustment.label} -$${adjustment.amount}`).join(", ")}`
        : "") +
      `. Service subtotal $${tax.serviceSubtotal}; discounts and adjustments $${tax.discountsAndAdjustments}; ` +
      `taxable subtotal $${tax.taxableSubtotal}; estimated tax $${tax.estimatedTax}; estimated total $${tax.estimatedTotal}.`;
  }

  return {
    engineVersion: PRICING_ENGINE_VERSION,
    ruleVersion,
    status: partial.status,
    firm,
    lineItems: partial.lineItems,
    subtotal: partial.subtotal,
    discount: partial.discount,
    priceAdjustments,
    disclosures: partial.disclosures ?? [],
    calculationOrder: QUOTE_CALCULATION_ORDER,
    total: partial.total,
    estimatedDurationMinutes: duration.minutes,
    durationSource: duration.minutes == null ? null : "deterministic_duration_engine",
    durationVersion: duration.minutes == null ? null : duration.version,
    ...tax,
    bookableServiceKeys: duration.bookableServiceKeys,
    manualReviewServiceKeys: partial.manualReviewServiceKeys ?? [],
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
  input: QuoteInput,
  pricing: PricingConfig,
  ruleVersion: number | null,
  trace: string[],
): QuoteResult {
  const req = input.promotion!;
  const home = input.homeDetails ?? ({} as EngineHomeDetails);
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
      pricing,
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
      pricing,
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
      pricing,
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
        pricing,
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
        pricing,
      );
    }
  }

  // Window count is required to validate the offer's window cap.
  const count = req.windowCount;
  if (!isValidWindowEquivalentCount(count)) {
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
      pricing,
    );
  }

  const maxWindows = isValidNumber(promo.maxWindows) ? promo.maxWindows : 10;

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
      pricing,
    );
  }

  const amount = roundCents(promo.flatPrice);
  const prep = promo.prepInstructions ?? "";
  const label =
    promo.serviceLabel ?? `Exterior Window Cleaning Promotion (up to ${maxWindows} windows)`;
  const jobberDescription = prep
    ? `${count} exterior windows. PREP REQUIRED: ${prep}`
    : `${count} exterior windows`;

  const lineItems: QuoteLineItem[] = [{
    key: "window_promo_99",
    label,
    quantity: Math.min(count, maxWindows),
    unit: "window_equivalent",
    // Work-value floor ensures the promotion cannot shorten duration.
    baseAmount: Math.max(amount, Math.min(count, maxWindows) * CONFIRMED_QUOTE_RULES.promotionAdditionalWindowEach),
    adjustments: [],
    minimumApplied: false,
    amount,
    jobberLineItem: { name: label, description: jobberDescription, unitPrice: amount },
  }];
  if (count > maxWindows) {
    const additionalCount = count - maxWindows;
    const additionalAmount = roundCents(additionalCount * CONFIRMED_QUOTE_RULES.promotionAdditionalWindowEach);
    lineItems.push({
      key: QUOTE_RULE_IDS.promotionAdditionalWindows,
      label: "Additional exterior window equivalents",
      quantity: additionalCount,
      unit: "window_equivalent",
      baseAmount: additionalAmount,
      adjustments: [],
      minimumApplied: false,
      amount: additionalAmount,
      jobberLineItem: { name: "Additional Exterior Windows", description: `${additionalCount} window equivalents beyond the first ${maxWindows}`, unitPrice: additionalAmount },
      customerExplanation: `${additionalCount} additional exterior window equivalents × $${CONFIRMED_QUOTE_RULES.promotionAdditionalWindowEach} = $${additionalAmount}.`,
    });
  }
  if (home.hardWaterStains && isValidWindowEquivalentCount(home.hardWaterAffectedWindowEquivalents)) {
    const hardWaterAmount = roundCents(home.hardWaterAffectedWindowEquivalents * CONFIRMED_QUOTE_RULES.hardWaterAffectedWindowEach);
    lineItems.push({
      key: QUOTE_RULE_IDS.hardWaterRemoval, label: "Hard-water stain removal",
      quantity: home.hardWaterAffectedWindowEquivalents, unit: "window_equivalent", baseAmount: hardWaterAmount,
      adjustments: [], minimumApplied: false, amount: hardWaterAmount,
      jobberLineItem: { name: "Hard-Water Stain Removal", description: `${home.hardWaterAffectedWindowEquivalents} affected window equivalents`, unitPrice: hardWaterAmount },
    });
  }
  if (home.frenchPanes) {
    const baseWindowPrice = lineItems.reduce((sum, item) =>
      item.key === "window_promo_99" || item.key === QUOTE_RULE_IDS.promotionAdditionalWindows ? sum + item.amount : sum, 0);
    const frenchAmount = roundCents(baseWindowPrice * (CONFIRMED_QUOTE_RULES.frenchPaneBasePercent / 100));
    lineItems.push({
      key: QUOTE_RULE_IDS.frenchPaneAdjustment, label: "Small French panes (+50% of base window service)",
      quantity: 1, unit: "flat", baseAmount: frenchAmount, adjustments: [], minimumApplied: false, amount: frenchAmount,
      jobberLineItem: { name: "French-Pane Window Adjustment", unitPrice: frenchAmount },
    });
  }
  if (home.ladderWork && isValidWindowEquivalentCount(home.ladderAffectedWindowEquivalents)) {
    const ladderAmount = roundCents(home.ladderAffectedWindowEquivalents * CONFIRMED_QUOTE_RULES.unusualLadderAffectedWindowEach);
    lineItems.push({
      key: QUOTE_RULE_IDS.unusualLadderAccess, label: "Unusual dedicated ladder access",
      quantity: home.ladderAffectedWindowEquivalents, unit: "window_equivalent", baseAmount: ladderAmount,
      adjustments: [], minimumApplied: false, amount: ladderAmount,
      jobberLineItem: { name: "Unusual Ladder Access", description: `${home.ladderAffectedWindowEquivalents} affected window equivalents`, unitPrice: ladderAmount },
    });
  }
  const subtotal = roundCents(lineItems.reduce((sum, item) => sum + item.amount, 0));
  trace.push(`promo: ${promo.promoId} v${promo.version} count=${count}/${maxWindows} -> $${subtotal}`);

  return finalize(
    {
      status: "firm",
      lineItems,
      subtotal,
      // Stacking is disabled by default; the promotion is a flat, all-in price.
      discount: null,
      total: subtotal,
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
    pricing,
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
    const perServiceFreqs = config.includedServiceFrequencies ?? {};
    // Legacy defaults: only gutter_cleaning multiplied by additionalServicesFrequency,
    // everything else is 1x/year unless the config explicitly overrides.
    const freqFor = (key: string) => {
      const raw = perServiceFreqs[key];
      if (typeof raw === "number" && raw > 0) return raw;
      return key === "gutter_cleaning" ? addFreq : 1;
    };

    const exteriorCost = bases.exteriorWindows * exteriorFreq;
    const interiorCost = bases.interiorWindows * interiorFreq;
    const windowCost = exteriorCost + interiorCost;
    const totalWindowFrequency =
      exteriorFreq + (interiorFreq > 0 ? interiorFreq : 0);

    let baseServicesCost = 0;
    const includedServices: string[] = [];
    const baseServices: string[] = [];

    if (included.includes("gutter_cleaning") && svc.gutterCleaning) {
      const f = freqFor("gutter_cleaning");
      baseServicesCost += bases.gutterCleaning * f;
      includedServices.push(`Gutter Cleaning (${f}x/year)`);
      baseServices.push("gutter_cleaning");
    }
    if (included.includes("house_wash") && svc.houseWash) {
      const f = freqFor("house_wash");
      baseServicesCost += bases.houseWash * f;
      includedServices.push(f > 1 ? `House Wash (${f}x/year)` : "House Wash");
      baseServices.push("house_wash");
    }
    if (roofBaseTiers.includes(tier) && svc.roofCleaning) {
      const f = freqFor("roof_cleaning");
      baseServicesCost += bases.roofCleaning * f;
      includedServices.push(f > 1 ? `Roof Cleaning (${f}x/year)` : "Roof Cleaning");
      baseServices.push("roof_cleaning");
    }
    if (included.includes("driveway_cleaning") && svc.drivewayCleaning?.enabled) {
      const f = freqFor("driveway_cleaning");
      baseServicesCost += bases.drivewayCleaning * f;
      includedServices.push(f > 1 ? `Driveway Cleaning (${f}x/year)` : "Driveway Cleaning");
      baseServices.push("driveway_cleaning");
    }
    if (included.includes("pressure_washing") && svc.pressureWashing?.enabled) {
      const f = freqFor("pressure_washing");
      baseServicesCost += bases.pressureWashing * f;
      includedServices.push(f > 1 ? `Pressure Washing (${f}x/year)` : "Pressure Washing");
      baseServices.push("pressure_washing");
    }

    let addonsCost = 0;
    const addonsList: string[] = [];

    if (!included.includes("driveway_cleaning") && svc.drivewayCleaning?.enabled) {
      addonsCost += bases.drivewayCleaning * (1 - addonDiscount);
      addonsList.push("Driveway Cleaning");
    }
    if (!included.includes("pressure_washing") && svc.pressureWashing?.enabled) {
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
      (!included.includes("driveway_cleaning") && svc.drivewayCleaning?.enabled ? bases.drivewayCleaning : 0) +
      (!included.includes("pressure_washing") && svc.pressureWashing?.enabled ? bases.pressureWashing : 0) +
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
      ...(!included.includes("driveway_cleaning") ? ["driveway_cleaning"] : []),
      ...(!included.includes("pressure_washing") ? ["pressure_washing"] : []),
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
    if (t.tier === "good") {
      features.push("10-day rain guarantee — free touch-ups within 10 days of service");
    } else {
      features.push("Unlimited window touch-ups between visits");
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
