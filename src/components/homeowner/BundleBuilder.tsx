import { Sparkles, Check, Star, Percent, Calendar, Award } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OneTimeQuote } from './OneTimeQuote';
import type { BundleTier, ServicePrices, AdditionalServices } from '@/types/homeowner';

export type SelectionType = 'one-time' | 'good' | 'better' | 'best' | null;

const RECOMMENDED_TIER = 'better'; // The tier marked as primary recommendation

interface BundleBuilderProps {
  bundles: BundleTier[];
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  selectedOption: SelectionType;
  onSelectOption: (option: SelectionType) => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function BundleBuilder({ 
  bundles, 
  servicePrices,
  additionalServices,
  selectedOption, 
  onSelectOption 
}: BundleBuilderProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-display font-bold text-foreground">
          Choose Your Service Option
        </h2>
        <p className="text-muted-foreground mt-2">
          Book a one-time service or save with a recurring package
        </p>
      </div>
      
      {/* One-Time Option + Package Options Grid */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* One-Time Service Card */}
        <OneTimeQuote
          servicePrices={servicePrices}
          additionalServices={additionalServices}
          isSelected={selectedOption === 'one-time'}
          onSelect={() => onSelectOption('one-time')}
        />
        
        {/* Package Tiers */}
        {bundles.map((bundle) => {
          const isSelected = selectedOption === bundle.tier;
          const isRecommended = bundle.tier === RECOMMENDED_TIER;
          const isSecondary = !isRecommended && !isSelected;
          
          return (
            <Card
              key={bundle.tier}
              className={`relative overflow-hidden transition-all duration-200 cursor-pointer ${
                isSelected
                  ? 'card-recommended scale-[1.02]'
                  : isRecommended
                    ? 'card-recommended hover:scale-[1.01]'
                    : 'card-secondary-option hover:scale-[1.01]'
              } ${isRecommended ? 'lg:-mt-4 lg:mb-4 lg:z-10' : ''}`}
              onClick={() => onSelectOption(bundle.tier)}
            >
              {/* Recommended Badge - Floating above card */}
              {isRecommended && (
                <div className="absolute -top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                  <span className="recommendation-badge">
                    <Award className="w-3.5 h-3.5" />
                    Recommended
                  </span>
                </div>
              )}
              
              <CardContent className={`p-5 ${isRecommended ? 'pt-8' : ''}`}>
                <div className="text-center mb-4">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide mb-2 ${
                    bundle.tier === 'good' 
                      ? 'tier-badge-good' 
                      : bundle.tier === 'better' 
                        ? 'tier-badge-better' 
                        : 'tier-badge-best'
                  }`}>
                    {bundle.name}
                  </span>
                  <h3 className={`font-semibold text-foreground ${isRecommended ? 'text-xl' : 'text-lg'}`}>
                    {bundle.label}
                  </h3>
                  {isRecommended && (
                    <p className="text-xs text-muted-foreground mt-1">Best value for most homes</p>
                  )}
                </div>
                
                <div className="text-center mb-4">
                  <div className={`price-display text-foreground ${isRecommended ? 'text-4xl' : 'text-3xl'}`}>
                    {formatPrice(bundle.monthlyPayment)}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatPrice(bundle.annualTotal)} per year
                  </div>
                  {bundle.savings > 0 && (
                    <div className="savings-badge mt-2 text-xs">
                      Save {formatPrice(bundle.savings)}
                    </div>
                  )}
                </div>
                
                {/* Window Frequency Summary */}
                <div className={`p-2 rounded-md mb-3 text-xs ${isRecommended ? 'bg-primary/10' : 'bg-muted/50'}`}>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-primary" />
                    <span className="font-medium">Windows</span>
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {bundle.windowFrequencyConfig.interiorFrequency > 0 ? (
                      `Ext ${bundle.windowFrequencyConfig.exteriorFrequency}x + Int ${bundle.windowFrequencyConfig.interiorFrequency}x/yr`
                    ) : (
                      `Exterior ${bundle.windowFrequencyConfig.exteriorFrequency}x/year`
                    )}
                  </div>
                </div>
                
                {/* Addon Discount */}
                {bundle.addonDiscountPercent > 0 && (
                  <Badge variant="outline" className={`w-full justify-center mb-3 text-xs py-1 ${isRecommended ? 'border-primary/30' : ''}`}>
                    <Percent className="w-3 h-3 mr-1" />
                    {bundle.addonDiscountPercent}% off add-ons
                  </Badge>
                )}
                
                <div className="space-y-2 mb-4">
                  {bundle.features.slice(0, isRecommended ? 4 : 3).map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className={`w-3 h-3 mt-0.5 flex-shrink-0 ${isRecommended ? 'text-primary' : 'text-success'}`} />
                      <span className="text-xs">{feature}</span>
                    </div>
                  ))}
                  {bundle.additionalServicesIncluded.slice(0, 2).map((service, idx) => (
                    <div key={`add-${idx}`} className="flex items-start gap-2">
                      <Sparkles className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-xs">{service}</span>
                    </div>
                  ))}
                </div>
                
                <Button
                  className={`w-full ${isSelected ? 'btn-primary' : isRecommended ? 'btn-primary' : 'btn-secondary'}`}
                  variant={isSelected || isRecommended ? 'default' : 'outline'}
                  size={isRecommended ? 'default' : 'sm'}
                >
                  {isSelected ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Selected
                    </>
                  ) : isRecommended ? (
                    'Choose This Plan'
                  ) : (
                    'Select Plan'
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
