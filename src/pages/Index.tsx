import { useState } from 'react';
import { HomeDetailsForm } from '@/components/homeowner/HomeDetailsForm';
import { IntentFirstServiceSelector } from '@/components/homeowner/IntentFirstServiceSelector';
import { PlanUpsellCard } from '@/components/homeowner/PlanUpsellCard';
import { WindowPricingDisplay } from '@/components/homeowner/WindowPricingDisplay';
import { ServicePlanSelector } from '@/components/homeowner/ServicePlanSelector';
import { PricingSummary } from '@/components/homeowner/PricingSummary';
import { OneTimeSummary } from '@/components/homeowner/OneTimeSummary';
import { CustomerLookup } from '@/components/booking/CustomerLookup';
import { PastBookings } from '@/components/booking/PastBookings';
import { useServicePricing } from '@/hooks/useServicePricing';
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

  const handleHomeDetailsChange = (updates: Partial<HomeDetails>) => {
    setHomeDetails(prev => ({ ...prev, ...updates }));
  };

  const handleAdditionalServicesChange = (updates: Partial<AdditionalServices>) => {
    setAdditionalServices(prev => ({ ...prev, ...updates }));
  };

  // Get selected bundle for recurring plans
  const selectedBundle = selectedTier 
    ? bundles.find(b => b.tier === selectedTier) || null 
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
      {/* Header */}
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
              
              {/* Window Pricing Display */}
              <WindowPricingDisplay servicePrices={servicePrices} />

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
                      onChange={handleAdditionalServicesChange}
                    />
                  )}
                  
                  {/* Plan Selector - shown when user wants to see all plans */}
                  {flowState === 'plan-expanded' && (
                    <ServicePlanSelector
                      bundles={bundles}
                      selectedTier={selectedTier}
                      onSelectTier={(tier) => {
                        setSelectedTier(tier);
                        setFlowState('plan-selected');
                      }}
                      onBack={handleBackToSelection}
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

      {/* Footer */}
      <footer className="border-t border-border mt-16">
        <div className="container py-6 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} BluLadder • Next Level Clean
        </div>
      </footer>
    </div>
  );
};

export default Index;
