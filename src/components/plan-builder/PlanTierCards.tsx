import { Check, Award, Crown, Star, Sparkles, Info, Shield } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlanTier } from './TierSelector';

interface TierCardData {
  id: PlanTier;
  name: string;
  tagline: string;
  headline: string;
  benefits: string[];
  isPopular?: boolean;
  isPremium?: boolean;
}

const TIER_DATA: TierCardData[] = [
  {
    id: 'good',
    name: 'Good',
    tagline: 'Essential care',
    headline: 'Essential care for busy homeowners',
    benefits: ['Exterior Windows 2x/yr', 'Gutter Cleaning 1x/yr', 'Screen cleaning included'],
  },
  {
    id: 'better',
    name: 'Better',
    tagline: 'Best value — most popular',
    headline: 'Best value for year-round maintenance',
    benefits: ['Exterior Windows 3x/yr', 'Interior Windows 1x/yr', 'Gutter Cleaning 2x/yr', 'House Wash 1x/yr'],
    isPopular: true,
  },
  {
    id: 'best',
    name: 'Best',
    tagline: 'Complete protection',
    headline: 'Complete protection for your home',
    benefits: ['Exterior Windows 4x/yr', 'Interior Windows 2x/yr', 'Gutter + House + Roof'],
    isPremium: true,
  },
];

interface PlanTierCardsProps {
  selectedTier: PlanTier;
  onSelectTier: (tier: PlanTier) => void;
  tierPrices: Record<PlanTier, { monthly: number; annual: number; savings: number }>;
  hasHomeDetails: boolean;
  pricingLoading?: boolean;
  pricingUnavailable?: boolean;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function PlanTierCards({
  selectedTier,
  onSelectTier,
  tierPrices,
  hasHomeDetails,
  pricingLoading,
  pricingUnavailable,
}: PlanTierCardsProps) {
  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Tier Cards Grid */}
        <div className="grid gap-4 md:grid-cols-3 items-end">
          {TIER_DATA.map((tier) => {
            const isSelected = selectedTier === tier.id;
            const prices = tierPrices[tier.id];

            return (
              <Card
                key={tier.id}
                onClick={() => onSelectTier(tier.id)}
                className={`
                  relative cursor-pointer transition-all duration-300 overflow-hidden
                  ${isSelected
                    ? 'ring-2 ring-primary shadow-xl scale-[1.02]'
                    : 'hover:shadow-md hover:scale-[1.01]'
                  }
                  ${tier.isPopular 
                    ? 'md:scale-105 md:z-10 shadow-lg border-primary/30' 
                    : ''
                  }
                `}
              >
                {/* Recommended Badge for Better */}
                {tier.isPopular && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-primary text-primary-foreground shadow-lg px-4 py-1.5">
                      <Star className="w-3.5 h-3.5 mr-1.5 fill-current" />
                      Recommended
                    </Badge>
                  </div>
                )}

                {/* Premium Badge */}
                {tier.isPremium && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                    <Badge variant="outline" className="bg-background border-amber-500 text-amber-600 shadow-md px-3 py-1">
                      <Crown className="w-3 h-3 mr-1" />
                      Premium
                    </Badge>
                  </div>
                )}

                <div className={`p-5 ${tier.isPopular || tier.isPremium ? 'pt-8' : ''}`}>
                  {/* Plan Name & Tagline */}
                  <div className="text-center mb-4">
                    <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide mb-2 ${
                      tier.id === 'good' ? 'bg-slate-100 text-slate-700' :
                      tier.id === 'better' ? 'bg-primary/10 text-primary' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {tier.name}
                    </div>
                    <p className={`text-sm font-medium ${
                      tier.isPopular ? 'text-primary' : 'text-muted-foreground'
                    }`}>
                      {tier.tagline}
                    </p>
                  </div>

                  {/* Pricing */}
                  <div className="text-center mb-4">
                    {hasHomeDetails && prices.monthly > 0 ? (
                      <>
                        <div className={`font-bold transition-all duration-300 ${
                          tier.isPopular ? 'text-4xl text-primary' : 'text-3xl text-foreground'
                        }`}>
                          {formatPrice(prices.monthly)}
                          <span className="text-base font-normal text-muted-foreground">/mo</span>
                        </div>
                        <div className="flex items-center justify-center gap-1 mt-1">
                          <span className="text-xs text-muted-foreground">
                            Billed monthly after 20% deposit
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="text-muted-foreground/70 hover:text-muted-foreground">
                                <Info className="w-3 h-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="text-xs">
                                Deposit secures your annual service schedule. 
                                Remaining balance is split into 11 easy monthly payments.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </>
                    ) : (
                      <div className="py-3">
                        <p className="text-sm text-muted-foreground italic">
                          {!hasHomeDetails
                            ? 'Enter home size for pricing'
                            : pricingLoading
                              ? 'Calculating your price…'
                              : pricingUnavailable
                                ? 'Pricing temporarily unavailable — request a quote'
                                : 'Get instant pricing'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Benefits Preview */}
                  <div className="space-y-2 mb-4">
                    {tier.benefits.slice(0, 3).map((benefit, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Check className={`w-4 h-4 flex-shrink-0 ${
                          tier.isPopular ? 'text-primary' : 'text-success'
                        }`} />
                        <span className="text-foreground">{benefit}</span>
                      </div>
                    ))}
                    {tier.benefits.length > 3 && (
                      <p className="text-xs text-muted-foreground ml-6">
                        +{tier.benefits.length - 3} more included
                      </p>
                    )}
                  </div>

                  {/* Selection State */}
                  <div className={`
                    w-full py-3 rounded-lg text-sm font-semibold text-center transition-all
                    ${isSelected 
                      ? 'bg-primary text-primary-foreground shadow-md' 
                      : tier.isPopular
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }
                  `}>
                    {isSelected ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Check className="w-4 h-4" />
                        Selected
                      </span>
                    ) : tier.isPopular ? (
                      'Select Recommended'
                    ) : (
                      `Select ${tier.name}`
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Trust Elements */}
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground pt-2">
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            No contracts
          </span>
          <span className="text-border">•</span>
          <span>Cancel anytime</span>
          <span className="text-border">•</span>
          <span>48hr reschedule</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
