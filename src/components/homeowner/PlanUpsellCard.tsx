import { useState } from 'react';
import { RefreshCw, Check, Sparkles, Star, Calendar, ChevronDown, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { BundleTier, ServicePrices, AdditionalServices } from '@/types/homeowner';

interface PlanUpsellCardProps {
  oneTimeTotal: number;
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  bundles: BundleTier[];
  selectedTier: 'good' | 'better' | 'best' | null;
  onSelectTier: (tier: 'good' | 'better' | 'best') => void;
  onBookOneTime: () => void;
  onUpgradeAndBook: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function PlanUpsellCard({
  oneTimeTotal,
  servicePrices,
  additionalServices,
  bundles,
  selectedTier,
  onSelectTier,
  onBookOneTime,
  onUpgradeAndBook,
}: PlanUpsellCardProps) {
  const [showAllPlans, setShowAllPlans] = useState(false);
  const hasServices = oneTimeTotal > 0;
  
  // Default to "better" tier as recommended
  const recommendedBundle = bundles.find(b => b.tier === 'better') || bundles[1];
  const currentBundle = selectedTier 
    ? bundles.find(b => b.tier === selectedTier) || recommendedBundle 
    : recommendedBundle;
  
  // Count enabled services
  const enabledServices = [
    servicePrices.windowCleaningTotal > 0,
    additionalServices.houseWash,
    additionalServices.gutterCleaning,
    additionalServices.roofCleaning,
    additionalServices.pressureWashing.enabled,
  ].filter(Boolean).length;
  
  // Calculate annual value if they booked one-time multiple times
  const annualOneTimeValue = oneTimeTotal * (currentBundle?.windowFrequency || 2);
  const annualSavings = annualOneTimeValue - (currentBundle?.annualTotal || 0);
  
  if (!hasServices) {
    return (
      <Card className="card-gradient">
        <CardContent className="p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
            <span className="text-2xl">📋</span>
          </div>
          <h3 className="font-semibold text-foreground mb-2">
            Your Quote Summary
          </h3>
          <p className="text-sm text-muted-foreground">
            Select services above to see your instant pricing.
          </p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* One-Time Price Display */}
      <Card className="card-gradient overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" />
            <CardTitle className="text-lg">One-Time Service Price</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-6">
          <div className="text-center mb-4">
            <div className="text-4xl font-bold price-display text-foreground">
              {formatPrice(oneTimeTotal)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {enabledServices} service{enabledServices !== 1 ? 's' : ''} • Single visit
            </p>
          </div>
          
          {/* Service breakdown */}
          <div className="space-y-2 text-sm mb-4">
            {servicePrices.windowCleaningTotal > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Window Cleaning
                </span>
                <span className="font-medium">{formatPrice(servicePrices.windowCleaningTotal)}</span>
              </div>
            )}
            {additionalServices.houseWash && servicePrices.houseWash > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  House Wash
                </span>
                <span className="font-medium">{formatPrice(servicePrices.houseWash)}</span>
              </div>
            )}
            {additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Gutter Cleaning
                </span>
                <span className="font-medium">{formatPrice(servicePrices.gutterCleaning)}</span>
              </div>
            )}
            {additionalServices.roofCleaning && servicePrices.roofCleaning > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Roof Cleaning
                </span>
                <span className="font-medium">{formatPrice(servicePrices.roofCleaning)}</span>
              </div>
            )}
            {additionalServices.pressureWashing.enabled && (servicePrices.pressureWashing + servicePrices.pressureWashingAddons) > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Pressure Washing
                </span>
                <span className="font-medium">
                  {formatPrice(servicePrices.pressureWashing + servicePrices.pressureWashingAddons)}
                </span>
              </div>
            )}
          </div>
          
          {/* Book One-Time CTA (Secondary) */}
          <Button 
            variant="outline" 
            className="w-full btn-secondary"
            onClick={onBookOneTime}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Book One-Time Service
          </Button>
        </CardContent>
      </Card>
      
      {/* Plan Upsell Section */}
      <Card className="border-2 border-primary overflow-hidden">
        <div className="bg-gradient-to-r from-primary to-accent py-2 px-4">
          <div className="flex items-center justify-center gap-2 text-primary-foreground text-sm font-semibold">
            <Star className="w-4 h-4 fill-current" />
            Or, put this on autopilot and save
            <Star className="w-4 h-4 fill-current" />
          </div>
        </div>
        
        <CardContent className="p-5">
          {/* Recommended Plan */}
          <div className="text-center mb-4">
            <Badge className="tier-badge-better mb-3">
              {currentBundle?.name || 'Better'} Plan
            </Badge>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-4xl font-bold price-display text-foreground">
                {formatPrice(currentBundle?.monthlyPayment || 0)}
              </span>
              <span className="text-muted-foreground">/month</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {formatPrice(currentBundle?.annualTotal || 0)} per year
            </p>
            {annualSavings > 0 && (
              <div className="savings-badge mt-2 inline-flex">
                Save {formatPrice(annualSavings)} vs one-time
              </div>
            )}
          </div>
          
          {/* What's included */}
          <div className="space-y-2 mb-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What you get
            </h4>
            {currentBundle?.features.slice(0, 3).map((feature, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm">
                <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
            {currentBundle?.additionalServicesIncluded.slice(0, 2).map((service, idx) => (
              <div key={`add-${idx}`} className="flex items-start gap-2 text-sm">
                <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <span>{service}</span>
              </div>
            ))}
          </div>
          
          {/* Upgrade CTA (Primary) */}
          <Button 
            className="w-full btn-primary h-12 text-base mb-3"
            onClick={onUpgradeAndBook}
          >
            <RefreshCw className="w-5 h-5 mr-2" />
            Upgrade & Book on Autopilot
          </Button>
          
          {/* Social proof */}
          <p className="text-center text-xs text-muted-foreground mb-4">
            Most homeowners choose this option to keep things clean year-round.
          </p>
          
          <Separator className="my-4" />
          
          {/* See All Plans (Collapsed) */}
          <Collapsible open={showAllPlans} onOpenChange={setShowAllPlans}>
            <CollapsibleTrigger className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2">
              <ChevronDown className={`w-4 h-4 transition-transform ${showAllPlans ? 'rotate-180' : ''}`} />
              {showAllPlans ? 'Hide plan options' : 'See all plan options'}
            </CollapsibleTrigger>
            
            <CollapsibleContent className="pt-4">
              <div className="space-y-3">
                {bundles.map((bundle) => {
                  const isSelected = selectedTier === bundle.tier;
                  const isRecommended = bundle.tier === 'better';
                  
                  return (
                    <div
                      key={bundle.tier}
                      className={`relative p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        isSelected 
                          ? 'border-primary bg-primary/5 shadow-md' 
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() => onSelectTier(bundle.tier)}
                    >
                      {isRecommended && (
                        <Badge className="absolute -top-2 right-3 bg-primary text-primary-foreground text-xs">
                          Best Value
                        </Badge>
                      )}
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                          </div>
                          <div>
                            <span className={`font-semibold ${
                              bundle.tier === 'good' 
                                ? 'text-muted-foreground' 
                                : bundle.tier === 'better' 
                                  ? 'text-primary' 
                                  : 'text-accent'
                            }`}>
                              {bundle.name}
                            </span>
                            <span className="text-sm text-muted-foreground ml-2">
                              • {bundle.label}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatPrice(bundle.monthlyPayment)}/mo</div>
                          {bundle.savings > 0 && (
                            <div className="text-xs text-success">
                              Save {formatPrice(bundle.savings)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
      
      {/* Disclaimer */}
      <p className="text-center text-xs text-muted-foreground">
        No payment due today. Final details confirmed after booking.
      </p>
    </div>
  );
}
