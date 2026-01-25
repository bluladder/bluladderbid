import { useState } from 'react';
import { HomeDetailsForm } from '@/components/homeowner/HomeDetailsForm';
import { AdditionalServicesForm } from '@/components/homeowner/AdditionalServicesForm';
import { WindowPricingDisplay } from '@/components/homeowner/WindowPricingDisplay';
import { BundleBuilder } from '@/components/homeowner/BundleBuilder';
import { PricingSummary } from '@/components/homeowner/PricingSummary';
import { useServicePricing } from '@/hooks/useServicePricing';
import { 
  HomeDetails, 
  AdditionalServices, 
  DEFAULT_HOME_DETAILS, 
  DEFAULT_ADDITIONAL_SERVICES 
} from '@/types/homeowner';
import { toast } from 'sonner';

const Index = () => {
  const [homeDetails, setHomeDetails] = useState<HomeDetails>(DEFAULT_HOME_DETAILS);
  const [additionalServices, setAdditionalServices] = useState<AdditionalServices>(DEFAULT_ADDITIONAL_SERVICES);
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best' | null>(null);

  const { servicePrices, bundles } = useServicePricing(homeDetails, additionalServices);

  const handleHomeDetailsChange = (updates: Partial<HomeDetails>) => {
    setHomeDetails(prev => ({ ...prev, ...updates }));
  };

  const handleAdditionalServicesChange = (updates: Partial<AdditionalServices>) => {
    setAdditionalServices(prev => ({ ...prev, ...updates }));
  };

  const selectedBundle = bundles.find(b => b.tier === selectedTier) || null;

  const handleDownloadPDF = () => {
    // TODO: Implement PDF generation
    toast.success('Your proposal is being generated...', {
      description: 'The PDF will download shortly.',
    });
  };

  const handleGetStarted = () => {
    // TODO: Implement scheduling flow
    toast.success('Great choice!', {
      description: 'We\'ll be in touch to schedule your first service.',
    });
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
              <p className="text-sm font-medium text-foreground">Build Your Service Package</p>
              <p className="text-xs text-muted-foreground">Get your instant quote</p>
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
              window cleaning and home exterior services will cost — no surprises.
            </p>
          </div>

          {/* Main Content Grid */}
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Left Column - Forms */}
            <div className="lg:col-span-2 space-y-6">
              {/* Step 1: Home Details */}
              <HomeDetailsForm 
                homeDetails={homeDetails} 
                onChange={handleHomeDetailsChange} 
              />
              
              {/* Window Pricing Display */}
              <WindowPricingDisplay servicePrices={servicePrices} />
              
              {/* Step 2: Additional Services */}
              <AdditionalServicesForm
                services={additionalServices}
                servicePrices={servicePrices}
                onChange={handleAdditionalServicesChange}
              />
              
              {/* Step 3: Bundle Selection */}
              <BundleBuilder
                bundles={bundles}
                selectedTier={selectedTier}
                onSelectTier={setSelectedTier}
              />
            </div>
            
            {/* Right Column - Summary (sticky on desktop) */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              {selectedBundle ? (
                <PricingSummary
                  servicePrices={servicePrices}
                  selectedBundle={selectedBundle}
                  homeDetails={homeDetails}
                  onDownloadPDF={handleDownloadPDF}
                  onGetStarted={handleGetStarted}
                />
              ) : (
                <div className="card-gradient p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                    <span className="text-2xl">📋</span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">
                    Your Quote Summary
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Select a service package below to see your complete pricing and download your proposal.
                  </p>
                </div>
              )}
            </div>
          </div>
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
