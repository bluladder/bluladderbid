import { Sparkles, Check, Star, Percent, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OneTimeQuote } from './OneTimeQuote';
import type { BundleTier, ServicePrices, AdditionalServices } from '@/types/homeowner';

export type SelectionType = 'one-time' | 'good' | 'better' | 'best' | null;

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
          const isPopular = bundle.isPopular;
          
          return (
            <Card
              key={bundle.tier}
              className={`relative overflow-hidden transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-primary shadow-lg scale-[1.02]'
                  : 'hover:shadow-md hover:scale-[1.01]'
              } ${isPopular ? 'lg:-mt-4 lg:mb-4' : ''}`}
              onClick={() => onSelectOption(bundle.tier)}
            >
              {isPopular && (
                <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-primary to-accent py-1.5 text-center">
                  <span className="text-xs font-bold uppercase tracking-wide text-primary-foreground flex items-center justify-center gap-1">
                    <Star className="w-3 h-3 fill-current" />
                    Most Popular
                    <Star className="w-3 h-3 fill-current" />
                  </span>
                </div>
              )}
              
              <CardContent className={`p-5 ${isPopular ? 'pt-10' : ''}`}>
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
                  <h3 className="text-lg font-semibold text-foreground">{bundle.label}</h3>
                </div>
                
                <div className="text-center mb-4">
                  <div className="price-display text-3xl text-foreground">
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
                <div className="p-2 rounded-md bg-muted/50 mb-3 text-xs">
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
                  <Badge variant="outline" className="w-full justify-center mb-3 text-xs py-1">
                    <Percent className="w-3 h-3 mr-1" />
                    {bundle.addonDiscountPercent}% off add-ons
                  </Badge>
                )}
                
                <div className="space-y-2 mb-4">
                  {bundle.features.slice(0, 3).map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="w-3 h-3 text-success mt-0.5 flex-shrink-0" />
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
                  className={`w-full ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                >
                  {isSelected ? 'Selected' : 'Select Plan'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
