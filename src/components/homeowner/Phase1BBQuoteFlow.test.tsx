import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OneTimeSummary } from './OneTimeSummary';
import { PlanUpsellCard } from './PlanUpsellCard';
import {
  DEFAULT_ADDITIONAL_SERVICES,
  DEFAULT_HOME_DETAILS,
  type AdditionalServices,
  type ServicePrices,
} from '@/types/homeowner';

let addonAdded = false;

vi.mock('@/hooks/useServerQuoteCalculation', () => ({
  useServerQuoteCalculation: () => {
    const lineItems = [
      {
        key: 'house_wash',
        label: 'House Wash',
        amount: 400,
        customerExplanation: 'Soft wash exterior',
        adjustments: [{ key: 'base', label: 'Soft wash exterior', kind: 'surcharge', amount: 0 }],
        minimumApplied: false,
      },
      ...(addonAdded
        ? [{
            key: 'gutter_cleaning',
            label: 'Gutter Cleaning',
            amount: 149,
            adjustments: [],
            minimumApplied: false,
          }]
        : []),
    ];
    const total = addonAdded ? 549 : 400;
    return {
      quote: {
        subtotal: total,
        total,
        estimatedTotal: total,
        discount: null,
        lineItems,
        ruleVersion: 7,
        estimatedDurationMinutes: addonAdded ? 150 : 105,
      },
      total,
      isFirm: true,
      loading: false,
      isMissingInfo: false,
      isManualReview: false,
      isUnavailable: false,
      missing: [],
      ruleVersion: 7,
      engineVersion: 'test-engine',
      refetch: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/useUpsellEstimates', () => ({
  useUpsellEstimates: () => ({ windowCleaning: null, houseWash: null, gutterCleaning: 149, roofCleaning: null }),
}));

vi.mock('@/hooks/useWindowPromoConfig', () => ({ useWindowPromoConfig: () => ({ promo: null }) }));
vi.mock('@/lib/attribution/attribution', () => ({
  getOrCreateSourceSessionId: () => 'phase-1bb-session',
  readAttribution: () => ({}),
}));
vi.mock('@/lib/attribution/metaPixel', () => ({ deriveQuoteId: () => 'phase-1bb-quote', fireLead: vi.fn() }));
vi.mock('@/lib/bridge/bluladderBidPostMessage', () => ({ bridgeFireQuoteSubmitted: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/components/booking/BookingFlow', () => ({
  BookingFlow: ({ initialStep }: { initialStep?: string }) => (
    <div data-testid="scheduling-flow" data-initial-step={initialStep}>Scheduling</div>
  ),
}));

const servicePrices: ServicePrices = {
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
  houseWash: 400,
  houseWashRustSurcharge: 0,
  houseWashTotal: 400,
  roofCleaning: 0,
  solarPanelCleaning: 0,
  screenRepair: 0,
  additionalServicesTotal: 400,
  grandTotal: 400,
};

function ReviewHarness({ onEdit = vi.fn() }: { onEdit?: () => void }) {
  const [services, setServices] = useState<AdditionalServices>({
    ...DEFAULT_ADDITIONAL_SERVICES,
    houseWash: true,
  });
  return (
    <OneTimeSummary
      servicePrices={servicePrices}
      additionalServices={services}
      homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2000 }}
      onAdditionalServicesChange={(updater) => {
        addonAdded = true;
        setServices(updater);
      }}
      onEditServices={onEdit}
    />
  );
}

function QuoteFlowHarness() {
  const [showReview, setShowReview] = useState(false);

  if (showReview) return <ReviewHarness />;

  return (
    <PlanUpsellCard
      oneTimeTotal={400}
      servicePrices={servicePrices}
      additionalServices={{ ...DEFAULT_ADDITIONAL_SERVICES, houseWash: true }}
      bundles={[]}
      selectedTier={null}
      onSelectTier={vi.fn()}
      onBookOneTime={() => setShowReview(true)}
      onUpgradeAndBook={vi.fn()}
      homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2000 }}
      homeSquareFootage={2000}
      quotePhase="firm"
      planPhase="unavailable"
    />
  );
}

describe('Phase 1B-B quote-to-scheduling flow', () => {
  beforeEach(() => {
    addonAdded = false;
  });

  it('uses the exact truthful one-time CTA without booking language or a separate price pill', () => {
    render(<QuoteFlowHarness />);
    const decision = screen.getByTestId('one-time-decision');
    const continueButton = within(decision).getByRole('button', { name: 'Continue with One-Time Service · $400' });
    expect(continueButton).toBeInTheDocument();
    expect(within(decision).queryByText(/book|schedule/i)).toBeNull();
    expect(within(decision).queryByText('$400', { selector: '.rounded-lg' })).toBeNull();

    fireEvent.click(continueButton);

    expect(screen.getByRole('heading', { name: 'Review Services & Add-ons' })).toBeInTheDocument();
    expect(screen.queryByTestId('one-time-decision')).toBeNull();
  });

  it('combines selected services, authoritative duration, optional add-ons, and the authoritative total', () => {
    render(<ReviewHarness />);
    expect(screen.getByRole('heading', { name: 'Review Services & Add-ons' })).toBeInTheDocument();
    expect(screen.getByText('House Wash')).toBeInTheDocument();
    expect(screen.getAllByText(/Soft wash exterior/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('authoritative-duration')).toHaveTextContent('About 1 hr 45 min');
    expect(screen.getAllByText('$400', { selector: '.price-display' })).toHaveLength(2);
    const addons = screen.getByRole('region', { name: 'Optional Add-ons' });
    expect(within(addons).getByText('Gutter Cleaning')).toBeInTheDocument();
    expect(within(addons).queryByText(/from \$/i)).toBeNull();
  });

  it('reprices an added service authoritatively without resetting the primary service', () => {
    render(<ReviewHarness />);
    const addons = screen.getByRole('region', { name: 'Optional Add-ons' });
    const gutterCard = within(addons).getByText('Gutter Cleaning').closest('[role="listitem"]');
    expect(gutterCard).not.toBeNull();
    fireEvent.click(within(gutterCard as HTMLElement).getByRole('button', { name: 'Add' }));
    expect(screen.getByText('House Wash')).toBeInTheDocument();
    expect(screen.getByText('Gutter Cleaning')).toBeInTheDocument();
    expect(screen.getAllByText('$549', { selector: '.price-display' })).toHaveLength(2);
    expect(screen.getByTestId('authoritative-duration')).toHaveTextContent('About 2 hr 30 min');
  });

  it('uses the exact assurance, removes internal version text, and supports Edit Services', () => {
    const onEdit = vi.fn();
    render(<ReviewHarness onEdit={onEdit} />);
    expect(screen.getByText('Your price is confirmed based on the information provided. If the actual property conditions differ materially, we’ll discuss any change with you before work begins.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/pricing version/i);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Services' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('moves directly into scheduling intake with no redundant review screen', () => {
    render(<ReviewHarness />);
    const cta = screen.getByRole('button', { name: 'Choose Appointment Time' });
    expect(cta.tagName).toBe('BUTTON');
    cta.focus();
    expect(document.activeElement).toBe(cta);
    expect(cta.className).toContain('w-full');
    fireEvent.click(cta);
    const scheduling = screen.getByTestId('scheduling-flow');
    expect(scheduling).toHaveAttribute('data-initial-step', 'info');
    expect(screen.queryByText('Review Your Services')).toBeNull();
  });
});
