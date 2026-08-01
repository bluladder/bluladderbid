import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanUpsellCard } from './PlanUpsellCard';
import { DEFAULT_ADDITIONAL_SERVICES } from '@/types/homeowner';
import type { BundleTier, ServicePrices } from '@/types/homeowner';

const emptyServicePrices: ServicePrices = {
  exteriorWindows: 0,
  interiorWindows: 0,
  hardWaterAddon: 0,
  frenchPanesAddon: 0,
  solarScreensAddon: 0,
  ladderWorkAddon: 0,
  sunroomAddon: 0,
  windowCleaningTotal: 0,
  drivewayCleaning: 0,
  pressureWashing: 0,
  pressureWashingBreakdown: { frontPorch: 0, backPatio: 0, poolDeck: 0, walkways: 0 },
  gutterCleaning: 0,
  gutterDrainCleaning: 0,
  gutterMinorRepairs: 0,
  gutterGuards: 0,
  gutterCleaningTotal: 0,
  houseWash: 0,
  houseWashRustSurcharge: 0,
  houseWashTotal: 0,
  roofCleaning: 250,
  solarPanelCleaning: 0,
  screenRepair: 0,
  additionalServicesTotal: 250,
  grandTotal: 250,
};

const services = { ...DEFAULT_ADDITIONAL_SERVICES, roofCleaning: true };

function makeBundle(tier: BundleTier['tier'], annual: number): BundleTier {
  return {
    name: tier === 'good' ? 'Good' : tier === 'better' ? 'Better' : 'Best',
    tier,
    label: `${tier} plan`,
    description: '',
    features: ['Feature A', 'Feature B'],
    windowFrequency: 4,
    windowFrequencyConfig: { exteriorFrequency: 4, interiorFrequency: 1 },
    additionalServicesIncluded: [],
    baseServices: [],
    availableAddons: [],
    annualTotal: annual,
    monthlyPayment: Math.round((annual - Math.round(annual * 0.20)) / 11),
    savings: 0,
    savingsPercent: 0,
    addonDiscountPercent: 0,
    addonSavings: 0,
    windowCost: 0,
    additionalServicesCost: 0,
    addonsCost: 0,
    bundleDiscount: 0,
  };
}

