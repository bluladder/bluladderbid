import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompactHomeDetails } from './CompactHomeDetails';
import { PlanTierCards } from './PlanTierCards';
import { MAINTENANCE_PLAN_DEFINITIONS, PLAN_DISCOUNT_EXCLUSIONS } from './maintenancePlanDefinitions';
import { PlanCustomizationShell } from './PlanCustomizationShell';
import { FIRST_VISIT_NOTE_LIMIT, sanitizeFirstVisitNote } from './planPresentationInput';
import { DEFAULT_PLAN_HOME_DETAILS, type ServicePlanTierPrice } from '@/types/servicePlanBuilder';
import type { PlanTier } from './TierSelector';

const AVAILABLE_PRICES: Record<PlanTier, ServicePlanTierPrice> = {
  good: {
    firstPayment: 240,
    monthlyPayment: 87.27,
    remainingPaymentCount: 11,
    annualTotal: 1200,
    estimatedSavings: 180,
  },
  better: {
    firstPayment: 400,
    monthlyPayment: 145.45,
    remainingPaymentCount: 11,
    annualTotal: 2000,
    estimatedSavings: 300,
  },
  best: {
    firstPayment: 600,
    monthlyPayment: 218.18,
    remainingPaymentCount: 11,
    annualTotal: 3000,
    estimatedSavings: 500,
  },
};

const UNAVAILABLE_PRICE: ServicePlanTierPrice = {
  firstPayment: null,
  monthlyPayment: null,
  remainingPaymentCount: null,
  annualTotal: null,
  estimatedSavings: null,
};

function renderPlans(prices = AVAILABLE_PRICES) {
  return render(
    <PlanTierCards
      selectedTier="better"
      onSelectTier={vi.fn()}
      tierPrices={prices}
      hasHomeDetails
    />,
  );
}

describe('D1A maintenance plan presentation', () => {
  it('uses the approved public names and marks Signature as recommended', () => {
    renderPlans();

    expect(screen.getAllByText('Essential Window Care').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Signature Home Care').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Next Level Clean').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Recommended').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Good$/)).toBeNull();
    expect(screen.queryByText(/^Better$/)).toBeNull();
    expect(screen.queryByText(/^Best$/)).toBeNull();
  });

  it('provides keyboard-operable mobile tabs with one active plan panel', async () => {
    renderPlans();
    const tabs = screen.getByTestId('mobile-plan-tabs');
    const signature = within(tabs).getByRole('tab', { name: 'Signature' });
    const nextLevel = within(tabs).getByRole('tab', { name: 'Next Level' });

    await act(async () => {
      signature.focus();
      fireEvent.keyDown(signature, { key: 'ArrowRight' });
      await Promise.resolve();
    });

    expect(nextLevel).toHaveAttribute('data-state', 'active');
    expect(nextLevel).toHaveFocus();
    expect(within(tabs).getByRole('tabpanel')).toHaveTextContent('Next Level Clean');
  });

  it('uses a dedicated desktop comparison-label column and the required rows', () => {
    renderPlans();
    const comparison = screen.getByTestId('desktop-plan-comparison');

    expect(within(comparison).getByRole('columnheader', { name: 'Service or Benefit' })).toBeInTheDocument();
    expect(within(comparison).getByRole('rowheader', { name: 'Exterior windows' })).toBeInTheDocument();
    expect(within(comparison).getByRole('rowheader', { name: 'First payment' })).toBeInTheDocument();
    expect(comparison.className).not.toContain('overflow-x');
  });

  it('shows authoritative first, monthly, annual and savings values without client calculation', () => {
    renderPlans();
    const mobile = screen.getByTestId('mobile-plan-tabs');

    expect(within(mobile).getByText('$400 due at enrollment')).toBeInTheDocument();
    expect(within(mobile).getByText('Then 11 monthly payments of $145.45')).toBeInTheDocument();
    expect(within(mobile).getByText('Annual plan total: $2,000')).toBeInTheDocument();
    expect(within(mobile).getByText('Estimated annual savings: $300')).toBeInTheDocument();
  });

  it('fails closed when authoritative payment or savings values are unavailable', () => {
    const unavailablePrices = {
      good: UNAVAILABLE_PRICE,
      better: UNAVAILABLE_PRICE,
      best: UNAVAILABLE_PRICE,
    };
    renderPlans(unavailablePrices);
    const mobile = screen.getByTestId('mobile-plan-tabs');

    expect(within(mobile).getByText('First payment: Pending authoritative pricing')).toBeInTheDocument();
    expect(within(mobile).getByText('Remaining monthly payments: Pending authoritative pricing')).toBeInTheDocument();
    expect(within(mobile).getByText('Annual plan total: Pending authoritative pricing')).toBeInTheDocument();
    expect(within(mobile).getByText('Estimated annual savings: Pending authoritative savings')).toBeInTheDocument();
  });

  it('presents the approved tier guarantees, discounts and exact exclusions', () => {
    expect(MAINTENANCE_PLAN_DEFINITIONS.good.guarantee).toBe('14-day touch-up guarantee');
    expect(MAINTENANCE_PLAN_DEFINITIONS.better.guarantee).toBe('14-day touch-up guarantee');
    expect(MAINTENANCE_PLAN_DEFINITIONS.best.guarantee).toBe('Unlimited qualifying window touch-ups');
    expect(MAINTENANCE_PLAN_DEFINITIONS.good.discount).toBe('Save 5% on eligible additional services');
    expect(MAINTENANCE_PLAN_DEFINITIONS.better.discount).toBe('Save 5% on eligible additional services');
    expect(MAINTENANCE_PLAN_DEFINITIONS.best.discount).toBe('Save 10% on eligible additional services');
    expect(PLAN_DISCOUNT_EXCLUSIONS).toBe(
      'Additional-service discounts exclude Christmas lights, gutter repairs and gutter-guard installation.',
    );
  });

  it('does not advertise an unapproved square-foot pressure-washing allowance', () => {
    renderPlans();
    expect(screen.getAllByText('Additional pressure-washing benefit available').length).toBeGreaterThan(0);
    expect(screen.queryByText(/1,000\s*sq/i)).toBeNull();
  });
});

