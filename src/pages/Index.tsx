import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CustomerHeader } from '@/components/CustomerHeader';
import { CustomerFooter } from '@/components/CustomerFooter';
import { HomeDetailsForm } from '@/components/homeowner/HomeDetailsForm';
import { IntentFirstServiceSelector } from '@/components/homeowner/IntentFirstServiceSelector';
import { PlanUpsellCard } from '@/components/homeowner/PlanUpsellCard';

import { ServicePlanSelector } from '@/components/homeowner/ServicePlanSelector';
import { PricingSummary } from '@/components/homeowner/PricingSummary';
import { OneTimeSummary } from '@/components/homeowner/OneTimeSummary';
import { CustomerLookup } from '@/components/booking/CustomerLookup';
import { PastBookings } from '@/components/booking/PastBookings';
import { ProgressStepper, type FlowStep } from '@/components/homeowner/ProgressStepper';
import { useServerQuoteCalculation } from '@/hooks/useServerQuoteCalculation';
import { useServerBundleTiers } from '@/hooks/useServerBundleTiers';
import { fromQuoteResult } from '@/lib/pricing/fromQuoteResult';
import { toQuoteInput, hasAnyServiceSelected } from '@/lib/pricing/toQuoteInput';
import { usePlanCustomizations } from '@/hooks/usePlanCustomizations';
import { useUtmTracking } from '@/hooks/useUtmTracking';
import { 
  HomeDetails, 
  AdditionalServices, 
  DEFAULT_HOME_DETAILS, 
  DEFAULT_ADDITIONAL_SERVICES 
} from '@/types/homeowner';
import type { CustomerLookupResult, PastBooking, CustomerRecord } from '@/hooks/useCustomerLookup';
import type { CustomerInfo } from '@/components/booking/CustomerInfoForm';
import { toast } from 'sonner';

