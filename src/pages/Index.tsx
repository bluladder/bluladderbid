import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HomeDetailsForm } from '@/components/homeowner/HomeDetailsForm';
import { IntentFirstServiceSelector } from '@/components/homeowner/IntentFirstServiceSelector';
import { PlanUpsellCard } from '@/components/homeowner/PlanUpsellCard';

import { ServicePlanSelector } from '@/components/homeowner/ServicePlanSelector';
import { PricingSummary } from '@/components/homeowner/PricingSummary';
import { OneTimeSummary } from '@/components/homeowner/OneTimeSummary';
import { CustomerLookup } from '@/components/booking/CustomerLookup';
import { PastBookings } from '@/components/booking/PastBookings';
import { ProgressStepper, type FlowStep } from '@/components/homeowner/ProgressStepper';
import { useServicePricing } from '@/hooks/useServicePricing';
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
  
  // Customer lookup state
  const [showCustomerLookup, setShowCustomerLookup] = useState(true);
  const [returningCustomer, setReturningCustomer] = useState<CustomerRecord | null>(null);
  const [pastBookings, setPastBookings] = useState<PastBooking[]>([]);
  const [prefillCustomerInfo, setPrefillCustomerInfo] = useState<CustomerInfo | null>(null);

  const { servicePrices, bundles } = useServicePricing(homeDetails, additionalServices);
  
  // Persist plan customizations across page refreshes
  const { 
    customizations, 
    setTierCustomization, 
    hasCustomization 
  } = usePlanCustomizations();

  const handleHomeDetailsChange = (updates: Partial<HomeDetails>) => {
    setHomeDetails(prev => ({ ...prev, ...updates }));
  };

  const handleAdditionalServicesChange = (updates: Partial<AdditionalServices>) => {
    setAdditionalServices(prev => ({ ...prev, ...updates }));
  };

  // Apply customizations to bundles for display
  const customizedBundles = useMemo(() => {
    return bundles.map(bundle => {
      const customization = customizations[bundle.tier];
      if (!customization) return bundle;
      
      // Calculate price adjustments from customization
      const freqConfig = customization.windowFrequency;
      const originalFreqCost = 
        servicePrices.exteriorWindows * bundle.windowFrequencyConfig.exteriorFrequency +
        servicePrices.interiorWindows * bundle.windowFrequencyConfig.interiorFrequency;
      const newFreqCost = 
        servicePrices.exteriorWindows * freqConfig.exteriorFrequency +
        servicePrices.interiorWindows * freqConfig.interiorFrequency;
      const freqDiff = newFreqCost - originalFreqCost;
      
      // Calculate service swap price impact
      const getServicePrice = (svc: string) => {
        if (svc === 'gutter_cleaning') return servicePrices.gutterCleaning;
        if (svc === 'house_wash') return servicePrices.houseWash;
        if (svc === 'roof_cleaning') return servicePrices.roofCleaning;
        return 0;
      };
      
      let serviceDiff = 0;
      for (const swap of customization.serviceSwaps) {
        serviceDiff += getServicePrice(swap.to) - getServicePrice(swap.from);
      }
      for (const added of customization.addedServices) {
        if (!customization.serviceSwaps.some(s => s.to === added)) {
          serviceDiff += getServicePrice(added);
        }
      }
      
      const newAnnualTotal = bundle.annualTotal + freqDiff + serviceDiff;
      
      return {
        ...bundle,
        windowFrequencyConfig: freqConfig,
        annualTotal: Math.round(newAnnualTotal),
        monthlyPayment: Math.round(newAnnualTotal / 12),
        isCustomized: true,
      };
    });
  }, [bundles, customizations, servicePrices]);

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
      />
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header - hidden in embed mode */}
      {!isEmbedMode && (
        <header className="border-b border-border bg-card sticky top-0 z-50">
          <div className="container py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-display font-bold text-primary">
                  BluLadder
                </h1>
                <p className="text-xs text-muted-foreground">Next Level Clean</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-foreground">Get Your Quote</p>
                <p className="text-xs text-muted-foreground">Instant pricing</p>
              </div>
            </div>
          </div>
        </header>
      )}

      <main className="container py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Hero Section */}
          <div className="text-center space-y-4 py-6">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">
              Crystal Clear Windows, <span className="text-primary">Hassle-Free</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Tell us about your home and we'll show you exactly what professional 
              cleaning services will cost — no surprises.
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
              

              {/* Intent-First Flow: Services + Upsell */}
              <div className="grid gap-8 lg:grid-cols-3">
                {/* Left Column - Service Selection */}
                <div className="lg:col-span-2 space-y-6">
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
                      onCustomizePlan={(tier, customization) => {
                        setTierCustomization(tier, customization);
                        toast.success(`${tier.charAt(0).toUpperCase() + tier.slice(1)} plan customized!`, {
                          description: 'Your preferences have been saved.',
                        });
                      }}
                    />
                  )}
                </div>
                
                {/* Right Column - Summary (sticky on desktop) */}
                <div className="lg:sticky lg:top-24 lg:self-start">
                  {renderRightColumn()}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer - hidden in embed mode */}
      {!isEmbedMode && (
        <footer className="border-t border-border mt-16">
          <div className="container py-6 text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} BluLadder • Next Level Clean
          </div>
        </footer>
      )}
    </div>
  );
};

export default Index;
