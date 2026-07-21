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
import { ProgressStepper, type FlowStep } from '@/components/homeowner/ProgressStepper';
import { useServerQuoteCalculation } from '@/hooks/useServerQuoteCalculation';
import { useServerBundleTiers } from '@/hooks/useServerBundleTiers';
import { fromQuoteResult } from '@/lib/pricing/fromQuoteResult';
import { toQuoteInput, hasAnyServiceSelected } from '@/lib/pricing/toQuoteInput';
import { usePlanCustomizations } from '@/hooks/usePlanCustomizations';
import { useUtmTracking } from '@/hooks/useUtmTracking';
import { useAttribution } from '@/hooks/useAttribution';
import { useWindowPromoConfig } from '@/hooks/useWindowPromoConfig';
import { bridgeFireQuoteStarted } from '@/lib/bridge/bluladderBidPostMessage';
import { 
  HomeDetails, 
  AdditionalServices, 
  DEFAULT_HOME_DETAILS, 
  DEFAULT_ADDITIONAL_SERVICES 
} from '@/types/homeowner';
import type { CustomerInfo } from '@/components/booking/CustomerInfoForm';
import { toast } from 'sonner';

const Index = () => {
  const [searchParams] = useSearchParams();
  const embedParam = searchParams.get('embed');
  const isEmbedMode = embedParam === 'true' || embedParam === '1';
  
  // Capture UTM tracking parameters for marketing attribution
  const { getStoredUtmParams } = useUtmTracking();
  // Capture and persist first-touch/last-touch attribution + fbclid.
  useAttribution();
  
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
  
  // Stage A security lockdown: the public anonymous "look me up by email"
  // prefill card has been retired. Anonymous callers cannot pull ANY customer
  // history until the verified passwordless portal (Twilio Verify OTP + email
  // fallback) lands. The public quote/booking path continues to work as an
  // unauthenticated guest flow.
  const prefillCustomerInfo: CustomerInfo | null = null;

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
  const { promo: windowPromo } = useWindowPromoConfig();
  const promoRequest =
    windowPromo && homeDetails.windowCleaningType === 'promo_99'
      ? { id: windowPromo.promoId, windowCount: windowPromo.maxWindows }
      : null;
  const oneTimeQuote = useServerQuoteCalculation(
    hasServices ? toQuoteInput(homeDetails, additionalServices, null, promoRequest) : null,
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
    setAdditionalServices(prev => {
      const next = { ...prev, ...updates };
      // quote_started fires ONLY from this user-interaction handler, not from
      // a React effect or programmatic default state. Sender-side dedup keeps
      // it one-shot per session. Preselection via query params does NOT flow
      // through this handler and therefore cannot fire quote_started.
      if (hasAnyServiceSelected(next)) {
        const enabled: string[] = [];
        if (next.windowCleaning) enabled.push('window-cleaning');
        if (next.houseWash) enabled.push('house-wash');
        if (next.drivewayCleaning?.enabled) enabled.push('driveway-cleaning');
        if (next.gutterCleaning) enabled.push('gutter-cleaning');
        if (next.roofCleaning) enabled.push('roof-cleaning');
        if (next.solarPanelCleaning?.enabled) enabled.push('solar-panel-cleaning');
        if (next.screenRepair?.enabled) enabled.push('screen-repair');
        bridgeFireQuoteStarted({ enabledServiceSlugs: enabled });
      }
      return next;
    });
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

  // Handle book one-time
  const handleBookOneTime = () => {
    setFlowState('one-time-booking');
  };

  // Handle upgrade to plan. Fail closed if the server hasn't returned a real,
  // non-zero plan — never let the customer proceed with a $0 plan.
  const handleUpgradeAndBook = () => {
    const bundle = selectedTier
      ? customizedBundles.find((b) => b.tier === selectedTier) ?? null
      : customizedBundles.find((b) => b.tier === 'better') ?? null;
    const monthly = bundle
      ? Math.round((bundle.annualTotal - Math.round(bundle.annualTotal * 0.20)) / 11)
      : 0;
    if (!bundle || bundle.annualTotal <= 0 || monthly <= 0) {
      toast.error("We couldn't calculate this plan yet.", {
        description: 'Your one-time quote is still available. Please try again in a moment.',
      });
      return;
    }
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
          onAdditionalServicesChange={setAdditionalServices}
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
        homeDetails={homeDetails}
        onCustomizePlan={(tier, customization) => {
          setTierCustomization(tier, customization);
          toast.success(`${tier.charAt(0).toUpperCase() + tier.slice(1)} plan customized!`, {
            description: 'Your preferences have been saved.',
          });
        }}
        homeSquareFootage={homeDetails.squareFootage}
        planPhase={bundleState.phase}
        onRetryPlan={bundleState.refetch}
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

          

          <div className="animate-fade-in">
            <ProgressStepper currentStep={currentProgressStep} />
          </div>

          {/* Public guest flow — no anonymous customer history is loaded. */}
          {true && (
            <>
              {/* Home Details Form - Always visible */}
              <HomeDetailsForm 
                homeDetails={homeDetails} 
                onChange={handleHomeDetailsChange}
                formattedAddress={''}
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
                      windowPromo={windowPromo}
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