const Index = () => {
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('embed') === 'true';
  
  // Capture UTM tracking parameters for marketing attribution
  const { getStoredUtmParams } = useUtmTracking();
  
  const [homeDetails, setHomeDetails] = useState<HomeDetails>(DEFAULT_HOME_DETAILS);
  const [additionalServices, setAdditionalServices] = useState<AdditionalServices>(DEFAULT_ADDITIONAL_SERVICES);
  
  // Intent-first flow state: 
  // - 'selecting': User is selecting services (default)
  // - 'one-time-booking': User chose one-time, proceed to booking
  // - 'plan-selected': User chose a plan, show confirmation
  // - 'plan-expanded': User wants to see all plan options
  type FlowState = 'selecting' | 'one-time-booking' | 'plan-selected' | 'plan-expanded';
  const [flowState, setFlowState] = useState<FlowState>('selecting');
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best' | null>('better');
  // True once the customer opens the full booking flow (info → time → confirm),
  // so the layout can widen and center it instead of cramming it in the sidebar.
  const [bookingActive, setBookingActive] = useState(false);
  
  // Customer lookup state
  const [showCustomerLookup, setShowCustomerLookup] = useState(true);
  const [returningCustomer, setReturningCustomer] = useState<CustomerRecord | null>(null);
  const [pastBookings, setPastBookings] = useState<PastBooking[]>([]);
  const [prefillCustomerInfo, setPrefillCustomerInfo] = useState<CustomerInfo | null>(null);

  // Persist plan customizations across page refreshes
  const { 
    customizations, 
    setTierCustomization, 
    hasCustomization 
  } = usePlanCustomizations();

  // AUTHORITATIVE pricing — one-time totals AND the Good/Better/Best tiers come
  // ONLY from the deployed pricing Edge Functions (calculate-quote /
  // calculate-plan-options bundle_tiers). No local pricing math, no fallback.
  const hasServices = hasAnyServiceSelected(additionalServices);
  const oneTimeQuote = useServerQuoteCalculation(
    hasServices ? toQuoteInput(homeDetails, additionalServices) : null,
    { enabled: hasServices },
  );
  const servicePrices = useMemo(
    () => fromQuoteResult(oneTimeQuote.quote),
    [oneTimeQuote.quote],
  );
  const bundleState = useServerBundleTiers(
    hasServices ? { homeDetails, additionalServices, customizations } : null,
    { enabled: hasServices },
  );
  const bundles = bundleState.bundles;

  const handleHomeDetailsChange = (updates: Partial<HomeDetails>) => {
    setHomeDetails(prev => ({ ...prev, ...updates }));
  };

  const handleAdditionalServicesChange = (updates: Partial<AdditionalServices>) => {
    setAdditionalServices(prev => ({ ...prev, ...updates }));
  };

  // Tier customizations are applied SERVER-SIDE (sent to calculate-plan-options
  // via useServerBundleTiers), so the returned tiers are already customized.
  // No local customization delta math.
  const customizedBundles = bundles;

  // Get selected bundle for recurring plans
  const selectedBundle = selectedTier 
    ? customizedBundles.find(b => b.tier === selectedTier) || null 
    : null;

  const handleDownloadPDF = () => {
    toast.success('Your proposal is being generated...', {
      description: 'The PDF will download shortly.',
    });
  };

  const handleGetStarted = () => {
    toast.success('Great choice!', {
      description: 'We\'ll be in touch to schedule your first service.',
    });
  };

  // Handle customer found from lookup
  const handleCustomerFound = (result: CustomerLookupResult) => {
    setReturningCustomer(result.customer);
    setPastBookings(result.bookings);
    setShowCustomerLookup(false);
    
    // Pre-fill customer info for faster checkout
    setPrefillCustomerInfo({
      firstName: result.customer.firstName || '',
      lastName: result.customer.lastName || '',
      email: result.customer.email,
      phone: result.customer.phone || '',
      address: result.customer.address || '',
    });
    
    toast.success(`Welcome back, ${result.customer.firstName || 'valued customer'}!`);
  };

  // Handle new customer (skip lookup)
  const handleNewCustomer = () => {
    setShowCustomerLookup(false);
    setReturningCustomer(null);
    setPastBookings([]);
    setPrefillCustomerInfo(null);
  };

  // Handle Book Again - preload configuration
  const handleBookAgain = (booking: PastBooking) => {
    // Load the home details from the past booking
    setHomeDetails(booking.homeDetails);
    setAdditionalServices(booking.additionalServices);
    setFlowState('one-time-booking');
    
    toast.success('Configuration loaded!', {
      description: 'Your previous service settings have been applied.',
    });
  };

  // Handle building a new quote from past bookings view
  const handleNewQuote = () => {
    // Keep customer info but let them build fresh
    setHomeDetails(DEFAULT_HOME_DETAILS);
    setAdditionalServices(DEFAULT_ADDITIONAL_SERVICES);
    setFlowState('selecting');
    setSelectedTier('better');
  };

  // Handle book one-time
  const handleBookOneTime = () => {
    setFlowState('one-time-booking');
  };

  // Handle upgrade to plan
  const handleUpgradeAndBook = () => {
    setFlowState('plan-selected');
  };

  // Handle tier selection from expanded view
  const handleTierSelect = (tier: 'good' | 'better' | 'best') => {
    setSelectedTier(tier);
  };

  // Reset to service selection
  const handleBackToSelection = () => {
    setFlowState('selecting');
  };

  // Show past bookings view for returning customers with booking history
  const showPastBookingsView = returningCustomer && pastBookings.length > 0 && flowState === 'selecting';

  // Map flow state to progress step
  const currentProgressStep = useMemo<FlowStep>(() => {
    if (flowState === 'selecting') return 'services';
    if (flowState === 'one-time-booking' || flowState === 'plan-selected') return 'quote';
    return 'book';
  }, [flowState]);

  // Determine what to show in the right column
  const renderRightColumn = () => {
    // One-time booking flow
    if (flowState === 'one-time-booking') {
      return (
        <OneTimeSummary
          servicePrices={servicePrices}
          additionalServices={additionalServices}
          homeDetails={homeDetails}
          onDownloadPDF={handleDownloadPDF}
          onGetStarted={handleGetStarted}
          prefillCustomerInfo={prefillCustomerInfo}
          onBookingActiveChange={setBookingActive}
        />
      );
    }
    
    // Plan selected - show pricing summary
    if (flowState === 'plan-selected' && selectedBundle) {
      return (
        <PricingSummary
          servicePrices={servicePrices}
          selectedBundle={selectedBundle}
          homeDetails={homeDetails}
          additionalServices={additionalServices}
          engineVersion={bundleState.engineVersion}
          ruleVersion={bundleState.ruleVersion}
          customizations={customizations}
          onDownloadPDF={handleDownloadPDF}
          onGetStarted={handleGetStarted}
          prefillCustomerInfo={prefillCustomerInfo}
        />
      );
    }
    
    // Default: show intent-first upsell card
    return (
      <PlanUpsellCard
        oneTimeTotal={servicePrices.grandTotal}
        servicePrices={servicePrices}
        additionalServices={additionalServices}
        bundles={bundles}
        selectedTier={selectedTier}
        onSelectTier={handleTierSelect}
        onBookOneTime={handleBookOneTime}
        onUpgradeAndBook={handleUpgradeAndBook}
        homeSquareFootage={homeDetails.squareFootage}
      />
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader embed={isEmbedMode} />

      <main className="container py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Hero Section */}
          <div className="text-center space-y-4 py-6">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-foreground text-balance">
              A Cleaner Home, <span className="text-primary">Hassle-Free</span>
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
              Windows, gutters, house washing, roofs, and more. Tell us about your
              home and we'll show you exactly what professional cleaning will cost —
              no surprises.
            </p>
          </div>

          

          {/* Progress Stepper (shown after customer lookup) */}
          {!showCustomerLookup && !showPastBookingsView && (
            <div className="animate-fade-in">
              <ProgressStepper currentStep={currentProgressStep} />
            </div>
          )}

          {/* Customer Lookup (shown initially) */}
          {showCustomerLookup && (
            <div className="max-w-md mx-auto">
              <CustomerLookup
                onCustomerFound={handleCustomerFound}
                onNewCustomer={handleNewCustomer}
              />
            </div>
          )}

          {/* Past Bookings View (for returning customers) */}
          {showPastBookingsView && (
            <div className="max-w-lg mx-auto">
              <PastBookings
                customer={returningCustomer}
                bookings={pastBookings}
                onBookAgain={handleBookAgain}
                onNewQuote={handleNewQuote}
              />
            </div>
          )}

          {/* Main Content (shown after lookup or for new customers) */}
          {!showCustomerLookup && !showPastBookingsView && (
            <>
              {/* Home Details Form - Always visible */}
              <HomeDetailsForm 
                homeDetails={homeDetails} 
                onChange={handleHomeDetailsChange} 
              />
              

              {/* When the full booking flow is open, give it a prominent, centered,
                  wide layout instead of squeezing it into the sidebar column.
                  The booking content is rendered ONCE in a stably-keyed wrapper so
                  that toggling the layout never remounts it (which would reset the
                  in-progress booking flow state). */}
              <div
                className={
                  bookingActive
                    ? 'flex justify-center'
                    : 'grid gap-8 lg:grid-cols-3'
                }
              >
                {/* Left Column - Service Selection (hidden once booking is active) */}
                {!bookingActive && (
                <div key="services-column" className="lg:col-span-2 space-y-6 min-w-0">
                  {/* Back button when in booking/plan flows */}
                  {flowState !== 'selecting' && (
                    <button
                      onClick={handleBackToSelection}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>←</span>
                      <span>Back to services</span>
                    </button>
                  )}
                  
                  {/* Service Selector - always visible in selecting state */}
                  {flowState === 'selecting' && (
                    <IntentFirstServiceSelector
                      services={additionalServices}
                      servicePrices={servicePrices}
                      homeDetails={homeDetails}
                      onChange={handleAdditionalServicesChange}
                      onHomeDetailsChange={handleHomeDetailsChange}
                    />
                  )}
                  
                  {/* Plan Selector - shown when user wants to see all plans */}
                  {flowState === 'plan-expanded' && (
                    <ServicePlanSelector
                      bundles={customizedBundles}
                      selectedTier={selectedTier}
                      onSelectTier={(tier) => {
                        setSelectedTier(tier);
                        setFlowState('plan-selected');
                      }}
                      onBack={handleBackToSelection}
                      baseExteriorPrice={servicePrices.exteriorWindows}
                      baseInteriorPrice={servicePrices.interiorWindows}
                      servicePrices={{
                        gutterCleaning: servicePrices.gutterCleaning,
                        houseWash: servicePrices.houseWash,
                        roofCleaning: servicePrices.roofCleaning,
                      }}
                      homeDetails={homeDetails}
                      additionalServices={additionalServices}
                      onCustomizePlan={(tier, customization) => {
                        setTierCustomization(tier, customization);
                        toast.success(`${tier.charAt(0).toUpperCase() + tier.slice(1)} plan customized!`, {
                          description: 'Your preferences have been saved.',
                        });
                      }}
                    />
                  )}
                </div>
                )}

                {/* Booking / summary content — rendered once, keyed so it persists
                    across the layout switch. Centered & full-width when booking is
                    active (consistent on mobile and desktop); sticky sidebar otherwise. */}
                <div
                  key="booking-content"
                  className={
                    bookingActive
                      ? 'w-full max-w-2xl mx-auto min-w-0'
                      : 'lg:sticky lg:top-24 lg:self-start min-w-0'
                  }
                >
                  {renderRightColumn()}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <CustomerFooter embed={isEmbedMode} />
    </div>
  );
};

export default Index;
