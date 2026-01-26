import { useState } from 'react';
import { HomeDetailsForm } from '@/components/homeowner/HomeDetailsForm';
import { AdditionalServicesForm } from '@/components/homeowner/AdditionalServicesForm';
import { WindowPricingDisplay } from '@/components/homeowner/WindowPricingDisplay';
import { ServiceModeSelector, type ServiceMode } from '@/components/homeowner/ServiceModeSelector';
import { ServicePlanSelector } from '@/components/homeowner/ServicePlanSelector';
import { SingleVisitServices } from '@/components/homeowner/SingleVisitServices';
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
  
  // New simplified flow state
  const [serviceMode, setServiceMode] = useState<ServiceMode>(null);
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best' | null>(null);
  const [showBookingFlow, setShowBookingFlow] = useState(false);
  
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
    setServiceMode('one-time');
    setShowBookingFlow(true);
    
    toast.success('Configuration loaded!', {
      description: 'Your previous service settings have been applied.',
    });
  };

  // Handle building a new quote from past bookings view
  const handleNewQuote = () => {
    // Keep customer info but let them build fresh
    setHomeDetails(DEFAULT_HOME_DETAILS);
    setAdditionalServices(DEFAULT_ADDITIONAL_SERVICES);
    setServiceMode(null);
    setSelectedTier(null);
    setShowBookingFlow(false);
  };

  // Reset service mode selection
  const handleBackToModeSelection = () => {
    setServiceMode(null);
    setSelectedTier(null);
    setShowBookingFlow(false);
  };

  // Show past bookings view for returning customers with booking history
  const showPastBookingsView = returningCustomer && pastBookings.length > 0 && !serviceMode;

  // Determine what to show in the right column
  const renderRightColumn = () => {
    // One-time flow with booking
    if (serviceMode === 'one-time' && showBookingFlow) {
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
    
    // One-time flow - show simplified services summary
    if (serviceMode === 'one-time') {
      return (
        <SingleVisitServices
          servicePrices={servicePrices}
          additionalServices={additionalServices}
          onBack={handleBackToModeSelection}
          onContinue={() => setShowBookingFlow(true)}
        />
      );
    }
    
    // Recurring flow with selected tier
    if (serviceMode === 'recurring' && selectedBundle) {
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
    
    // Default empty state
    return (
      <div className="card-gradient p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
          <span className="text-2xl">📋</span>
        </div>
        <h3 className="font-semibold text-foreground mb-2">
          Your Quote Summary
        </h3>
        <p className="text-sm text-muted-foreground">
          Select a service option to see your complete pricing.
        </p>
      </div>
    );
  };

  // Render the service selection area based on mode
  const renderServiceSelection = () => {
    // No mode selected - show mode selector
    if (!serviceMode) {
      return (
        <ServiceModeSelector
          selectedMode={serviceMode}
          onSelectMode={setServiceMode}
        />
      );
    }
    
    // Recurring mode - show plan selector
    if (serviceMode === 'recurring') {
      return (
        <ServicePlanSelector
          bundles={bundles}
          selectedTier={selectedTier}
          onSelectTier={setSelectedTier}
          onBack={handleBackToModeSelection}
        />
      );
    }
    
    // One-time mode - just show the forms (handled in left column)
    return null;
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

              {/* Service Mode Selection or Plan Details */}
              {!serviceMode && (
                <ServiceModeSelector
                  selectedMode={serviceMode}
                  onSelectMode={setServiceMode}
                />
              )}

              {/* Progressive disclosure based on mode */}
              {serviceMode && (
                <div className="grid gap-8 lg:grid-cols-3">
                  {/* Left Column - Mode-specific content */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Additional Services - visible for one-time */}
                    {serviceMode === 'one-time' && (
                      <AdditionalServicesForm
                        services={additionalServices}
                        servicePrices={servicePrices}
                        onChange={handleAdditionalServicesChange}
                      />
                    )}
                    
                    {/* Plan Selector - visible for recurring */}
                    {serviceMode === 'recurring' && (
                      <ServicePlanSelector
                        bundles={bundles}
                        selectedTier={selectedTier}
                        onSelectTier={setSelectedTier}
                        onBack={handleBackToModeSelection}
                      />
                    )}
                  </div>
                  
                  {/* Right Column - Summary (sticky on desktop) */}
                  <div className="lg:sticky lg:top-24 lg:self-start">
                    {renderRightColumn()}
                  </div>
                </div>
              )}
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
