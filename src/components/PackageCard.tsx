import { PackageTier, TierServiceConfig, FREQUENCY_MULTIPLIERS } from '@/types/servicePlan';
import { Check, Star, Crown, Zap } from 'lucide-react';

interface PackageCardProps {
  pkg: PackageTier;
  isHighlighted?: boolean;
  showPayInFull?: boolean;
  pricingDisplayMode?: 'monthly' | 'deposit';
}

const tierConfig = {
  good: {
    icon: Check,
    label: 'Standard',
    tagline: 'Essential Coverage',
    helperLabel: null,
  },
  better: {
    icon: Star,
    label: 'Recommended',
    tagline: 'Consistent Maintenance',
    helperLabel: 'Most Popular',
  },
  best: {
    icon: Crown,
    label: 'Zero-Hassle',
    tagline: 'Total Coverage',
    helperLabel: 'Best Value',
  },
};

// Helper to format frequency for display - clearer language
const formatFrequency = (visits: number): string => {
  if (visits === 1) return 'Once Per Year';
  if (visits === 2) return 'Twice Per Year';
  if (visits === 4) return 'Every 3 Months';
  if (visits === 12) return 'Monthly';
  return `${visits}× Per Year`;
};

// Consistent badge styling across all tiers
const getFrequencyBadgeStyle = (): string => {
  return 'bg-muted/80 text-foreground/70 border-border';
};

export function PackageCard({ pkg, isHighlighted, showPayInFull, pricingDisplayMode = 'deposit' }: PackageCardProps) {
  const config = tierConfig[pkg.tier];
  const Icon = config.icon;

  // Tier-specific card styling for visual progression
  const getCardStyle = () => {
    if (pkg.tier === 'best') {
      return 'ring-2 ring-success/50 shadow-lg shadow-success/10';
    }
    if (pkg.tier === 'better') {
      return 'ring-2 ring-primary/40';
    }
    return 'border border-border';
  };

  // Tier-specific top accent
  const getTopAccent = () => {
    if (pkg.tier === 'best') {
      return 'absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-success to-success/70';
    }
    if (pkg.tier === 'better') {
      return 'absolute top-0 left-0 right-0 h-1 bg-primary';
    }
    return '';
  };

  return (
    <div className={`card-elevated relative overflow-hidden ${getCardStyle()}`}>
      {/* Top accent bar */}
      {(pkg.tier === 'better' || pkg.tier === 'best') && (
        <div className={getTopAccent()} />
      )}

      {/* Helper label badge - positioned at top */}
      {config.helperLabel && (
        <div className={`absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
          pkg.tier === 'best' 
            ? 'bg-success text-success-foreground' 
            : 'bg-primary text-primary-foreground'
        }`}>
          {pkg.tier === 'best' ? <Crown className="w-3 h-3" /> : <Star className="w-3 h-3" />}
          {config.helperLabel}
        </div>
      )}

      <div className="p-6">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                pkg.tier === 'good'
                  ? 'bg-muted text-muted-foreground'
                  : pkg.tier === 'better'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-success text-success-foreground'
              }`}
            >
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-xl font-bold text-foreground">
                {pkg.name}
              </h3>
              <span className="text-sm text-muted-foreground">
                {pkg.tierLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="mb-6 space-y-4">
          {/* Monthly Price (Hero) */}
          <div className="text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span className={`font-bold text-4xl ${
                pkg.tier === 'best' ? 'text-success' : pkg.tier === 'better' ? 'text-primary' : 'text-foreground'
              }`}>
                ${(
                  pricingDisplayMode === 'monthly'
                    ? pkg.monthlyPrice
                    : (pkg.annualTotal - pkg.depositAmount) / 11
                ).toFixed(0)}
              </span>
              <span className="text-muted-foreground text-lg">/month</span>
            </div>

            {pricingDisplayMode === 'deposit' ? (
              <p className="text-sm text-muted-foreground mt-1">
                after ${pkg.depositAmount.toFixed(0)} deposit
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                flat monthly rate
              </p>
            )}

            <p className="text-xs text-muted-foreground/70 mt-1">
              ${pkg.annualTotal.toFixed(0)} per year
            </p>
          </div>

          {/* Best tier value summary */}
          {pkg.tier === 'best' && (
            <p className="text-center text-sm text-success font-medium">
              Maximum coverage, priority scheduling, and the biggest long-term savings.
            </p>
          )}

          {/* Savings Highlight - Always shown */}
          <div
            className={`p-3 rounded-lg text-center ${
              pkg.tier === 'best'
                ? 'bg-success/10 border border-success/20'
                : pkg.tier === 'better'
                  ? 'bg-primary/10 border border-primary/20'
                  : 'bg-muted/50 border border-border'
            }`}
          >
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Annual Savings with This Plan
            </p>
            <p
              className={`text-2xl font-bold ${
                pkg.tier === 'best'
                  ? 'text-success'
                  : pkg.tier === 'better'
                    ? 'text-primary'
                    : 'text-foreground'
              }`}
            >
              ${Math.max(0, pkg.savings).toFixed(0)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Compared to booking each service separately
            </p>
          </div>
        </div>

        {/* Pay in Full Option */}
        {showPayInFull && pkg.payInFullSavings > 0 && (
          <div className="mb-6 p-3 rounded-lg bg-success/10 border border-success/20">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-foreground">
                  Pay in full
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One-time payment — no monthly billing
                </p>
              </div>
              <span className="font-bold text-lg text-success">
                ${pkg.payInFullPrice.toFixed(0)}
              </span>
            </div>
            <p className="text-xs text-success mt-2 font-medium">
              Save an extra ${pkg.payInFullSavings.toFixed(0)}
            </p>
          </div>
        )}

        {/* Services with frequency indicators */}
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            What's Included
          </h4>
          <ul className="space-y-2.5">
            {pkg.tierServices.map((ts, index) => (
              <li key={`${ts.service.id}-${index}`} className="flex items-start gap-2">
                <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                  pkg.tier === 'best' ? 'text-success' : pkg.tier === 'better' ? 'text-primary' : 'text-muted-foreground'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {ts.service.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${getFrequencyBadgeStyle()}`}>
                      {formatFrequency(ts.annualVisits)}
                    </span>
                  </div>
                  {ts.service.note && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">
                      {ts.service.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Perks with tier-specific highlights */}
        {pkg.perks.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Member Benefits
            </h4>
            <ul className="space-y-2">
              {pkg.perks.map((perk) => {
                const isExclusivePerk = perk.tier === 'best' && pkg.tier === 'best';
                
                return (
                  <li key={perk.id} className="flex items-center gap-2">
                    {isExclusivePerk ? (
                      <Zap className="w-4 h-4 flex-shrink-0 text-success" />
                    ) : (
                      <Check className={`w-4 h-4 flex-shrink-0 ${
                        pkg.tier === 'best' ? 'text-success' : pkg.tier === 'better' ? 'text-primary' : 'text-muted-foreground'
                      }`} />
                    )}
                    <span className={`text-sm ${
                      isExclusivePerk 
                        ? 'font-medium text-success'
                        : 'text-foreground'
                    }`}>
                      {perk.name}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
