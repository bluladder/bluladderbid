import { Check, Award, Crown, Star, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PlanTier } from './TierSelector';

interface TierCardData {
  id: PlanTier;
  name: string;
  headline: string;
  benefits: string[];
  isPopular?: boolean;
  isPremium?: boolean;
}

const TIER_DATA: TierCardData[] = [
  {
    id: 'good',
    name: 'Good',
    headline: 'Essential care for busy homeowners',
    benefits: ['Exterior Windows 2x/yr', 'Gutter Cleaning 1x/yr', 'Screen cleaning included'],
  },
  {
    id: 'better',
    name: 'Better',
    headline: 'Best value for year-round maintenance',
    benefits: ['Exterior Windows 3x/yr', 'Interior Windows 1x/yr', 'Gutter Cleaning 2x/yr', 'House Wash 1x/yr'],
    isPopular: true,
  },
  {
    id: 'best',
    name: 'Best',
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
}: PlanTierCardsProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground">
          Choose Your Maintenance Plan
        </h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Protect your home year-round with scheduled professional care. 
          Select a plan to see pricing and customize your services.
        </p>
      </div>

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
                  ? 'ring-2 ring-primary shadow-lg scale-[1.02]'
                  : 'hover:shadow-md hover:scale-[1.01]'
                }
                ${tier.isPopular ? 'md:scale-105 md:z-10' : ''}
              `}
            >
              {/* Popular Badge */}
              {tier.isPopular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                  <Badge className="bg-primary text-primary-foreground shadow-md px-3 py-1">
                    <Award className="w-3 h-3 mr-1" />
                    Most Popular
                  </Badge>
                </div>
              )}

              {/* Premium Badge */}
              {tier.isPremium && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                  <Badge variant="outline" className="bg-background border-amber-500 text-amber-600 shadow-md px-3 py-1">
                    <Crown className="w-3 h-3 mr-1" />
                    Premium
                  </Badge>
                </div>
              )}

              <div className={`p-5 ${tier.isPopular || tier.isPremium ? 'pt-8' : ''}`}>
                {/* Plan Name & Headline */}
                <div className="text-center mb-4">
                  <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide mb-2 ${
                    tier.id === 'good' ? 'bg-slate-100 text-slate-700' :
                    tier.id === 'better' ? 'bg-primary/10 text-primary' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {tier.name}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {tier.headline}
                  </p>
                </div>

                {/* Pricing */}
                <div className="text-center mb-4">
                  {hasHomeDetails ? (
                    <>
                      <div className={`font-bold ${tier.isPopular ? 'text-4xl text-primary' : 'text-3xl text-foreground'}`}>
                        {formatPrice(prices.monthly)}
                        <span className="text-base font-normal text-muted-foreground">/mo</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        After 20% deposit • {formatPrice(prices.annual)}/year
                      </p>
                    </>
                  ) : (
                    <div className="py-3">
                      <p className="text-sm text-muted-foreground italic">
                        Enter home size for pricing
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
                  w-full py-2.5 rounded-lg text-sm font-medium text-center transition-colors
                  ${isSelected 
                    ? 'bg-primary text-primary-foreground' 
                    : tier.isPopular
                      ? 'bg-primary/10 text-primary hover:bg-primary/20'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }
                `}>
                  {isSelected ? (
                    <span className="flex items-center justify-center gap-1">
                      <Check className="w-4 h-4" />
                      Selected
                    </span>
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
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground pt-2">
        <span className="flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          No contracts — cancel anytime
        </span>
        <span className="hidden sm:inline text-border">•</span>
        <span>Reschedule or modify with 48hr notice</span>
        <span className="hidden sm:inline text-border">•</span>
        <span>See pricing before confirming</span>
      </div>
    </div>
  );
}
