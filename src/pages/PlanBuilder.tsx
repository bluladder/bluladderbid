import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerHeader } from '@/components/CustomerHeader';
import { CustomerFooter } from '@/components/CustomerFooter';
import { PlanBuilderHeader } from '@/components/plan-builder/PlanBuilderHeader';
import { PlanTierCards } from '@/components/plan-builder/PlanTierCards';
import { PlanCustomizationPanel } from '@/components/plan-builder/PlanCustomizationPanel';
import { CompactHomeDetails } from '@/components/plan-builder/CompactHomeDetails';
import { PlanCustomerForm } from '@/components/plan-builder/PlanCustomerForm';
import { PlanPaymentSummary } from '@/components/plan-builder/PlanPaymentSummary';
import { QuoteSavedSuccess } from '@/components/plan-builder/QuoteSavedSuccess';
import { PlanCompareSheet } from '@/components/plan-builder/PlanCompareSheet';
import { useServicePlanBuilder } from '@/hooks/useServicePlanBuilder';
import { usePlanBuilderSession } from '@/hooks/usePlanBuilderSession';
import { toast } from 'sonner';
import type { PlanBuilderServiceId } from '@/types/servicePlanBuilder';
import type { PlanTier } from '@/components/plan-builder/TierSelector';

type BuilderStep = 'select' | 'customize' | 'customer';

