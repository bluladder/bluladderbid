import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('collapses inactive services after selection and exposes independent Edit and Remove controls', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Window Cleaning' }));

    expect(screen.getByRole('button', { name: 'Edit Window Cleaning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Window Cleaning' })).toBeInTheDocument();
    expect(screen.getByTestId('service-editor-window-cleaning')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add House Wash' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add another service' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Crystal clear windows, inside or out'));
    expect(screen.getByRole('button', { name: 'Remove Window Cleaning' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Window Cleaning' }));
    expect(screen.queryByRole('button', { name: 'Edit Window Cleaning' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Window Cleaning' })).toBeInTheDocument();
  });

  it('keeps native keyboard semantics and supports multi-service selection', () => {
    render(<Harness />);
    const windowChoice = screen.getByRole('button', { name: 'Add Window Cleaning' });
    windowChoice.focus();
    expect(document.activeElement).toBe(windowChoice);
    fireEvent.click(windowChoice, { detail: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Add another service' }));
    const houseChoice = screen.getByRole('button', { name: 'Add House Wash' });
    expect(houseChoice.tagName).toBe('BUTTON');
    fireEvent.click(houseChoice, { detail: 0 });

    expect(screen.getByRole('button', { name: 'Edit Window Cleaning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit House Wash' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Gutter Cleaning' })).toBeNull();
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

    expect(screen.getByTestId('gutter-base-price')).toHaveTextContent('Updating price…');
    expect(screen.getByTestId('gutter-service-total')).toHaveTextContent('Updating price…');
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
    ['idle', 'Updating price…'],
    ['loading', 'Updating price…'],
    ['missing_information', 'Complete home details to calculate price'],
    ['manual_review_required', 'Price requires review'],
    ['unavailable', 'Price unavailable'],
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
