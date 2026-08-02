import type { ServerQuotePhase } from '@/hooks/useServerQuoteCalculation';
import type { QuoteResult } from '@/lib/pricing/engine';
import type { AdditionalServices, ServicePrices } from '@/types/homeowner';

export type QuoteServiceId =
  | 'windowCleaning'
  | 'houseWash'
  | 'gutterCleaning'
  | 'roofCleaning'
  | 'drivewayCleaning'
  | 'pressureWashing'
  | 'solarPanelCleaning'
  | 'screenRepair';

export type QuoteServiceState = 'priced' | 'missing' | 'manual_review' | 'recalculating' | 'unavailable';

export interface ServiceQuoteReadiness {
  id: QuoteServiceId;
  state: QuoteServiceState;
  price: number;
  message: string;
}

export interface QuoteIntegrity {
  services: ServiceQuoteReadiness[];
  selectedCount: number;
  pricedCount: number;
  representedCount: number;
  firstIncompleteServiceId: QuoteServiceId | null;
  actionable: boolean;
}

const ENGINE_KEYS: Record<QuoteServiceId, string> = {
  windowCleaning: 'window_cleaning',
  houseWash: 'house_wash',
  gutterCleaning: 'gutter_cleaning',
  roofCleaning: 'roof_cleaning',
  drivewayCleaning: 'driveway_cleaning',
  pressureWashing: 'pressure_washing',
  solarPanelCleaning: 'solar_panel_cleaning',
  screenRepair: 'screen_repair',
};

export function selectedQuoteServiceIds(services: AdditionalServices): QuoteServiceId[] {
  return [
    services.windowCleaning && 'windowCleaning',
    services.houseWash && 'houseWash',
    services.gutterCleaning && 'gutterCleaning',
    services.roofCleaning && 'roofCleaning',
    services.drivewayCleaning.enabled && 'drivewayCleaning',
    services.pressureWashing.enabled && 'pressureWashing',
    services.solarPanelCleaning.enabled && 'solarPanelCleaning',
    services.screenRepair.enabled && 'screenRepair',
  ].filter((id): id is QuoteServiceId => typeof id === 'string');
}

function priceFor(id: QuoteServiceId, prices: ServicePrices): number {
  switch (id) {
    case 'windowCleaning': return prices.windowCleaningTotal;
    case 'houseWash': return prices.houseWashTotal;
    case 'gutterCleaning': return prices.gutterCleaningTotal;
    case 'roofCleaning': return prices.roofCleaning;
    case 'drivewayCleaning': return prices.drivewayCleaning;
    case 'pressureWashing': return prices.pressureWashing;
    case 'solarPanelCleaning': return prices.solarPanelCleaning;
    case 'screenRepair': return prices.screenRepair;
  }
}

function missingAppliesTo(id: QuoteServiceId, missing: readonly string[]): boolean {
  const shared = missing.some((field) => field === 'squareFootage' || field === 'stories');
  if (shared && ['windowCleaning', 'houseWash', 'gutterCleaning', 'roofCleaning'].includes(id)) return true;
  const prefixes: Record<QuoteServiceId, readonly string[]> = {
    windowCleaning: ['window', 'hardWater', 'ladder', 'addedInterior', 'omittedWindow', 'enclosure', 'screenProfile', 'solarScreen'],
    houseWash: ['houseWash', 'enclosedPatio'],
    gutterCleaning: ['gutter'],
    roofCleaning: ['roof'],
    drivewayCleaning: ['driveway'],
    pressureWashing: ['pressureWashing'],
    solarPanelCleaning: ['solarPanel', 'solarAccess'],
    screenRepair: ['screenRepair'],
  };
  return missing.some((field) => prefixes[id].some((prefix) => field.startsWith(prefix)));
}

function missingMessage(id: QuoteServiceId, missing: readonly string[]): string {
  if (missing.includes('squareFootage')) return 'Enter home square footage to calculate';
  switch (id) {
    case 'drivewayCleaning':
      return missing.includes('drivewaySqft') ? 'Select a driveway size' : 'Select a driveway surface';
    case 'pressureWashing':
      return missing.includes('pressureWashingAreas') ? 'Select at least one area' : 'Complete each selected area';
    case 'screenRepair':
      return missing.includes('screenRepairCount') ? 'Enter the number of screens' : 'Select the screen repair type';
    case 'solarPanelCleaning':
      return missing.includes('solarPanelCount') ? 'Enter the number of solar panels' : 'Confirm solar access details';
    case 'roofCleaning':
      return 'Complete roof details';
    case 'houseWash':
      return missing.includes('enclosedPatioProfile') ? 'Select enclosed patio details' :
        missing.includes('stories') ? 'Select the number of stories' : 'Complete required service details';
    case 'gutterCleaning':
    case 'windowCleaning':
      return missing.includes('stories') ? 'Select the number of stories' : 'Complete required service details';
  }
}

function manualMessage(id: QuoteServiceId): string {
  if (id === 'screenRepair') return 'Price confirmed after screen details are reviewed';
  return 'Manual review required';
}

export function evaluateQuoteIntegrity(args: {
  services: AdditionalServices;
  prices: ServicePrices;
  phase: ServerQuotePhase;
  quote: QuoteResult | null;
}): QuoteIntegrity {
  const selected = selectedQuoteServiceIds(args.services);
  const missing = args.quote?.missing ?? [];
  const manualKeys = args.quote?.manualReviewServiceKeys ?? [];
  const services = selected.map((id): ServiceQuoteReadiness => {
    const price = priceFor(id, args.prices);
    const engineKey = ENGINE_KEYS[id];
    const isManual = manualKeys.some((key) => key === engineKey || key.startsWith(`${engineKey}:`));
    if (args.phase === 'loading' || args.phase === 'idle') {
      return { id, state: 'recalculating', price: 0, message: 'Recalculating' };
    }
    if (isManual) return { id, state: 'manual_review', price: 0, message: manualMessage(id) };
    if (missingAppliesTo(id, missing)) return { id, state: 'missing', price: 0, message: missingMessage(id, missing) };
    if (price > 0) return { id, state: 'priced', price, message: '' };
    if (args.phase === 'missing_information') {
      return { id, state: 'missing', price: 0, message: 'Complete required service details' };
    }
    if (args.phase === 'manual_review_required') {
      return { id, state: 'manual_review', price: 0, message: manualMessage(id) };
    }
    return { id, state: 'unavailable', price: 0, message: 'Pricing temporarily unavailable' };
  });
  const pricedCount = services.filter((service) => service.state === 'priced').length;
  const representedCount = services.filter((service) => service.state === 'priced' || service.state === 'manual_review').length;
  const firstIncompleteServiceId = services.find((service) => service.state !== 'priced')?.id ?? null;
  return {
    services,
    selectedCount: selected.length,
    pricedCount,
    representedCount,
    firstIncompleteServiceId,
    actionable: (args.phase === 'firm' || args.phase === 'estimated') &&
      selected.length > 0 && pricedCount === selected.length && args.prices.grandTotal > 0,
  };
}
