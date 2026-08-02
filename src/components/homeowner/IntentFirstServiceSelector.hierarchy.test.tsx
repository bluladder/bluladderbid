import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IntentFirstServiceSelector } from './IntentFirstServiceSelector';
import {
  DEFAULT_ADDITIONAL_SERVICES,
  DEFAULT_HOME_DETAILS,
  type AdditionalServices,
  type ServicePrices,
} from '@/types/homeowner';

const prices: ServicePrices = {
  exteriorWindows: 150,
  interiorWindows: 100,
  hardWaterAddon: 0,
  frenchPanesAddon: 0,
  solarScreensAddon: 0,
  ladderWorkAddon: 0,
  sunroomAddon: 0,
  windowCleaningTotal: 250,
  drivewayCleaning: 175,
  pressureWashing: 125,
  pressureWashingBreakdown: { frontPorch: 50, backPatio: 75, poolDeck: 0, walkways: 0 },
  gutterCleaning: 225,
  gutterDrainCleaning: 0,
  gutterMinorRepairs: 0,
  gutterGuards: 0,
  gutterCleaningTotal: 225,
  houseWash: 300,
  houseWashRustSurcharge: 0,
  houseWashTotal: 300,
  roofCleaning: 450,
  solarPanelCleaning: 200,
  screenRepair: 70,
  additionalServicesTotal: 0,
  grandTotal: 0,
};

type FeaturedService = NonNullable<React.ComponentProps<typeof IntentFirstServiceSelector>['featuredService']>;
type QuotePhase = React.ComponentProps<typeof IntentFirstServiceSelector>['quotePhase'];

function Harness({ initial = DEFAULT_ADDITIONAL_SERVICES, featuredService }: {
  initial?: AdditionalServices;
  featuredService?: FeaturedService;
}) {
  const [services, setServices] = useState(initial);
  const [homeDetails, setHomeDetails] = useState(DEFAULT_HOME_DETAILS);
  return (
    <IntentFirstServiceSelector
      services={services}
      servicePrices={prices}
      homeDetails={homeDetails}
      onChange={(updates) => setServices((current) => ({ ...current, ...updates }))}
      onHomeDetailsChange={(updates) => setHomeDetails((current) => ({ ...current, ...updates }))}
      featuredService={featuredService}
      windowPromo={null}
      quotePhase="firm"
    />
  );
}

