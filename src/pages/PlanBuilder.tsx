import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlanBuilderHeader } from '@/components/plan-builder/PlanBuilderHeader';
import { PlanHomeDetailsForm } from '@/components/plan-builder/PlanHomeDetailsForm';
import { TierSelector } from '@/components/plan-builder/TierSelector';
import { TierCustomizer } from '@/components/plan-builder/TierCustomizer';
import { PlanPaymentSummary } from '@/components/plan-builder/PlanPaymentSummary';
import { PlanCustomerForm } from '@/components/plan-builder/PlanCustomerForm';
import { QuoteSavedSuccess } from '@/components/plan-builder/QuoteSavedSuccess';
import { useServicePlanBuilder } from '@/hooks/useServicePlanBuilder';
import { toast } from 'sonner';
import type { PlanBuilderServiceId } from '@/types/servicePlanBuilder';

type BuilderStep = 'tier' | 'details' | 'customer';

export default function PlanBuilder() {
  const [currentStep, setCurrentStep] = useState<BuilderStep>('tier');
  
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
  } = useServicePlanBuilder();
  
  const enabledServiceIds = services.filter(s => s.enabled).map(s => s.id);
  
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
  
  const handleTierSelected = () => {
    setCurrentStep('details');
  };
  
  const handleDetailsComplete = () => {
    if (homeDetails.squareFootage === 0) {
      toast.error('Please enter your home\'s square footage');
      return;
    }
    setCurrentStep('customer');
  };
  
  const handleBack = () => {
    switch (currentStep) {
      case 'details':
        setCurrentStep('tier');
        break;
      case 'customer':
        setCurrentStep('details');
        break;
    }
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading pricing...</div>
      </div>
    );
  }
  
  // Show success state if quote was saved
  if (savedQuoteId) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-8 md:py-16">
          <PlanBuilderHeader />
          <QuoteSavedSuccess 
            quoteId={savedQuoteId} 
            onCreateNew={resetQuote} 
          />
        </div>
      </div>
    );
  }
  
  // Step indicator
  const steps = [
    { id: 'tier', label: 'Choose Plan' },
    { id: 'details', label: 'Customize' },
    { id: 'customer', label: 'Your Info' },
  ];
  const currentStepIndex = steps.findIndex(s => s.id === currentStep);
  
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
        <PlanBuilderHeader />
        
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 md:gap-4">
            {steps.map((step, idx) => (
              <div key={step.id} className="flex items-center">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  idx < currentStepIndex
                    ? 'bg-success/20 text-success'
                    : idx === currentStepIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                }`}>
                  <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
                    {idx + 1}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`w-8 h-0.5 mx-1 ${
                    idx < currentStepIndex ? 'bg-success' : 'bg-muted'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Main Layout */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Back Button */}
            {currentStep !== 'tier' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-muted-foreground -ml-2"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            
            {/* Step 1: Tier Selection */}
            {currentStep === 'tier' && (
              <div className="space-y-6">
                <TierSelector
                  selectedTier={selectedTier}
                  onSelectTier={(tier) => {
                    selectTier(tier);
                    handleTierSelected();
                  }}
                  tierPrices={tierPrices}
                  hasHomeDetails={homeDetails.squareFootage > 0}
                />
              </div>
            )}
            
            {/* Step 2: Home Details + Customize */}
            {currentStep === 'details' && currentTierConfig && (
              <div className="space-y-6">
                {/* Home Details - Required first */}
                <PlanHomeDetailsForm
                  homeDetails={homeDetails}
                  onChange={updateHomeDetails}
                  enabledServices={enabledServiceIds}
                />
                
                {/* Customization - Only visible after home details */}
                {homeDetails.squareFootage > 0 && (
                  <TierCustomizer
                    tier={currentTierConfig}
                    services={services}
                    onToggleService={(id) => toggleService(id as PlanBuilderServiceId)}
                    onChangeFrequency={(id, freq) => updateFrequency(id as PlanBuilderServiceId, freq)}
                    addonDiscount={currentTierConfig.addonDiscount}
                  />
                )}
                
                <Button
                  onClick={handleDetailsComplete}
                  disabled={!hasSelectedServices || homeDetails.squareFootage === 0}
                  className="w-full md:w-auto btn-primary"
                  size="lg"
                >
                  Continue to Your Info
                </Button>
              </div>
            )}
            
            {/* Step 4: Customer Info */}
            {currentStep === 'customer' && (
              <PlanCustomerForm
                customer={customer}
                onChange={updateCustomer}
              />
            )}
          </div>
          
          {/* Sidebar - Payment Summary */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24">
              <PlanPaymentSummary
                payment={payment}
                services={services}
                isValid={isValid}
                isSaving={isSaving}
                onSubmit={handleSubmit}
                showSubmitButton={currentStep === 'customer'}
                selectedTierName={currentTierConfig?.name || 'Better'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
