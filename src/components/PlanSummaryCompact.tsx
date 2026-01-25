import { PackageTier } from '@/types/servicePlan';
import { TrendingUp, DollarSign, Percent, Sparkles, Star } from 'lucide-react';

interface PlanSummaryCompactProps {
  packages: PackageTier[];
}

export function PlanSummaryCompact({ packages }: PlanSummaryCompactProps) {
  if (packages.length === 0) {
    return (
      <div className="card-elevated p-6 text-center">
        <p className="text-muted-foreground text-sm">
          Select services above to see your plan summary
        </p>
      </div>
    );
  }

  // Show the "Better" (middle) tier as the primary view
  const primaryPkg = packages[1] || packages[0];
  const bestPkg = packages[2] || packages[packages.length - 1];

  return (
    <div className="card-summary p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="section-icon w-8 h-8">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          <h3 className="font-display text-lg font-bold text-foreground">Plan Summary</h3>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary border border-primary/20">
          Recommended Plan
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="text-center p-4 rounded-xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/10">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-2">
            <DollarSign className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wide font-medium">Monthly</span>
          </div>
          <p className="font-display text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            ${primaryPkg.monthlyPrice.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">/month</p>
        </div>
        <div className="text-center p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/60">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-2">
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wide font-medium">Annual</span>
          </div>
          <p className="font-display text-3xl font-bold text-foreground">
            ${primaryPkg.annualTotal.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">total value</p>
        </div>
        <div className="text-center p-4 rounded-xl bg-gradient-to-br from-success/5 to-transparent border border-success/20">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-2">
            <Percent className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wide font-medium">Savings</span>
          </div>
          <p className="font-display text-3xl font-bold text-success">
            ${primaryPkg.savings.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">you save</p>
        </div>
      </div>

      {/* Tier comparison */}
      <div className="pt-5 border-t border-border/40">
        <p className="text-xs text-muted-foreground mb-3 font-medium">Compare all tiers:</p>
        <div className="grid grid-cols-3 gap-3">
          {packages.map((pkg, index) => {
            const isBetter = index === 1;
            const isBest = index === 2;
            
            return (
              <div
                key={pkg.tier}
                className={`relative p-3 rounded-xl text-center transition-all duration-200 ${
                  isBetter
                    ? 'card-selected scale-[1.02]'
                    : isBest
                    ? 'bg-success/5 border border-success/20 hover:border-success/30'
                    : 'bg-muted/40 border border-border/40 hover:border-primary/20'
                }`}
              >
                {/* Tier label badges */}
                {isBetter && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap">
                    <Star className="w-2 h-2" />
                    Most Popular
                  </div>
                )}
                {isBest && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-success text-success-foreground text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap">
                    Best Value
                  </div>
                )}
                
                <p className={`text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide ${isBetter || isBest ? 'mt-1' : ''}`}>
                  {pkg.tierLabel}
                </p>
                <p className={`font-display text-lg font-bold ${
                  isBetter ? 'text-primary' : isBest ? 'text-success' : 'text-foreground'
                }`}>
                  ${pkg.monthlyPrice.toFixed(0)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}