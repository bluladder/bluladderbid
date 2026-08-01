import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerFooter } from '@/components/CustomerFooter';
import { CustomerHeader } from '@/components/CustomerHeader';
import { CompactHomeDetails } from '@/components/plan-builder/CompactHomeDetails';
import { PlanBuilderHeader } from '@/components/plan-builder/PlanBuilderHeader';
import { PlanCustomizationShell } from '@/components/plan-builder/PlanCustomizationShell';
import { PlanTierCards } from '@/components/plan-builder/PlanTierCards';
import type { PlanTier } from '@/components/plan-builder/TierSelector';
import { usePlanBuilderSession } from '@/hooks/usePlanBuilderSession';
import { useServicePlanBuilder } from '@/hooks/useServicePlanBuilder';

type BuilderStep = 'select' | 'customize';

const STEPS = [
  { id: 'select', label: 'Choose Plan', number: 1 },
  { id: 'customize', label: 'Plan Preferences', number: 2 },
] as const;

export default function PlanBuilder() {
  const [currentStep, setCurrentStep] = useState<BuilderStep>('select');
  const [showHomeDetailsForm, setShowHomeDetailsForm] = useState(true);
  const [searchParams] = useSearchParams();
  const embedParam = searchParams.get('embed');
  const isEmbedMode = embedParam === 'true' || embedParam === '1';

  const { loadSession, saveSession, isInitialized, setIsInitialized } = usePlanBuilderSession();
  const {
    selectedTier,
    homeDetails,
    services,
    tierPrices,
    selectTier,
    updateHomeDetails,
    isLoading,
    pricingLoading,
    pricingUnavailable,
  } = useServicePlanBuilder();

  useEffect(() => {
    if (!isInitialized && !isLoading) {
      const session = loadSession();
      if (session?.selectedTier) selectTier(session.selectedTier);
      if (session?.homeDetails && session.homeDetails.squareFootage > 0) {
        Object.entries(session.homeDetails).forEach(([key, value]) => {
          updateHomeDetails({ [key]: value });
        });
        setShowHomeDetailsForm(false);
      }
      setIsInitialized(true);
    }
  }, [isInitialized, isLoading, loadSession, selectTier, setIsInitialized, updateHomeDetails]);

  useEffect(() => {
    if (!isInitialized) return;
    saveSession({
      selectedTier,
      homeDetails: homeDetails.squareFootage > 0 ? homeDetails : null,
      serviceSelections: services.map((service) => ({
        id: service.id,
        enabled: service.enabled,
        frequency: service.frequency,
      })),
    });
  }, [homeDetails, isInitialized, saveSession, selectedTier, services]);

  const handleTierSelect = (tier: PlanTier) => {
    selectTier(tier);
    if (homeDetails.squareFootage > 0) {
      setCurrentStep('customize');
      setShowHomeDetailsForm(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          <p className="text-muted-foreground">Loading pricing…</p>
        </div>
      </div>
    );
  }

  const currentStepIndex = STEPS.findIndex((step) => step.id === currentStep);

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader embed={isEmbedMode} />
      <main className="mx-auto max-w-7xl px-4 py-6 md:py-10">
        <PlanBuilderHeader />

        <nav aria-label="Maintenance plan progress" className="mb-8">
          <ol className="flex items-center justify-center gap-2">
            {STEPS.map((step, index) => (
              <li key={step.id} className="flex items-center">
                <div
                  aria-current={index === currentStepIndex ? 'step' : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
                    index < currentStepIndex
                      ? 'bg-success/20 text-success'
                      : index === currentStepIndex
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/10 font-bold">
                    {index < currentStepIndex ? '✓' : step.number}
                  </span>
                  <span>{step.label}</span>
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`mx-1 h-0.5 w-8 md:w-12 ${index < currentStepIndex ? 'bg-success' : 'bg-muted'}`} />
                )}
              </li>
            ))}
          </ol>
        </nav>

        {currentStep === 'customize' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCurrentStep('select')}
            className="mb-4 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Back to plan comparison
          </Button>
        )}

        {currentStep === 'select' && (
          <div className="space-y-8">
            <CompactHomeDetails
              homeDetails={homeDetails}
              onChange={updateHomeDetails}
              isExpanded={showHomeDetailsForm || homeDetails.squareFootage === 0}
              onToggleExpand={() => setShowHomeDetailsForm((expanded) => !expanded)}
            />
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

        {currentStep === 'customize' && (
          <div className="space-y-6">
            <CompactHomeDetails
              homeDetails={homeDetails}
              onChange={updateHomeDetails}
              isExpanded={showHomeDetailsForm}
              onToggleExpand={() => setShowHomeDetailsForm((expanded) => !expanded)}
            />
            <PlanCustomizationShell
              tier={selectedTier}
              price={tierPrices[selectedTier]}
              pricingLoading={pricingLoading}
              pricingUnavailable={pricingUnavailable}
            />
          </div>
        )}
      </main>
      <CustomerFooter embed={isEmbedMode} />
    </div>
  );
}
