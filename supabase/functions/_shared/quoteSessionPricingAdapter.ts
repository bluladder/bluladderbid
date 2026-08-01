// ============================================================================
// quoteSessionPricingAdapter — the ONE QuoteSessionFields -> QuoteInput map.
//
// The canonical contract decides what is required; this adapter only transfers
// confirmed values into the canonical engine shape. It never substitutes a
// surface, story count, measurement, service, promotion, or modifier.
// ============================================================================

import type { QuoteInput } from "./pricingEngine.ts";
import type { QuoteSessionFields } from "./quoteSession.ts";
import {
  normalizeServiceId,
  windowSidesToPricingType,
} from "./salesEngine/quoteIntakeContract.ts";

const missingNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;

type CanonicalRepairNeed =
  | "leaking_seams"
  | "loose_gutter_sections"
  | "detached_gutter_sections"
  | "loose_downspouts"
  | "detached_downspouts"
  | "none"
  | "unsure"
  | "another_repair_need";

const isCanonicalRepairNeed = (
  value: string,
): value is CanonicalRepairNeed =>
  [
    "leaking_seams",
    "loose_gutter_sections",
    "detached_gutter_sections",
    "loose_downspouts",
    "detached_downspouts",
    "none",
    "unsure",
    "another_repair_need",
  ].includes(value);

const selectedServices = (fields: QuoteSessionFields) =>
  new Set(
    (fields.services ?? [])
      .map(normalizeServiceId)
      .filter((service): service is NonNullable<typeof service> => !!service),
  );

/**
 * Build canonical engine input without applying product defaults. Callers must
 * run canonical intake evaluation before presenting the result to a customer.
 */
export function quoteSessionFieldsToQuoteInput(
  fields: QuoteSessionFields,
): QuoteInput {
  const services = selectedServices(fields);
  const windowScope = fields.windowCleaningScope;
  const standardWindows = services.has("window_cleaning") &&
    windowScope !== "partial" && windowScope !== "commercial_custom";

  const areas = fields.pressureWashingAreas ?? {};
  const area = (
    key: "frontPorch" | "backPatio" | "poolDeck" | "walkways",
  ) => ({
    enabled: areas[key]?.enabled === true,
    sqft: missingNumber(areas[key]?.sqft),
    surfaceType: areas[key]?.surfaceType,
  });

  const access = fields.solarAccessProfile;
  const additionalServices: QuoteInput["additionalServices"] = {
    windowCleaning: standardWindows,
    houseWash: services.has("house_wash"),
    houseWashDetails: fields.houseWashStainType
      ? { stainType: fields.houseWashStainType }
      : undefined,
    houseWashPatios: fields.houseWashPatios,
    gutterCleaning: services.has("gutter_cleaning"),
    gutterAddons: fields.gutterAddons
      ? {
        ...fields.gutterAddons,
        repairNeeds: fields.gutterAddons.repairNeeds?.filter(
          isCanonicalRepairNeed,
        ),
      }
      : undefined,
    roofCleaning: services.has("roof_cleaning"),
    roofType: fields.roofType,
    roofSeverity: fields.roofSeverity,
    roofRiskFlags: fields.roofRiskFlags,
    drivewayCleaning: services.has("driveway_cleaning")
      ? {
        enabled: true,
        sqft: missingNumber(fields.drivewaySqft),
        // Empty is intentional: the engine reports the missing information.
        surfaceType: fields.drivewaySurface ?? "",
      }
      : undefined,
    pressureWashing: services.has("pressure_washing")
      ? {
        enabled: true,
        surfaceType: fields.pressureWashSurface ?? "",
        frontPorch: area("frontPorch"),
        backPatio: area("backPatio"),
        poolDeck: area("poolDeck"),
        walkways: area("walkways"),
      }
      : undefined,
    solarPanelCleaning: services.has("solar_panel_cleaning")
      ? {
        enabled: true,
        panelCount: missingNumber(fields.solarPanelCount),
        stories: access?.stories,
        accessType: access?.accessType,
        knownDamage: access?.knownDamage,
        extremePitch: access?.extremePitch,
        fragileMaterial: access?.fragileMaterial,
        unusualAccess: access?.unusualAccess,
      }
      : undefined,
    screenRepair: services.has("screen_repair")
      ? {
        enabled: true,
        screenCount: missingNumber(fields.screenRepairCount),
        scopeType: fields.screenRepairScopeType,
      }
      : undefined,
  };

  return {
    homeDetails: {
      squareFootage: missingNumber(fields.squareFootage),
      stories: missingNumber(fields.stories),
      windowCleaningType: windowSidesToPricingType(
        fields.windowCleaningSides ?? fields.windowCleaningType,
      ) ?? undefined,
      condition: fields.condition,
      showAdvanced: fields.advancedWindowConditions,
      screenProfile: fields.screenProfile,
      screenProfileProvenance: fields.screenProfileProvenance,
      advancedWindowConditions: fields.advancedWindowConditions,
      hardWaterStains: fields.hardWaterStains,
      hardWaterAffectedWindowEquivalents:
        fields.hardWaterAffectedWindowEquivalents,
      frenchPanes: fields.frenchPanes,
      ladderWork: fields.ladderWork,
      ladderAffectedWindowEquivalents: fields.ladderAffectedWindowEquivalents,
      addedInteriorWindowSides: fields.addedInteriorWindowSides,
      omittedWindowSides: fields.omittedWindowSides,
      solarScreenCoverage: fields.solarScreenCoverage,
      solarScreenAffectedWindowCount: fields.solarScreenAffectedWindowCount,
      solarScreenServiceRequested: fields.solarScreenServiceRequested,
      enclosedPatioProfile: fields.enclosedPatioProfile,
      screenedEnclosureSoftWash: fields.screenedEnclosureSoftWash,
      enclosureWindowCount: fields.enclosureWindowCount,
      enclosureWindowSides: fields.enclosureWindowSides,
    },
    additionalServices,
    discount: null,
    promotion: fields.promotionId && fields.windowCount != null
      ? { id: fields.promotionId, windowCount: fields.windowCount }
      : null,
  };
}
