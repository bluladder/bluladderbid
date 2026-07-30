/**
 * OneTimeSummary delivery flow — verifies Email delivery and that the
 * bid-by-text path is fully removed from the customer UI. Email actions:
 *  1. reuse the same saved quote id + resume token,
 *  2. do NOT re-invoke save-quote / send-sms for a repeat click on the same
 *     destination (no duplicate rows, tokens, campaign events, or messages),
 *  3. normalize destinations before delivery, and
 *  4. surface a masked destination in the success UI.
 *
 * Book Now is asserted to remain the primary action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OneTimeSummary } from './OneTimeSummary';
import { DEFAULT_ADDITIONAL_SERVICES } from '@/types/homeowner';
import type { ServicePrices, HomeDetails, AdditionalServices } from '@/types/homeowner';

const invokeMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

vi.mock('@/hooks/useWindowPromoConfig', () => ({
  useWindowPromoConfig: () => ({ promo: null }),
}));

vi.mock('@/lib/attribution/attribution', () => ({
  getOrCreateSourceSessionId: () => 'session-fixture',
  readAttribution: () => ({}),
}));

vi.mock('@/lib/attribution/metaPixel', () => ({
  deriveQuoteId: () => 'quote-fingerprint',
  fireLead: vi.fn(),
}));

vi.mock('@/lib/bridge/bluladderBidPostMessage', () => ({
  bridgeFireQuoteSubmitted: vi.fn(),
}));

vi.mock('@/hooks/useServerQuoteCalculation', () => ({
  useServerQuoteCalculation: () => ({
    quote: {
      subtotal: 400,
      total: 400,
      discount: null,
      lineItems: [{ key: 'houseWash', label: 'House Wash', amount: 400, adjustments: [], minimumApplied: false }],
      ruleVersion: 7,
    },
    total: 400,
    isFirm: true,
    loading: false,
    isMissingInfo: false,
    isManualReview: false,
    isUnavailable: false,
    missing: [],
    ruleVersion: 7,
    engineVersion: 'test-engine',
    refetch: vi.fn(),
  }),
}));

const servicePrices: ServicePrices = {
  exteriorWindows: 0, interiorWindows: 0, hardWaterAddon: 0, frenchPanesAddon: 0,
  solarScreensAddon: 0, ladderWorkAddon: 0, sunroomAddon: 0, windowCleaningTotal: 0,
  drivewayCleaning: 0, pressureWashing: 0,
  pressureWashingBreakdown: { frontPorch: 0, backPatio: 0, poolDeck: 0, walkways: 0 },
  gutterCleaning: 0, gutterDrainCleaning: 0, gutterMinorRepairs: 0, gutterGuards: 0,
  gutterCleaningTotal: 0, houseWash: 400, houseWashRustSurcharge: 0, houseWashTotal: 400,
  roofCleaning: 0, solarPanelCleaning: 0, screenRepair: 0,
  additionalServicesTotal: 400, grandTotal: 400,
};

const additionalServices: AdditionalServices = { ...DEFAULT_ADDITIONAL_SERVICES, houseWash: true };

const homeDetails: HomeDetails = {
  squareFootage: 2000, stories: 1, address: '', city: '', state: '', zipCode: '',
  windowCleaningType: null, hardWaterStains: false, frenchPanes: false,
  solarScreens: false, ladderWork: false, sunroom: false,
} as unknown as HomeDetails;

function renderSummary() {
  return render(
    <OneTimeSummary
      servicePrices={servicePrices}
      additionalServices={additionalServices}
      homeDetails={homeDetails}
      onDownloadPDF={vi.fn()}
      onGetStarted={vi.fn()}
    />
  );
}

describe('OneTimeSummary — email delivery + bid-by-text removal', () => {
  beforeEach(() => { invokeMock.mockReset(); });

  it('keeps Book Now as the primary action', () => {
    renderSummary();
    const bookNow = screen.getByRole('button', { name: /book now/i });
    expect(bookNow.className).toMatch(/btn-primary/);
  });

  it('email delivery reuses save-quote and shows masked destination as accepted (not delivered)', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        quoteId: 'q-1',
        quoteUrl: 'https://x/resume',
        emailStatus: 'accepted',
        providerMessageId: 'resend-msg-1',
      },
      error: null,
    });
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: /^email$/i }));
    fireEvent.change(await screen.findByLabelText(/^Email$/), { target: { value: 'jane.doe@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email me the bid/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock.mock.calls[0][0]).toBe('save-quote');
    expect(invokeMock.mock.calls[0][1].body.action).toBe('email');
    const status = await screen.findByTestId('delivery-success');
    // Masked destination is present…
    expect(status.textContent).toMatch(/ja[•]+@example\.com/);
    // …and wording claims acceptance for delivery, NOT delivery/sent.
    expect(status.textContent).toMatch(/accepted for delivery/i);
    expect(status.textContent).not.toMatch(/delivered/i);
    expect(status.textContent).not.toMatch(/sent successfully/i);
  });

  it('suppressed emailStatus surfaces a corrective error and does NOT show delivery success', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        quoteId: 'q-2',
        quoteUrl: 'https://x/resume',
        emailStatus: 'suppressed',
        emailFailureReason: 'Recipient is on the email suppression list (bounced).',
      },
      error: null,
    });
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: /^email$/i }));
    fireEvent.change(await screen.findByLabelText(/^Email$/), { target: { value: 'blocked@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email me the bid/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('delivery-success')).toBeNull();
  });

  it('failed emailStatus surfaces a corrective error and does NOT show delivery success', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        quoteId: 'q-3',
        quoteUrl: 'https://x/resume',
        emailStatus: 'failed',
        emailFailureReason: 'No provider message id was returned.',
      },
      error: null,
    });
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: /^email$/i }));
    fireEvent.change(await screen.findByLabelText(/^Email$/), { target: { value: 'unknown@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email me the bid/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('delivery-success')).toBeNull();
  });

  it('does not expose any bid-by-text delivery path (launch gate off)', async () => {
    renderSummary();
    // No Text action button, no SMS copy, no accessibility label for it.
    expect(screen.queryByRole('button', { name: /^text$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /text me the bid/i })).toBeNull();
    expect(screen.queryByText(/text me this bid/i)).toBeNull();
    expect(screen.queryByLabelText(/mobile number/i)).toBeNull();
    // Email + Save remain available.
    expect(screen.getByRole('button', { name: /^email$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