describe('D1A customization presentation shell', () => {
  it('keeps the optional note in client state without altering authoritative price', () => {
    render(<PlanCustomizationShell tier="good" price={AVAILABLE_PRICES.good} />);
    const note = screen.getByLabelText('Does anything need extra attention on the first visit?');

    expect(screen.getByText('$240 due at enrollment')).toBeInTheDocument();
    const enteredNote = '<script>price=1</script> hard-water spot';
    fireEvent.change(note, { target: { value: enteredNote } });

    expect(note).toHaveValue(enteredNote);
    expect(screen.getByText('$240 due at enrollment')).toBeInTheDocument();
    expect(screen.getByText(`${FIRST_VISIT_NOTE_LIMIT - enteredNote.length} characters remaining`)).toBeInTheDocument();
  });

  it('normalizes, strips control characters and limits first-visit note length', () => {
    expect(sanitizeFirstVisitNote(`  note\u0000\u0007  `)).toBe('  note  ');
    expect(sanitizeFirstVisitNote('a'.repeat(FIRST_VISIT_NOTE_LIMIT + 20))).toHaveLength(FIRST_VISIT_NOTE_LIMIT);
  });

  it('labels scheduling fields as non-guaranteed preferences and disables incomplete controls', () => {
    render(<PlanCustomizationShell tier="better" price={AVAILABLE_PRICES.better} />);

    expect(screen.getByLabelText('Important date or event')).toBeInTheDocument();
    expect(screen.getByLabelText('Which service is most urgent?')).toBeInTheDocument();
    expect(screen.getByLabelText('Preferred month or season')).toBeInTheDocument();
    expect(screen.getByLabelText('Months or dates to avoid')).toBeInTheDocument();
    expect(screen.getByLabelText('Additional scheduling notes')).toBeInTheDocument();
    expect(screen.getByText('These are preferences, not appointments. BluLadder will contact you to confirm the exact service schedule after you submit your plan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue — Coming next' })).toBeDisabled();
  });

  it('removes Current Condition and Heavy Cleaning from the rendered plan pricing UI', () => {
    render(
      <CompactHomeDetails
        homeDetails={{ ...DEFAULT_PLAN_HOME_DETAILS, squareFootage: 2500 }}
        onChange={vi.fn()}
        isExpanded
      />,
    );

    expect(screen.queryByText('Current Condition')).toBeNull();
    expect(screen.queryByText('Regular Maintenance')).toBeNull();
    expect(screen.queryByText('Heavy Cleaning')).toBeNull();
  });
});
