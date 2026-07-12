import { useState, useMemo, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
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
import { 
  HomeDetails, 
  AdditionalServices, 
  DEFAULT_HOME_DETAILS, 
  DEFAULT_ADDITIONAL_SERVICES 
} from '@/types/homeowner';
import { toast } from 'sonner';
import { Sparkles, Droplets, Home, TreeDeciduous, Sun, ArrowLeft } from 'lucide-react';

// Service configuration for each landing page
const SERVICE_CONFIG = {
  'window-cleaning': {
    title: 'Professional Window Cleaning',
    subtitle: 'Crystal clear views, guaranteed',
    description: 'Get sparkling clean windows with our professional service. We handle everything from single-story homes to multi-level properties.',
    icon: Sparkles,
    heroColor: 'from-sky-500 to-cyan-400',
    preSelectService: 'windowCleaning' as const,
  },
  'gutter-cleaning': {
    title: 'Gutter Cleaning Services',
    subtitle: 'Protect your home from water damage',
    description: 'Keep your gutters flowing freely with our thorough cleaning service. We remove leaves, debris, and ensure proper drainage.',
    icon: Home,
    heroColor: 'from-amber-500 to-orange-400',
    preSelectService: 'gutterCleaning' as const,
  },
  'house-wash': {
    title: 'House Washing Services',
    subtitle: 'Restore your home\'s curb appeal',
    description: 'Our soft wash technique safely removes dirt, algae, and mildew from your home\'s exterior without damaging surfaces.',
    icon: Droplets,
    heroColor: 'from-emerald-500 to-teal-400',
    preSelectService: 'houseWash' as const,
  },
  'roof-cleaning': {
    title: 'Roof Cleaning Services',
    subtitle: 'Extend your roof\'s lifespan',
    description: 'Remove unsightly algae, moss, and debris from your roof with our safe, effective cleaning methods.',
    icon: TreeDeciduous,
    heroColor: 'from-slate-600 to-zinc-500',
    preSelectService: 'roofCleaning' as const,
  },
  'driveway-cleaning': {
    title: 'Driveway Cleaning Services',
    subtitle: 'Make your driveway look brand new',
    description: 'Our high-pressure cleaning removes oil stains, dirt, and grime from driveways, walkways, and patios.',
    icon: Sun,
    heroColor: 'from-violet-500 to-purple-400',
    preSelectService: 'drivewayCleaning' as const,
  },
  'pressure-washing': {
    title: 'Pressure Washing Services',
    subtitle: 'Power away dirt and grime',
    description: 'Professional pressure washing for patios, decks, walkways, and more. Restore surfaces to their original beauty.',
    icon: Droplets,
    heroColor: 'from-blue-500 to-indigo-400',
    preSelectService: 'pressureWashing' as const,
  },
} as const;

type ServiceSlug = keyof typeof SERVICE_CONFIG;

const ServiceLanding = () => {
  // Get service from URL path (e.g., /window-cleaning -> window-cleaning)
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const service = location.pathname.substring(1); // Remove leading slash
  const config = SERVICE_CONFIG[service as ServiceSlug];
  const isEmbedMode = searchParams.get('embed') === 'true';
  
  // Capture UTM tracking parameters for marketing attribution
  const { getStoredUtmParams } = useUtmTracking();
  
  // Optional URL param to preselect a specific service (e.g., ?preset=roofCleaning)
  const presetParam = searchParams.get('preset') as 
    | 'windowCleaning' | 'gutterCleaning' | 'houseWash' | 'roofCleaning' | 'drivewayCleaning' | 'pressureWashing' 
    | null;
  
  // Determine which service to preselect: URL param takes priority over route default
  const effectivePreselect = presetParam || config?.preSelectService;
  
  const getLandingDefaultAdditionalServices = (
    preSelectService?: 'windowCleaning' | 'gutterCleaning' | 'houseWash' | 'roofCleaning' | 'drivewayCleaning' | 'pressureWashing'
  ): AdditionalServices => {
    // Deep-ish clone so we never mutate the exported defaults (nested objects exist)
    const base: AdditionalServices = {
      ...DEFAULT_ADDITIONAL_SERVICES,
      drivewayCleaning: { ...DEFAULT_ADDITIONAL_SERVICES.drivewayCleaning },
      pressureWashing: {
        ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
        frontPorch: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing.frontPorch },
        backPatio: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing.backPatio },
        poolDeck: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing.poolDeck },
        walkways: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing.walkways },
      },
    };

    switch (preSelectService) {
      case 'windowCleaning':
        base.windowCleaning = true;
        break;
      case 'gutterCleaning':
        base.gutterCleaning = true;
        break;
      case 'houseWash':
        base.houseWash = true;
        break;
      case 'roofCleaning':
        base.roofCleaning = true;
        break;
      case 'drivewayCleaning':
        base.drivewayCleaning = { ...base.drivewayCleaning, enabled: true };
        break;
      case 'pressureWashing':
        base.pressureWashing = { ...base.pressureWashing, enabled: true };
        break;
      default:
        break;
    }

    return base;
  };
  
  const [homeDetails, setHomeDetails] = useState<HomeDetails>(DEFAULT_HOME_DETAILS);
  const [additionalServices, setAdditionalServices] = useState<AdditionalServices>(() =>
    getLandingDefaultAdditionalServices(effectivePreselect)
  );

  // When navigating between service landing routes or preset changes, reset to defaults.
  // This prevents selections from "carrying over".
  useEffect(() => {
    setAdditionalServices(getLandingDefaultAdditionalServices(effectivePreselect));
  }, [effectivePreselect]);
  
  type FlowState = 'selecting' | 'one-time-booking' | 'plan-selected' | 'plan-expanded';
  const [flowState, setFlowState] = useState<FlowState>('selecting');
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best' | null>('better');

  const { customizations, setTierCustomization } = usePlanCustomizations();

  // AUTHORITATIVE pricing — one-time totals AND the Good/Better/Best tiers come
  // ONLY from the deployed pricing Edge Functions. No local pricing math.
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

  // If invalid service slug, show 404-like message
  if (!config) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Service Not Found</h1>
          <p className="text-muted-foreground">The service you're looking for doesn't exist.</p>
          <Link to="/" className="inline-flex items-center gap-2 text-primary hover:underline">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const Icon = config.icon;

  const handleHomeDetailsChange = (updates: Partial<HomeDetails>) => {
    setHomeDetails(prev => ({ ...prev, ...updates }));
  };

  const handleAdditionalServicesChange = (updates: Partial<AdditionalServices>) => {
    setAdditionalServices(prev => ({ ...prev, ...updates }));
  };

  // Tier customizations are applied SERVER-SIDE via useServerBundleTiers, so the
  // returned tiers are already customized. No local customization delta math.
  const customizedBundles = bundles;

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

  const handleBookOneTime = () => {
    setFlowState('one-time-booking');
  };

  const handleUpgradeAndBook = () => {
    setFlowState('plan-selected');
  };

  const handleTierSelect = (tier: 'good' | 'better' | 'best') => {
    setSelectedTier(tier);
  };

  const handleBackToSelection = () => {
    setFlowState('selecting');
  };

  const currentProgressStep = useMemo<FlowStep>(() => {
    if (flowState === 'selecting') return 'services';
    if (flowState === 'one-time-booking' || flowState === 'plan-selected') return 'quote';
    return 'book';
  }, [flowState]);

  const renderRightColumn = () => {
    if (flowState === 'one-time-booking') {
      return (
        <OneTimeSummary
          servicePrices={servicePrices}
          additionalServices={additionalServices}
          homeDetails={homeDetails}
          onDownloadPDF={handleDownloadPDF}
          onGetStarted={handleGetStarted}
          prefillCustomerInfo={null}
        />
      );
    }
    
    if (flowState === 'plan-selected' && selectedBundle) {
      return (
        <PricingSummary
          servicePrices={servicePrices}
          selectedBundle={selectedBundle}
          homeDetails={homeDetails}
          additionalServices={additionalServices}
          onDownloadPDF={handleDownloadPDF}
          onGetStarted={handleGetStarted}
          prefillCustomerInfo={null}
        />
      );
    }
    
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

      {/* Service-Specific Hero */}
      <div className={`bg-gradient-to-r ${config.heroColor} text-white py-12`}>
        <div className="container">
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm mb-4">
              <Icon className="w-8 h-8" />
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-balance">
              {config.title}
            </h1>
            <p className="text-lg sm:text-xl opacity-90 text-balance">{config.subtitle}</p>
            <p className="text-white/80 max-w-xl mx-auto text-balance">
              {config.description}
            </p>
          </div>
        </div>
      </div>

      <main className="container py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Progress Stepper */}
          <div className="animate-fade-in">
            <ProgressStepper currentStep={currentProgressStep} />
          </div>

          {/* Home Details Form */}
          <HomeDetailsForm 
            homeDetails={homeDetails} 
            onChange={handleHomeDetailsChange} 
          />

          {/* Main Content */}
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6 min-w-0">
              {flowState !== 'selecting' && (
                <button
                  onClick={handleBackToSelection}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>←</span>
                  <span>Back to services</span>
                </button>
              )}
              
              {flowState === 'selecting' && (
                <IntentFirstServiceSelector
                  services={additionalServices}
                  servicePrices={servicePrices}
                  homeDetails={homeDetails}
                  onChange={handleAdditionalServicesChange}
                  onHomeDetailsChange={handleHomeDetailsChange}
                  featuredService={config.preSelectService}
                />
              )}
              
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
                    toast.success(`${tier.charAt(0).toUpperCase() + tier.slice(1)} plan customized!`);
                  }}
                />
              )}
            </div>
            
            <div className="lg:sticky lg:top-24 lg:self-start min-w-0">
              {renderRightColumn()}
            </div>
          </div>
        </div>
      </main>

      <CustomerFooter embed={isEmbedMode} />
    </div>
  );
};

export default ServiceLanding;
