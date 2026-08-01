/**
 * Maps the app's UI state (HomeDetails / AdditionalServices) into the canonical
 * `QuoteInput` accepted by the `calculate-quote` Edge Function. This is a pure
 * structural mapping — it performs NO pricing math and applies NO defaults for
 * missing property details (the server decides what is missing).
 */
import type { QuoteInput } from '@/lib/pricing/engine';
import type { HomeDetails, AdditionalServices } from '@/types/homeowner';
import type { ValidatedDiscount } from '@/hooks/useDiscountCodes';

export function toQuoteInput(
  homeDetails: HomeDetails,
  additionalServices: AdditionalServices,
  discount?: ValidatedDiscount | null,
  promotion?: { id: string; windowCount: number } | null,
): QuoteInput {
  // When the customer explicitly selects the $99 promo option in the window
  // card, translate it into a canonical PromotionRequest. The engine's
  // promotion branch is authoritative and returns a flat total.
  const effectivePromotion =
    promotion && promotion.id
      ? promotion
      : homeDetails.windowCleaningType === 'promo_99'
        ? null // caller must supply the promo id — never fabricate one
        : null;
  return {
    homeDetails: {
      squareFootage: homeDetails.squareFootage,
      stories: homeDetails.stories,
      // The engine only understands 'exterior' | 'both'. When the promo is
      // selected, the promotion branch handles pricing exclusively; we still
      // pass 'exterior' so any non-promo path stays sane.
      windowCleaningType:
        homeDetails.windowCleaningType === 'promo_99' ? 'exterior' : homeDetails.windowCleaningType,
      condition: homeDetails.condition,
      showAdvanced: homeDetails.showAdvanced,
      hardWaterStains: homeDetails.hardWaterStains,
      hardWaterPercent: homeDetails.hardWaterPercent,
      frenchPanes: homeDetails.frenchPanes,
      frenchPanesPercent: homeDetails.frenchPanesPercent,
      solarScreens: homeDetails.solarScreens,
      solarScreensPercent: homeDetails.solarScreensPercent,
      ladderWork: homeDetails.ladderWork,
      ladderWorkCount: homeDetails.ladderWorkCount,
      sunroom: homeDetails.sunroom,
      screenProfile: homeDetails.screenProfile,
      screenProfileProvenance: homeDetails.screenProfileProvenance,
      solarScreenCoverage: homeDetails.solarScreenCoverage,
      solarScreenAffectedWindowCount: homeDetails.solarScreenAffectedWindowCount,
      solarScreenServiceRequested: homeDetails.solarScreenServiceRequested,
      enclosedPatioProfile: homeDetails.enclosedPatioProfile,
      screenedEnclosureSoftWash: homeDetails.screenedEnclosureSoftWash,
      enclosureWindowCount: homeDetails.enclosureWindowCount,
      enclosureWindowSides: homeDetails.enclosureWindowSides,
      advancedWindowConditions: homeDetails.advancedWindowConditions,
      hardWaterAffectedWindowEquivalents: homeDetails.hardWaterAffectedWindowEquivalents,
      ladderAffectedWindowEquivalents: homeDetails.ladderAffectedWindowEquivalents,
      addedInteriorWindowSides: homeDetails.addedInteriorWindowSides,
      omittedWindowSides: homeDetails.omittedWindowSides,
    },
    additionalServices: {
      windowCleaning: additionalServices.windowCleaning,
      houseWash: additionalServices.houseWash,
      houseWashDetails: { stainType: additionalServices.houseWashDetails?.stainType },
      gutterCleaning: additionalServices.gutterCleaning,
      gutterAddons: additionalServices.gutterAddons,
      roofCleaning: additionalServices.roofCleaning,
      roofType: additionalServices.roofType,
      roofSeverity: additionalServices.roofSeverity,
      roofRiskFlags: additionalServices.roofRiskFlags,
      drivewayCleaning: additionalServices.drivewayCleaning,
      pressureWashing: additionalServices.pressureWashing,
      solarPanelCleaning: additionalServices.solarPanelCleaning,
      screenRepair: additionalServices.screenRepair,
      houseWashPatios: additionalServices.houseWashPatios,
    },
    // The server RE-VALIDATES the code against the discount_codes table and
    // ignores any client-supplied type/value, so an invalid/expired code can
    // never alter the authoritative total.
    discount: discount ? { type: discount.type, value: discount.value, code: discount.code } : null,
    promotion: effectivePromotion,
  };
}

/** True when at least one service is selected (so a server quote is meaningful). */
export function hasAnyServiceSelected(svc: AdditionalServices): boolean {
  return (
    !!svc.windowCleaning ||
    !!svc.houseWash ||
    !!svc.gutterCleaning ||
    !!svc.roofCleaning ||
    !!svc.drivewayCleaning?.enabled ||
    !!svc.pressureWashing?.enabled ||
    !!svc.solarPanelCleaning?.enabled ||
    !!svc.screenRepair?.enabled
  );
}

/** Canonical enabled-service slugs for attribution and analytics. */
export function selectedServiceSlugs(
  svc: AdditionalServices,
): string[] {
  return [
    svc.windowCleaning && 'windowCleaning',
    svc.houseWash && 'houseWash',
    svc.gutterCleaning && 'gutterCleaning',
    svc.roofCleaning && 'roofCleaning',
    svc.drivewayCleaning?.enabled && 'drivewayCleaning',
    svc.pressureWashing?.enabled && 'pressureWashing',
    svc.solarPanelCleaning?.enabled && 'solarPanelCleaning',
    svc.screenRepair?.enabled && 'screenRepair',
  ].filter((value): value is string => typeof value === 'string');
}
