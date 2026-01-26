import { Sparkles, Check, Star, ArrowLeft, Percent, Calendar, Settings2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlanCustomizeDrawer, type PlanCustomization } from './PlanCustomizeDrawer';
import type { BundleTier } from '@/types/homeowner';

interface ServicePlanSelectorProps {
  bundles: BundleTier[];
  selectedTier: 'good' | 'better' | 'best' | null;
  onSelectTier: (tier: 'good' | 'better' | 'best') => void;
  onBack: () => void;
  baseExteriorPrice: number;
  baseInteriorPrice: number;
  servicePrices: {
    gutterCleaning: number;
    houseWash: number;
    roofCleaning: number;
  };
  onCustomizePlan?: (tier: 'good' | 'better' | 'best', customization: PlanCustomization) => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function ServicePlanSelector({ 
  bundles, 
  selectedTier,
  onSelectTier,
  onBack,
  baseExteriorPrice,
  baseInteriorPrice,
  servicePrices,
  onCustomizePlan,
}: ServicePlanSelectorProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2">
          <ArrowLeft className="w-4 h-4" />
          Change Service Type
        </Button>
      </div>
      
      <div className="text-center">
        <h2 className="text-2xl font-display font-bold text-foreground">
          Choose Your Service Plan
        </h2>
        <p className="text-muted-foreground mt-2">
          Select the level of service that fits your home
        </p>
      </div>
      
      {/* Plan Cards - Better plan emphasized */}
      <div className="grid gap-6 md:grid-cols-3">
        {bundles.map((bundle) => {
          const isSelected = selectedTier === bundle.tier;
          const isPopular = bundle.isPopular;
          
          return (
            <Card
              key={bundle.tier}
              className={`relative overflow-hidden transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-primary shadow-xl scale-[1.02]'
                  : 'hover:shadow-lg hover:scale-[1.01]'
              } ${isPopular ? 'md:-mt-4 md:mb-4' : ''}`}
              onClick={() => onSelectTier(bundle.tier)}
            >
              {isPopular && (
                <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-primary to-accent py-2 text-center">
                  <span className="text-xs font-bold uppercase tracking-wide text-primary-foreground flex items-center justify-center gap-1">
                    <Star className="w-3 h-3 fill-current" />
                    Most Popular
                    <Star className="w-3 h-3 fill-current" />
                  </span>
                </div>
              )}
              
              <CardContent className={`p-6 ${isPopular ? 'pt-12' : ''}`}>
                <div className="text-center mb-4">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                      bundle.tier === 'good' 
                        ? 'tier-badge-good' 
                        : bundle.tier === 'better' 
                          ? 'tier-badge-better' 
                          : 'tier-badge-best'
                    }`}>
                      {bundle.name}
                    </span>
                    {bundle.isCustomized && (
                      <Badge variant="outline" className="text-xs border-accent text-accent">
                        Customized
                      </Badge>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{bundle.label}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{bundle.description}</p>
                </div>
                
                <div className="text-center mb-4">
                  <div className="price-display text-4xl text-foreground">
                    {formatPrice(bundle.monthlyPayment)}
                    <span className="text-base font-normal text-muted-foreground">/mo</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {formatPrice(bundle.annualTotal)} per year
                  </div>
                  {bundle.savings > 0 && (
                    <div className="savings-badge mt-2">
                      Save {formatPrice(bundle.savings)} ({bundle.savingsPercent}%)
                    </div>
                  )}
                </div>
                
                {/* Window Frequency Highlight */}
                <div className="p-3 rounded-lg bg-muted/50 mb-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-primary" />
                    <span className="font-medium">Window Cleaning</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 pl-6">
                    {bundle.windowFrequencyConfig.interiorFrequency > 0 ? (
                      <>
                        Exterior: {bundle.windowFrequencyConfig.exteriorFrequency}x/year
                        <br />
                        Interior: {bundle.windowFrequencyConfig.interiorFrequency}x/year
                      </>
                    ) : (
                      <>Exterior only: {bundle.windowFrequencyConfig.exteriorFrequency}x/year</>
                    )}
                  </div>
                </div>
                
                {/* Customize Button */}
                {onCustomizePlan && (
                  <PlanCustomizeDrawer
                    bundle={bundle}
                    baseExteriorPrice={baseExteriorPrice}
                    baseInteriorPrice={baseInteriorPrice}
                    servicePrices={servicePrices}
                    onCustomize={(customization) => onCustomizePlan(bundle.tier, customization)}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mb-4 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      Customize Plan
                    </Button>
                  </PlanCustomizeDrawer>
                )}
                
                {/* Addon Discount Badge */}
                {bundle.addonDiscountPercent > 0 && (
                  <div className="flex items-center justify-center gap-1 mb-4">
                    <Badge variant="secondary" className="text-xs">
                      <Percent className="w-3 h-3 mr-1" />
                      {bundle.addonDiscountPercent}% off add-ons
                    </Badge>
                    {bundle.addonSavings > 0 && (
                      <span className="text-xs text-green-600">
                        (saving {formatPrice(bundle.addonSavings)})
                      </span>
                    )}
                  </div>
                )}
                
                {/* Key features - limited to reduce cognitive load */}
                <div className="space-y-2 mb-6">
                  {bundle.features.slice(0, 4).map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                  {bundle.additionalServicesIncluded.slice(0, 3).map((service, idx) => (
                    <div key={`add-${idx}`} className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{service}</span>
                    </div>
                  ))}
                </div>
                
                <Button
                  className={`w-full ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                  variant={isSelected ? 'default' : 'outline'}
                >
                  {isSelected ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Selected
                    </>
                  ) : (
                    'Choose This Plan'
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Value proposition */}
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          All plans include automated scheduling, priority service, and satisfaction guarantee
        </p>
        <p className="text-xs text-muted-foreground">
          No payment due today. We'll contact you to set up your first service.
        </p>
      </div>
    </div>
  );
}
