import { Sparkles, Check, Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
              
              <CardContent className={`p-6 ${isPopular ? 'pt-10' : ''}`}>
                <div className="text-center mb-6">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide mb-3 ${
                    bundle.tier === 'good' 
                      ? 'tier-badge-good' 
                      : bundle.tier === 'better' 
                        ? 'tier-badge-better' 
                        : 'tier-badge-best'
                  }`}>
                    {bundle.name}
                  </span>
                  <h3 className="text-lg font-semibold text-foreground">{bundle.label}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{bundle.description}</p>
                </div>
                
                <div className="text-center mb-6">
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
                
                <div className="space-y-3 mb-6">
                  {bundle.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                  {bundle.additionalServicesIncluded.map((service, idx) => (
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