export default function PlanBuilder() {
  const [currentStep, setCurrentStep] = useState<BuilderStep>('select');
  const [showHomeDetailsForm, setShowHomeDetailsForm] = useState(true);
  const [showCompareSheet, setShowCompareSheet] = useState(false);
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('embed') === 'true';
  
  const { loadSession, saveSession, isInitialized, setIsInitialized } = usePlanBuilderSession();
  
  const {
    selectedTier,
    homeDetails,
    customer,
    services,
    payment,
    savedQuoteId,
    isSaving,
    tierPrices,
    currentTierConfig,
    selectTier,
    updateHomeDetails,
    updateCustomer,
    toggleService,
    updateFrequency,
    saveQuote,
    resetQuote,
    isValid,
    hasSelectedServices,
    isLoading,
    pricingReady,
    pricingLoading,
    pricingUnavailable,
  } = useServicePlanBuilder();
  
  // Restore session on mount
  useEffect(() => {
    if (!isInitialized && !isLoading) {
      const session = loadSession();
      if (session) {
        // Restore tier selection
        if (session.selectedTier) {
          selectTier(session.selectedTier);
        }
        // Restore home details
        if (session.homeDetails && session.homeDetails.squareFootage > 0) {
          Object.entries(session.homeDetails).forEach(([key, value]) => {
            updateHomeDetails({ [key]: value });
          });
          setShowHomeDetailsForm(false);
        }
      }
      setIsInitialized(true);
    }
  }, [isInitialized, isLoading, loadSession, selectTier, updateHomeDetails, setIsInitialized]);
  
  // Save session on changes
  useEffect(() => {
    if (isInitialized) {
      saveSession({
        selectedTier,
        homeDetails: homeDetails.squareFootage > 0 ? homeDetails : null,
        serviceSelections: services.map(s => ({
          id: s.id,
          enabled: s.enabled,
          frequency: s.frequency,
        })),
      });
    }
  }, [isInitialized, selectedTier, homeDetails, services, saveSession]);
  
  const handleTierSelect = (tier: PlanTier) => {
    selectTier(tier);
    // If we have home details, go straight to customization
    if (homeDetails.squareFootage > 0) {
      setCurrentStep('customize');
      setShowHomeDetailsForm(false);
    }
  };

  const handleContinueToCustomer = () => {
    if (!hasSelectedServices) {
      toast.error('Please select at least one service');
      return;
    }
    if (homeDetails.squareFootage === 0) {
      toast.error('Please enter your home square footage');
      setShowHomeDetailsForm(true);
      return;
    }
    setCurrentStep('customer');
  };

  const handleCompare = () => {
    setShowCompareSheet(true);
  };

  const handleCompareSelect = (tier: PlanTier) => {
    selectTier(tier);
    setShowCompareSheet(false);
  };

  const handleBack = () => {
    switch (currentStep) {
      case 'customize':
        setCurrentStep('select');
        break;
      case 'customer':
        setCurrentStep('customize');
        break;
    }
  };
  
  const handleSubmit = async () => {
    if (!isValid) {
      toast.error('Please complete all required fields');
      return;
    }
    
    const quoteId = await saveQuote();
    
    if (quoteId) {
      toast.success('Quote saved successfully!');
    } else {
      toast.error('Failed to save quote. Please try again.');
    }
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Loading pricing...</p>
        </div>
      </div>
    );
  }
  
  // Show success state if quote was saved
  if (savedQuoteId) {
    return (
      <div className="min-h-screen bg-background">
        <CustomerHeader embed={isEmbedMode} />
        <div className="max-w-2xl mx-auto px-4 py-8 md:py-16">
          <PlanBuilderHeader />
          <QuoteSavedSuccess 
            quoteId={savedQuoteId} 
            onCreateNew={resetQuote} 
          />
        </div>
        <CustomerFooter embed={isEmbedMode} />
      </div>
    );
  }
  
  // Progress indicator
  const steps = [
    { id: 'select', label: 'Choose Plan', number: 1 },
    { id: 'customize', label: 'Customize', number: 2 },
    { id: 'customer', label: 'Your Info', number: 3 },
  ];
  const currentStepIndex = steps.findIndex(s => s.id === currentStep);
  
  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader embed={isEmbedMode} />
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-10">
        <PlanBuilderHeader />
        
        {/* Minimal Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2">
            {steps.map((step, idx) => (
              <div key={step.id} className="flex items-center">
                <div className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all
                  ${idx < currentStepIndex
                    ? 'bg-success/20 text-success'
                    : idx === currentStepIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }
                `}>
                  <span className={`
                    w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                    ${idx < currentStepIndex 
                      ? 'bg-success text-white' 
                      : idx === currentStepIndex 
                        ? 'bg-primary-foreground/20' 
                        : 'bg-muted-foreground/20'
                    }
                  `}>
                    {idx < currentStepIndex ? '✓' : step.number}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`w-8 md:w-12 h-0.5 mx-1 ${
                    idx < currentStepIndex ? 'bg-success' : 'bg-muted'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Back Button (when not on first step) */}
        {currentStep !== 'select' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="mb-4 text-muted-foreground -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        )}

        {/* STEP 1: Plan Selection */}
        {currentStep === 'select' && (
          <div className="space-y-8">
            {/* Home Details First (Required for Pricing) */}
            <CompactHomeDetails
              homeDetails={homeDetails}
              onChange={updateHomeDetails}
              isExpanded={showHomeDetailsForm || homeDetails.squareFootage === 0}
              onToggleExpand={() => setShowHomeDetailsForm(!showHomeDetailsForm)}
            />

            {/* Tier Cards */}
            <PlanTierCards
              selectedTier={selectedTier}
              onSelectTier={handleTierSelect}
              tierPrices={tierPrices}
              hasHomeDetails={homeDetails.squareFootage > 0}
              pricingLoading={pricingLoading}
              pricingUnavailable={pricingUnavailable}
            />
          </div>
        )}

        {/* STEP 2: Customization */}
        {currentStep === 'customize' && currentTierConfig && (
          <div className="space-y-6">
            {/* Compact Home Details Summary */}
            <CompactHomeDetails
              homeDetails={homeDetails}
              onChange={updateHomeDetails}
              isExpanded={showHomeDetailsForm}
              onToggleExpand={() => setShowHomeDetailsForm(!showHomeDetailsForm)}
            />

            {/* Customization Panel */}
            <PlanCustomizationPanel
              tier={currentTierConfig}
              services={services}
              payment={payment}
              homeSquareFootage={homeDetails.squareFootage}
              onToggleService={(id) => toggleService(id as PlanBuilderServiceId)}
              onChangeFrequency={(id, freq) => updateFrequency(id as PlanBuilderServiceId, freq)}
              onContinue={handleContinueToCustomer}
              onCompare={handleCompare}
              pricingReady={pricingReady}
              pricingLoading={pricingLoading}
              pricingUnavailable={pricingUnavailable}
            />
          </div>
        )}

        {/* STEP 3: Customer Info */}
        {currentStep === 'customer' && (
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <PlanCustomerForm
                customer={customer}
                onChange={updateCustomer}
              />
            </div>
            
            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-24">
                <PlanPaymentSummary
                  payment={payment}
                  services={services}
                  isValid={isValid}
                  isSaving={isSaving}
                  onSubmit={handleSubmit}
                  showSubmitButton={true}
                  selectedTierName={currentTierConfig?.name || 'Better'}
                  pricingReady={pricingReady}
                  pricingLoading={pricingLoading}
                  pricingUnavailable={pricingUnavailable}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Plan Comparison Sheet */}
      <PlanCompareSheet
        open={showCompareSheet}
        onOpenChange={setShowCompareSheet}
        onSelectTier={handleCompareSelect}
        tierPrices={tierPrices}
        hasHomeDetails={homeDetails.squareFootage > 0}
      />
      <CustomerFooter embed={isEmbedMode} />
    </div>
  );
}