describe('PlanUpsellCard — fail-closed plan behavior', () => {
  it('uses only the current canonical quote for the persistent action and suppresses stale phases', () => {
    const props = {
      servicePrices: emptyServicePrices,
      additionalServices: services,
      bundles: [makeBundle('better', 1000)],
      selectedTier: 'better' as const,
      onSelectTier: () => {},
      onBookOneTime: () => {},
      onUpgradeAndBook: () => {},
      homeSquareFootage: 2500,
      planPhase: 'ready' as const,
    };
    const { rerender } = render(
      <PlanUpsellCard {...props} oneTimeTotal={250} quotePhase="firm" />,
    );
    expect(screen.getAllByRole('button', { name: 'Continue with One-Time Service · $250' })).toHaveLength(2);

    rerender(<PlanUpsellCard {...props} oneTimeTotal={275} quotePhase="estimated" />);
    expect(screen.getAllByRole('button', { name: 'Continue with One-Time Service · $275' })).toHaveLength(2);

    rerender(<PlanUpsellCard {...props} oneTimeTotal={275} quotePhase="loading" />);
    expect(screen.queryByTestId('persistent-quote-action')).toBeNull();

    rerender(<PlanUpsellCard {...props} oneTimeTotal={275} quotePhase="unavailable" />);
    expect(screen.queryByTestId('persistent-quote-action')).toBeNull();
  });

  it('keeps the canonical one-time quote above collapsed, subordinate plans', () => {
    render(
      <PlanUpsellCard
        oneTimeTotal={250}
        servicePrices={emptyServicePrices}
        additionalServices={services}
        bundles={[makeBundle('better', 1000)]}
        selectedTier="better"
        onSelectTier={() => {}}
        onBookOneTime={() => {}}
        onUpgradeAndBook={() => {}}
        homeSquareFootage={2500}
        quotePhase="firm"
        planPhase="ready"
      />,
    );
    const quoteHeading = screen.getByText('Your One-Time Quote');
    const plansToggle = screen.getByTestId('plans-toggle');
    expect(screen.queryByTestId('plan-summary')).toBeNull();
    expect(quoteHeading.compareDocumentPosition(plansToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(plansToggle);
    expect(screen.getByTestId('plan-summary')).toBeInTheDocument();
  });

  it('never renders $0/year or $0/month when the server plan is unavailable', () => {
    render(
      <PlanUpsellCard
        oneTimeTotal={250}
        servicePrices={emptyServicePrices}
        additionalServices={services}
        bundles={[]}
        selectedTier="better"
        onSelectTier={() => {}}
        onBookOneTime={() => {}}
        onUpgradeAndBook={() => {}}
        homeSquareFootage={2500}
        planPhase="unavailable"
        onRetryPlan={() => {}}
      />,
    );
    expect(screen.queryByTestId('plan-unavailable')).toBeNull();
    fireEvent.click(screen.getByTestId('plans-toggle'));
    // The plan summary block must not render at all when no valid plan exists.
    expect(screen.queryByTestId('plan-summary')).toBeNull();
    // No zero-dollar prices anywhere in the DOM.
    expect(document.body.textContent).not.toMatch(/\$0\/(year|month|mo)/i);
    // A customer-safe fail-closed message is shown.
    expect(screen.getByTestId('plan-unavailable')).toBeInTheDocument();
    // The upgrade CTA is disabled.
    const cta = screen.getByTestId('plan-upgrade-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('shows a loading indicator (not $0) while the server recalculates', () => {
    render(
      <PlanUpsellCard
        oneTimeTotal={250}
        servicePrices={emptyServicePrices}
        additionalServices={services}
        bundles={[]}
        selectedTier="better"
        onSelectTier={() => {}}
        onBookOneTime={() => {}}
        onUpgradeAndBook={() => {}}
        homeSquareFootage={2500}
        planPhase="loading"
      />,
    );
    fireEvent.click(screen.getByTestId('plans-toggle'));
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-summary')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$0\/(year|month|mo)/i);
    const cta = screen.getByTestId('plan-upgrade-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('renders the real plan summary and enables the CTA when a valid plan is returned', () => {
    const spy = vi.fn();
    render(
      <PlanUpsellCard
        oneTimeTotal={250}
        servicePrices={emptyServicePrices}
        additionalServices={services}
        bundles={[makeBundle('good', 800), makeBundle('better', 1000), makeBundle('best', 1200)]}
        selectedTier="better"
        onSelectTier={() => {}}
        onBookOneTime={() => {}}
        onUpgradeAndBook={spy}
        homeSquareFootage={2500}
        planPhase="ready"
      />,
    );
    expect(screen.queryByTestId('plan-summary')).toBeNull();
    fireEvent.click(screen.getByTestId('plans-toggle'));
    expect(screen.getByTestId('plan-summary')).toBeInTheDocument();
    const cta = screen.getByTestId('plan-upgrade-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    fireEvent.click(cta);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('never enables the CTA when the selected bundle has a zero annual total', () => {
    render(
      <PlanUpsellCard
        oneTimeTotal={250}
        servicePrices={emptyServicePrices}
        additionalServices={services}
        bundles={[makeBundle('better', 0)]}
        selectedTier="better"
        onSelectTier={() => {}}
        onBookOneTime={() => {}}
        onUpgradeAndBook={() => {}}
        homeSquareFootage={2500}
        planPhase="ready"
      />,
    );
    fireEvent.click(screen.getByTestId('plans-toggle'));
    const cta = screen.getByTestId('plan-upgrade-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(screen.queryByTestId('plan-summary')).toBeNull();
  });
});
