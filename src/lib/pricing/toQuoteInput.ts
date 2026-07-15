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
): QuoteInput {
  return {
    homeDetails: {
      squareFootage: homeDetails.squareFootage,
      stories: homeDetails.stories,
      windowCleaningType: homeDetails.windowCleaningType,
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
      drivewayCleaning: additionalServices.drivewayCleaning,
      pressureWashing: additionalServices.pressureWashing,
      solarPanelCleaning: additionalServices.solarPanelCleaning,
      screenRepair: additionalServices.screenRepair,
    },
    // The server RE-VALIDATES the code against the discount_codes table and
    // ignores any client-supplied type/value, so an invalid/expired code can
    // never alter the authoritative total.
    discount: discount ? { type: discount.type, value: discount.value, code: discount.code } : null,
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