describe('IntentFirstServiceSelector quote hierarchy', () => {
  it('shows the full catalog before an initial general selection', () => {
    render(<Harness />);
    const catalog = screen.getByTestId('service-catalog');
    for (const title of [
      'Window Cleaning',
      'Driveway Cleaning',
      'Pressure Washing',
      'Gutter Cleaning',
      'House Wash',
      'Roof Cleaning',
      'Solar Panel Cleaning',
      'Screen Repair',
    ]) {
      expect(within(catalog).getByRole('button', { name: `Add ${title}` })).toBeInTheDocument();
    }
  });

  it('keeps unselected services visible as compact choices after selection', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Window Cleaning' }));

    expect(screen.getByRole('button', { name: 'Edit Window Cleaning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Window Cleaning' })).toBeInTheDocument();
    expect(screen.getByTestId('service-editor-window-cleaning')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse Window Cleaning' })).toBeInTheDocument();
    expect(screen.getByTestId('compact-service-catalog')).toBeInTheDocument();
    expect(screen.getByTestId('compact-service-houseWash')).toHaveAttribute('data-variant', 'compact');
    expect(screen.getByRole('button', { name: 'Add House Wash' })).toHaveTextContent(
      'Select for pricing',
    );
    expect(screen.queryByRole('button', { name: 'Add another service' })).toBeNull();

    fireEvent.click(screen.getByText('Crystal clear windows, inside or out'));
    expect(screen.getByRole('button', { name: 'Remove Window Cleaning' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Window Cleaning' }));
    expect(screen.queryByRole('button', { name: 'Edit Window Cleaning' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Window Cleaning' })).toBeInTheDocument();
  });

  it('keeps keyboard semantics, preserves prior selections, and focuses the newest service', async () => {
    render(<Harness />);
    const windowChoice = screen.getByRole('button', { name: 'Add Window Cleaning' });
    windowChoice.focus();
    expect(document.activeElement).toBe(windowChoice);
    fireEvent.click(windowChoice, { detail: 0 });

    const houseChoice = screen.getByRole('button', { name: 'Add House Wash' });
    expect(houseChoice.tagName).toBe('BUTTON');
    expect(houseChoice).toHaveAttribute('data-variant', 'compact');
    houseChoice.focus();
    expect(document.activeElement).toBe(houseChoice);
    fireEvent.click(houseChoice, { detail: 0 });

    expect(screen.getByRole('button', { name: 'Edit Window Cleaning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit House Wash' })).toBeInTheDocument();
    expect(screen.queryByTestId('service-editor-window-cleaning')).toBeNull();
    expect(screen.getByTestId('service-editor-houseWash')).toBeInTheDocument();
    expect(screen.queryByTestId('service-editor-window-cleaning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit House Wash' }));
    expect(screen.queryByTestId('service-editor-houseWash')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit House Wash' }));
    expect(screen.getByTestId('service-editor-houseWash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Gutter Cleaning' })).toHaveAttribute(
      'data-variant',
      'compact',
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit House Wash' }));
    });
  });

  it('shows authoritative totals for every selected service summary', () => {
    render(
      <IntentFirstServiceSelector
        services={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          windowCleaning: true,
          drivewayCleaning: {
            ...DEFAULT_ADDITIONAL_SERVICES.drivewayCleaning,
            enabled: true,
          },
          pressureWashing: {
            ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
            enabled: true,
            frontPorch: { enabled: true, sqft: 100, surfaceType: 'concrete' },
          },
          gutterCleaning: true,
          houseWash: true,
          roofCleaning: true,
          solarPanelCleaning: {
            ...DEFAULT_ADDITIONAL_SERVICES.solarPanelCleaning,
            enabled: true,
          },
          screenRepair: {
            ...DEFAULT_ADDITIONAL_SERVICES.screenRepair,
            enabled: true,
          },
        }}
        servicePrices={prices}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={() => {}}
        onHomeDetailsChange={() => {}}
        windowPromo={null}
        quotePhase="firm"
      />,
    );

    const expected = [
      ['Window Cleaning', '$250'],
      ['Driveway Cleaning', '$175'],
      ['Pressure Washing', '$125'],
      ['Gutter Cleaning', '$225'],
      ['House Wash', '$300'],
      ['Roof Cleaning', '$450'],
      ['Solar Panel Cleaning', '$200'],
      ['Screen Repair', '$70'],
    ];
    const summaries = screen.getAllByTestId('selected-service-summary');
    expect(summaries).toHaveLength(expected.length);
    for (const [title, total] of expected) {
      const summary = summaries.find((candidate) => candidate.textContent?.includes(title));
      expect(summary).toBeDefined();
      expect(summary).toHaveTextContent(total);
    }
  });

  it('requires a pressure-washing area before showing an authoritative amount', () => {
    render(
      <Harness
        initial={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          pressureWashing: {
            ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
            enabled: true,
          },
        }}
        featuredService="pressureWashing"
      />,
    );

    expect(screen.getByTestId('selected-service-summary')).toHaveTextContent(
      'Select at least one area',
    );
    expect(screen.getByTestId('pressure-washing-service-total')).toHaveTextContent(
      'Select at least one area',
    );
    expect(document.body.textContent).not.toContain('$125');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Front Porch' }));
    expect(screen.getByTestId('selected-service-summary')).toHaveTextContent('$125');
    expect(screen.getByTestId('pressure-washing-service-total')).toHaveTextContent('$125');
  });

  it('suppresses stale selected-service totals while repricing', () => {
    render(
      <IntentFirstServiceSelector
        services={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          windowCleaning: true,
          drivewayCleaning: {
            ...DEFAULT_ADDITIONAL_SERVICES.drivewayCleaning,
            enabled: true,
          },
          roofCleaning: true,
          solarPanelCleaning: {
            ...DEFAULT_ADDITIONAL_SERVICES.solarPanelCleaning,
            enabled: true,
          },
          screenRepair: {
            ...DEFAULT_ADDITIONAL_SERVICES.screenRepair,
            enabled: true,
          },
        }}
        servicePrices={prices}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={() => {}}
        onHomeDetailsChange={() => {}}
        windowPromo={null}
        quotePhase="loading"
      />,
    );

    const summaries = screen.getAllByTestId('selected-service-summary');
    expect(summaries).toHaveLength(5);
    for (const summary of summaries) {
      expect(summary).toHaveTextContent('Recalculating');
      expect(summary.textContent).not.toMatch(/\$\d/);
    }
  });

  it('puts a known intended service first, selected, active, and expanded', () => {
    render(
      <Harness
        initial={{ ...DEFAULT_ADDITIONAL_SERVICES, gutterCleaning: true }}
        featuredService="gutterCleaning"
      />,
    );
    const summaries = screen.getAllByTestId('selected-service-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent('Gutter Cleaning');
    expect(screen.getByTestId('service-editor-gutterCleaning')).toBeInTheDocument();
    expect(screen.queryByTestId('service-catalog')).toBeNull();
  });

  it('shows Basic Gutter Cleaning with the authoritative base and gutter total', () => {
    render(
      <Harness
        initial={{ ...DEFAULT_ADDITIONAL_SERVICES, gutterCleaning: true }}
        featuredService="gutterCleaning"
      />,
    );

    const base = screen.getByTestId('gutter-base-selection');
    expect(within(base).getByRole('checkbox', { name: 'Basic Gutter Cleaning' })).toBeChecked();
    expect(base).toHaveTextContent('Complete gutter and downspout cleaning');
    expect(screen.getByTestId('gutter-base-price')).toHaveTextContent('$225');
    expect(screen.getByTestId('gutter-service-total')).toHaveTextContent('$225');
    expect(screen.getByTestId('selected-service-summary')).toHaveTextContent('$225');
    expect(document.body.textContent).not.toContain('Included');
  });

  it('hides stale gutter amounts and never labels an unavailable base as Included', () => {
    render(
      <IntentFirstServiceSelector
        services={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          gutterCleaning: true,
          gutterAddons: {
            ...DEFAULT_ADDITIONAL_SERVICES.gutterAddons,
            undergroundDrains: { enabled: true, count: '1' },
          },
        }}
        servicePrices={{
          ...prices,
          gutterCleaning: 225,
          gutterDrainCleaning: 100,
          gutterCleaningTotal: 325,
          grandTotal: 325,
        }}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={() => {}}
        onHomeDetailsChange={() => {}}
        featuredService="gutterCleaning"
        windowPromo={null}
        quotePhase="loading"
      />,
    );

    expect(screen.getByTestId('gutter-base-price')).toHaveTextContent('Recalculating');
    expect(screen.getByTestId('gutter-service-total')).toHaveTextContent('Recalculating');
    expect(document.body.textContent).not.toMatch(/\$100|\$225|\$325|Included/);
  });

  it('shows an authoritative add-on increase in the gutter total and selected card', () => {
    render(
      <IntentFirstServiceSelector
        services={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          gutterCleaning: true,
          gutterAddons: {
            ...DEFAULT_ADDITIONAL_SERVICES.gutterAddons,
            undergroundDrains: { enabled: true, count: '1' },
          },
        }}
        servicePrices={{
          ...prices,
          gutterCleaning: 225,
          gutterDrainCleaning: 100,
          gutterCleaningTotal: 325,
          additionalServicesTotal: 325,
          grandTotal: 325,
        }}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={() => {}}
        onHomeDetailsChange={() => {}}
        featuredService="gutterCleaning"
        windowPromo={null}
        quotePhase="firm"
      />,
    );

    expect(screen.getByTestId('gutter-base-price')).toHaveTextContent('$225');
    expect(screen.getByText('+$100')).toBeInTheDocument();
    expect(screen.getByTestId('gutter-service-total')).toHaveTextContent('$325');
    expect(screen.getByTestId('selected-service-summary')).toHaveTextContent('$325');
  });

  it('clears selected gutter add-ons when the parent service is removed', () => {
    const onChange = vi.fn();
    render(
      <IntentFirstServiceSelector
        services={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          gutterCleaning: true,
          gutterAddons: {
            undergroundDrains: { enabled: true, count: '2' },
            minorRepairs: true,
            gutterGuards: { enabled: true, linearFeet: 175 },
          },
        }}
        servicePrices={prices}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={onChange}
        onHomeDetailsChange={() => {}}
        featuredService="gutterCleaning"
        windowPromo={null}
        quotePhase="firm"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Gutter Cleaning' }));
    expect(onChange).toHaveBeenCalledWith({
      gutterCleaning: false,
      gutterAddons: {
        undergroundDrains: { enabled: false, count: '2' },
        minorRepairs: false,
        gutterGuards: { enabled: false, linearFeet: 175 },
      },
    });
  });

  it('clears active pressure-washing areas when the parent service is removed', () => {
    const onChange = vi.fn();
    const pressureWashing = {
      ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
      enabled: true,
      frontPorch: { enabled: true, sqft: 80, surfaceType: 'concrete' as const },
      backPatio: { enabled: true, sqft: 200, surfaceType: 'concrete' as const },
    };
    render(
      <IntentFirstServiceSelector
        services={{ ...DEFAULT_ADDITIONAL_SERVICES, pressureWashing }}
        servicePrices={prices}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={onChange}
        onHomeDetailsChange={() => {}}
        featuredService="pressureWashing"
        windowPromo={null}
        quotePhase="firm"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Pressure Washing' }));
    expect(onChange).toHaveBeenCalledWith({
      pressureWashing: {
        ...pressureWashing,
        enabled: false,
        frontPorch: { ...pressureWashing.frontPorch, enabled: false },
        backPatio: { ...pressureWashing.backPatio, enabled: false },
        poolDeck: { ...pressureWashing.poolDeck, enabled: false },
        walkways: { ...pressureWashing.walkways, enabled: false },
      },
    });
  });

  it('shows the required Basic House Wash row and organic cleaning as a non-interactive inclusion', () => {
    render(
      <Harness
        initial={{ ...DEFAULT_ADDITIONAL_SERVICES, houseWash: true }}
        featuredService="houseWash"
      />,
    );

    const base = screen.getByTestId('house-wash-base-selection');
    expect(within(base).getByRole('checkbox', { name: 'Basic House Wash' })).toBeChecked();
    expect(base).toHaveTextContent(
      'Organic soft washing for algae, mildew, cobwebs, dirt, and normal buildup',
    );
    expect(screen.getByTestId('house-wash-base-price')).toHaveTextContent('$300');
    expect(screen.getByTestId('house-wash-service-total')).toHaveTextContent('$300');
    expect(screen.getByTestId('selected-service-summary')).toHaveTextContent('$300');
    expect(screen.getByTestId('organic-cleaning-inclusion')).toHaveTextContent(
      'Organic Cleaning Included',
    );
    expect(screen.queryByRole('radio', { name: /Organic/i })).toBeNull();
    expect(screen.getByRole('checkbox', {
      name: /Add Rust \/ Irrigation Stain Treatment/i,
    })).not.toBeChecked();
  });

  it('models rust treatment as an optional additive surcharge from the authoritative quote', () => {
    const onChange = vi.fn();
    render(
      <IntentFirstServiceSelector
        services={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          houseWash: true,
          houseWashDetails: {
            ...DEFAULT_ADDITIONAL_SERVICES.houseWashDetails,
            stainType: 'rust',
          },
        }}
        servicePrices={{
          ...prices,
          houseWash: 300,
          houseWashRustSurcharge: 45,
          houseWashTotal: 345,
          additionalServicesTotal: 345,
          grandTotal: 345,
        }}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={onChange}
        onHomeDetailsChange={() => {}}
        featuredService="houseWash"
        windowPromo={null}
        quotePhase="firm"
      />,
    );

    const rust = screen.getByRole('checkbox', {
      name: /Add Rust \/ Irrigation Stain Treatment/i,
    });
    expect(rust).toBeChecked();
    expect(screen.getByTestId('rust-surcharge-price')).toHaveTextContent('+$45');
    expect(screen.getByTestId('house-wash-base-price')).toHaveTextContent('$300');
    expect(screen.getByTestId('house-wash-service-total')).toHaveTextContent('$345');
    expect(screen.getByTestId('selected-service-summary')).toHaveTextContent('$345');

    fireEvent.click(rust);
    expect(onChange).toHaveBeenCalledWith({
      houseWashDetails: {
        ...DEFAULT_ADDITIONAL_SERVICES.houseWashDetails,
        stainType: 'organic',
      },
    });
  });

  it.each([
    ['idle', 'Recalculating'],
    ['loading', 'Recalculating'],
    ['missing_information', 'Complete required service details'],
    ['manual_review_required', 'Manual review required'],
    ['unavailable', 'Pricing temporarily unavailable'],
  ] satisfies Array<[QuotePhase, string]>) (
    'suppresses stale House Wash amounts during %s state',
    (quotePhase, expectedStatus) => {
      render(
        <IntentFirstServiceSelector
          services={{
            ...DEFAULT_ADDITIONAL_SERVICES,
            houseWash: true,
            houseWashDetails: {
              ...DEFAULT_ADDITIONAL_SERVICES.houseWashDetails,
              stainType: 'rust',
            },
          }}
          servicePrices={{
            ...prices,
            houseWash: 300,
            houseWashRustSurcharge: 45,
            houseWashTotal: 345,
            grandTotal: 345,
          }}
          homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
          onChange={() => {}}
          onHomeDetailsChange={() => {}}
          featuredService="houseWash"
          windowPromo={null}
          quotePhase={quotePhase}
        />,
      );

      expect(screen.getByTestId('house-wash-base-price')).toHaveTextContent(expectedStatus);
      expect(screen.getByTestId('house-wash-service-total')).toHaveTextContent(expectedStatus);
      expect(screen.getByTestId('rust-surcharge-price')).toHaveTextContent(expectedStatus);
      expect(document.body.textContent).not.toMatch(/\$300|\$345|\+\$45/);
      expect(screen.getByTestId('house-wash-base-price')).not.toHaveTextContent('Included');
    },
  );

  it('removing House Wash disables rust while preserving siding preparation detail', () => {
    const onChange = vi.fn();
    render(
      <IntentFirstServiceSelector
        services={{
          ...DEFAULT_ADDITIONAL_SERVICES,
          houseWash: true,
          houseWashDetails: { sidingMaterial: 'brick', stainType: 'rust' },
        }}
        servicePrices={{
          ...prices,
          houseWash: 300,
          houseWashRustSurcharge: 45,
          houseWashTotal: 345,
        }}
        homeDetails={{ ...DEFAULT_HOME_DETAILS, squareFootage: 2500 }}
        onChange={onChange}
        onHomeDetailsChange={() => {}}
        featuredService="houseWash"
        windowPromo={null}
        quotePhase="firm"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove House Wash' }));
    expect(onChange).toHaveBeenCalledWith({
      houseWash: false,
      houseWashDetails: { sidingMaterial: 'brick', stainType: 'organic' },
    });
  });
});
