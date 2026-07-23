// ============================================================================
// serviceFactMap — which verified property facts each service is ALLOWED to
// reuse when autofilling a quote. This is the ONLY place that decides
// "gutter quote may reuse house_sqft" vs "driveway quote may NOT".
//
// Never substitute one measurement for another (house sqft is not
// driveway sqft). Never reuse historical prices — the pricing engine is
// always re-run against current pricing.
// ============================================================================

export type FactType =
  | "house_sqft"
  | "stories"
  | "window_units"
  | "exterior_window_count"
  | "interior_window_count"
  | "screen_count"
  | "gutter_linear_feet"
  | "driveway_sqft"
  | "driveway_material"
  | "front_patio_sqft"
  | "back_patio_sqft"
  | "pool_deck_sqft"
  | "walkway_sqft"
  | "surface_material"
  | "roof_sqft"
  | "roof_pitch_category"
  | "siding_material"
  | "solar_panel_count"
  | "fence_linear_feet"
  | "access_notes"
  | "gate_notes"
  | "parking_notes"
  | "water_access_notes";

export type ServiceKind =
  | "window_cleaning"
  | "house_wash"
  | "gutter_cleaning"
  | "roof_cleaning"
  | "driveway_cleaning"
  | "patio_cleaning"
  | "pressure_washing"
  | "solar_cleaning";

export interface FactUsage {
  factType: FactType;
  required: boolean;
}

/** Explicit allow-list. Anything not listed here CANNOT be autofilled. */
export const SERVICE_FACT_MAP: Record<ServiceKind, FactUsage[]> = {
  window_cleaning: [
    { factType: "stories", required: true },
    { factType: "window_units", required: false },
    { factType: "exterior_window_count", required: false },
    { factType: "interior_window_count", required: false },
    { factType: "screen_count", required: false },
    { factType: "house_sqft", required: false }, // fallback estimator input
  ],
  house_wash: [
    { factType: "house_sqft", required: true },
    { factType: "stories", required: true },
    { factType: "siding_material", required: false },
  ],
  gutter_cleaning: [
    { factType: "house_sqft", required: true },
    { factType: "stories", required: true },
    { factType: "gutter_linear_feet", required: false },
  ],
  roof_cleaning: [
    { factType: "stories", required: true },
    { factType: "roof_pitch_category", required: false },
    { factType: "roof_sqft", required: false },
  ],
  driveway_cleaning: [
    { factType: "driveway_sqft", required: true },
    { factType: "driveway_material", required: false },
  ],
  patio_cleaning: [
    { factType: "front_patio_sqft", required: false },
    { factType: "back_patio_sqft", required: false },
    { factType: "surface_material", required: false },
  ],
  pressure_washing: [
    { factType: "surface_material", required: false },
  ],
  solar_cleaning: [
    { factType: "solar_panel_count", required: true },
    { factType: "stories", required: true },
  ],
};

/** Days after which a fact is considered "stale" and needs re-confirmation
 *  before being reused. `null` = never stale. */
export const FACT_STALENESS_DAYS: Partial<Record<FactType, number | null>> = {
  house_sqft: 1825,          // ~5 years, home rarely changes size
  stories: null,             // effectively permanent
  window_units: 365 * 3,
  exterior_window_count: 365 * 3,
  interior_window_count: 365 * 3,
  screen_count: 365 * 2,
  gutter_linear_feet: 365 * 5,
  driveway_sqft: 365 * 5,
  driveway_material: null,
  front_patio_sqft: 365 * 5,
  back_patio_sqft: 365 * 5,
  surface_material: null,
  roof_sqft: 365 * 5,
  roof_pitch_category: null,
  siding_material: null,
  solar_panel_count: 365 * 2,
  fence_linear_feet: 365 * 3,
  access_notes: 365,
  gate_notes: 365,
  parking_notes: 365,
  water_access_notes: 365,
};

/** True if the fact may be used to autofill a quote for the given service. */
export function isFactAllowedForService(service: ServiceKind, factType: FactType): boolean {
  return SERVICE_FACT_MAP[service]?.some((f) => f.factType === factType) ?? false;
}

export function requiredFactsForService(service: ServiceKind): FactType[] {
  return (SERVICE_FACT_MAP[service] ?? []).filter((f) => f.required).map((f) => f.factType);
}

export function isStale(factType: FactType, lastVerifiedAt: string | null | undefined): boolean {
  const rule = FACT_STALENESS_DAYS[factType];
  if (rule === null || rule === undefined) return false;
  if (!lastVerifiedAt) return true;
  const ageMs = Date.now() - new Date(lastVerifiedAt).getTime();
  return ageMs > rule * 24 * 60 * 60 * 1000;
}