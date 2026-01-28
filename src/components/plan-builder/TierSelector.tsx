import { Check, Award, Star, Sparkles, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export type PlanTier = 'good' | 'better' | 'best';

export interface TierConfig {
  id: PlanTier;
  name: string;
  tagline: string;
  description: string;
  windowFrequency: { exterior: number; interior: number };
  includedServices: string[];
  addonDiscount: number;
  isPopular?: boolean;
}

export const TIER_CONFIGS: TierConfig[] = [
  {
    id: 'good',
    name: 'Good',
    tagline: 'Essential Care',
    description: 'The basics done right',
    windowFrequency: { exterior: 2, interior: 0 },
    includedServices: ['Exterior Windows 2x/yr', 'Gutter Cleaning 1x/yr'],
    addonDiscount: 0,
  },
  {
    id: 'better',
    name: 'Better',
    tagline: 'Complete Protection',
    description: 'Most popular for a reason',
    windowFrequency: { exterior: 3, interior: 1 },
    includedServices: [
      'Exterior Windows 3x/yr',
      'Interior Windows 1x/yr',
      'Gutter Cleaning 2x/yr',
      'House Wash 1x/yr',
    ],
    addonDiscount: 10,
    isPopular: true,
  },
  {
    id: 'best',
    name: 'Best',
    tagline: 'Premium Care',
    description: 'The full treatment',
    windowFrequency: { exterior: 4, interior: 2 },
    includedServices: [
      'Exterior Windows 4x/yr',
      'Interior Windows 2x/yr',
      'Gutter Cleaning 2x/yr',
      'House Wash 1x/yr',
      'Roof Cleaning 1x/yr',
    ],
    addonDiscount: 15,
  },
];

interface TierSelectorProps {
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

export function TierSelector({
  selectedTier,
  onSelectTier,
  tierPrices,
  hasHomeDetails,
}: TierSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-display font-bold text-foreground">
          Choose Your Plan
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select a tier, then customize to fit your needs
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {TIER_CONFIGS.map((tier) => {
          const isSelected = selectedTier === tier.id;
          const isPopular = tier.isPopular;
          const prices = tierPrices[tier.id];

          return (
            <Card
              key={tier.id}
              className={`relative cursor-pointer transition-all duration-200 overflow-hidden ${
                isSelected
                  ? 'card-recommended scale-[1.02]'
                  : isPopular
                    ? 'card-recommended hover:scale-[1.01]'
                    : 'card-secondary-option hover:scale-[1.01]'
              } ${isPopular ? 'md:-mt-2 md:mb-2 md:z-10' : ''}`}
              onClick={() => onSelectTier(tier.id)}
            >
              {/* Recommended Badge */}
              {isPopular && (
                <div className="absolute -top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                  <span className="recommendation-badge">
                    <Award className="w-3.5 h-3.5" />
                    Recommended
                  </span>
                </div>
              )}

              <CardContent className={`p-4 ${isPopular ? 'pt-7' : ''}`}>
                {/* Tier Badge */}
                <div className="text-center mb-3">
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                      tier.id === 'good'
                        ? 'tier-badge-good'
                        : tier.id === 'better'
                          ? 'tier-badge-better'
                          : 'tier-badge-best'
                    }`}
                  >
                    {tier.name}
                  </span>
                  <h3 className={`font-semibold text-foreground mt-2 ${isPopular ? 'text-lg' : ''}`}>
                    {tier.tagline}
                  </h3>
                  <p className="text-xs text-muted-foreground">{tier.description}</p>
                </div>

                {/* Pricing */}
                <div className="text-center mb-4">
                  {hasHomeDetails ? (
                    <>
                      <div className={`price-display text-foreground ${isPopular ? 'text-3xl' : 'text-2xl'}`}>
                        {formatPrice(prices.monthly)}
                        <span className="text-sm font-normal text-muted-foreground">/mo</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatPrice(prices.annual)}/year
                      </div>
                      {prices.savings > 0 && (
                        <div className="savings-badge mt-1.5 text-xs">
                          Save {formatPrice(prices.savings)}/yr
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-2">
                      <span className="text-sm text-muted-foreground">Enter home details for pricing</span>
                    </div>
                  )}
                </div>

                {/* Included Services */}
                <div className="space-y-1.5 mb-4">
                  {tier.includedServices.map((service, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <Check className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected || isPopular ? 'text-primary' : 'text-success'}`} />
                      <span>{service}</span>
                    </div>
                  ))}
                </div>

                {/* Addon Discount */}
                {tier.addonDiscount > 0 && (
                  <Badge variant="outline" className="w-full justify-center mb-3 text-xs py-1">
                    <Sparkles className="w-3 h-3 mr-1" />
                    {tier.addonDiscount}% off add-on services
                  </Badge>
                )}

                {/* Selection Indicator */}
                <Button
                  className={`w-full ${isSelected ? 'btn-primary' : isPopular ? 'btn-primary' : 'btn-secondary'}`}
                  variant={isSelected || isPopular ? 'default' : 'outline'}
                  size="sm"
                >
                  {isSelected ? (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Selected
                    </>
                  ) : (
                    <>
                      Choose {tier.name}
                      <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </>
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
