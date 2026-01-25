import { PackageTier, TierServiceConfig } from '@/types/servicePlan';
import { ArrowRight, Plus, Zap, Calendar, Shield, Crown, Star, Check } from 'lucide-react';

interface TierUpgradePathProps {
  packages: PackageTier[];
}

// Helper to format frequency for display
const formatFrequency = (visits: number): string => {
  if (visits === 1) return '1x/year';
  if (visits === 2) return '2x/year';
  if (visits === 4) return '4x/year';
  if (visits === 12) return '12x/year';
  return `${visits}x/year`;
};

// Calculate what's gained when upgrading from one tier to another
const calculateUpgradeGains = (
  fromPkg: PackageTier | null,
  toPkg: PackageTier
): {
  newServices: TierServiceConfig[];
  frequencyUpgrades: { service: string; from: number; to: number }[];
  newPerks: string[];
  additionalVisits: number;
  additionalValue: number;
} => {
  const fromServices = fromPkg?.tierServices || [];
  const fromPerks = fromPkg?.perks.map(p => p.id) || [];
  
  const newServices: TierServiceConfig[] = [];
  const frequencyUpgrades: { service: string; from: number; to: number }[] = [];
  let additionalVisits = 0;
  
  // Find new services and frequency upgrades
  toPkg.tierServices.forEach(toService => {
    const fromService = fromServices.find(
      fs => fs.service.id === toService.service.id || 
            fs.service.name === toService.service.name
    );
    
    if (!fromService) {
      // New service
      newServices.push(toService);
      additionalVisits += toService.annualVisits;
    } else if (toService.annualVisits > fromService.annualVisits) {
      // Frequency upgrade
      frequencyUpgrades.push({
        service: toService.service.name,
        from: fromService.annualVisits,
        to: toService.annualVisits,
      });
      additionalVisits += toService.annualVisits - fromService.annualVisits;
    }
  });
  
  // Find new perks (excluding discount perks)
  const newPerks = toPkg.perks
    .filter(p => !fromPerks.includes(p.id) && !p.id.startsWith('tier-discount-'))
    .map(p => p.name);
  
  // Calculate additional value
  const additionalValue = toPkg.baseAnnualValue - (fromPkg?.baseAnnualValue || 0);
  
  return { newServices, frequencyUpgrades, newPerks, additionalVisits, additionalValue };
};

export function TierUpgradePath({ packages }: TierUpgradePathProps) {
  if (packages.length < 3) return null;
  
  const [good, better, best] = packages;
  
  const goodToBetter = calculateUpgradeGains(good, better);
  const betterToBest = calculateUpgradeGains(better, best);
  
  return (
    <div className="card-elevated p-6">
      <div className="flex items-center gap-2 mb-6">
        <div className="section-icon w-8 h-8">
          <Zap className="w-4 h-4 text-primary-foreground" />
        </div>
        <div>
          <h3 className="font-display text-lg font-bold text-foreground">Upgrade Path</h3>
          <p className="text-xs text-muted-foreground">See what you gain at each tier</p>
        </div>
      </div>
      
      {/* Visual tier progression */}
      <div className="relative">
        {/* Tier cards with upgrade arrows */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-stretch">
          {/* Good Tier */}
          <TierCard
            name="Good"
            label={good.tierLabel}
            icon={Check}
            monthlyPrice={good.monthlyPrice}
            totalVisits={good.tierServices.reduce((sum, ts) => sum + ts.annualVisits, 0)}
            discount={good.savingsPercent}
            variant="good"
          />
          
          {/* Upgrade Arrow Good -> Better */}
          <UpgradeArrow
            gains={goodToBetter}
            fromTier="Good"
            toTier="Better"
          />
          
          {/* Better Tier */}
          <TierCard
            name="Better"
            label={better.tierLabel}
            icon={Star}
            monthlyPrice={better.monthlyPrice}
            totalVisits={better.tierServices.reduce((sum, ts) => sum + ts.annualVisits, 0)}
            discount={better.savingsPercent}
            variant="better"
            isRecommended
          />
          
          {/* Upgrade Arrow Better -> Best */}
          <UpgradeArrow
            gains={betterToBest}
            fromTier="Better"
            toTier="Best"
          />
          
          {/* Best Tier */}
          <TierCard
            name="Best"
            label={best.tierLabel}
            icon={Crown}
            monthlyPrice={best.monthlyPrice}
            totalVisits={best.tierServices.reduce((sum, ts) => sum + ts.annualVisits, 0)}
            discount={best.savingsPercent}
            variant="best"
          />
        </div>
      </div>
      
      {/* Summary callout */}
      <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-success/10 via-primary/10 to-accent/10 border border-primary/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-success/20">
            <Shield className="w-5 h-5 text-success" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">
              Upgrade for Peace of Mind
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Higher tiers mean more frequent service, better coverage, and zero-hassle maintenance. 
              The value increases faster than the price—your home stays cleaner with less worry.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TierCardProps {
  name: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  monthlyPrice: number;
  totalVisits: number;
  discount: number;
  variant: 'good' | 'better' | 'best';
  isRecommended?: boolean;
}

function TierCard({ name, label, icon: Icon, monthlyPrice, totalVisits, discount, variant, isRecommended }: TierCardProps) {
  const variantStyles = {
    good: 'bg-tier-good/10 border-tier-good/30',
    better: 'bg-primary/10 border-primary/30',
    best: 'bg-success/10 border-success/30',
  };
  
  const iconStyles = {
    good: 'bg-tier-good text-white',
    better: 'bg-tier-better text-primary-foreground',
    best: 'bg-tier-best text-success-foreground',
  };
  
  return (
    <div className={`relative p-4 rounded-xl border-2 ${variantStyles[variant]} ${isRecommended ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
      {isRecommended && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-primary text-primary-foreground whitespace-nowrap">
          Recommended
        </span>
      )}
      
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconStyles[variant]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="font-display font-bold text-foreground">{name}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        </div>
      </div>
      
      <div className="space-y-2">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-foreground">${monthlyPrice.toFixed(0)}</span>
          <span className="text-xs text-muted-foreground">/mo</span>
        </div>
        
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-muted/50">
            <Calendar className="w-3 h-3 text-muted-foreground" />
            <span className="font-medium">{totalVisits} visits/yr</span>
          </div>
        </div>
        
        <div className={`text-xs font-semibold ${
          variant === 'good' ? 'text-tier-good' : variant === 'better' ? 'text-primary' : 'text-success'
        }`}>
          Save {discount}%
        </div>
      </div>
    </div>
  );
}

interface UpgradeArrowProps {
  gains: ReturnType<typeof calculateUpgradeGains>;
  fromTier: string;
  toTier: string;
}

function UpgradeArrow({ gains, fromTier, toTier }: UpgradeArrowProps) {
  const hasGains = gains.newServices.length > 0 || gains.frequencyUpgrades.length > 0 || gains.newPerks.length > 0;
  
  return (
    <div className="flex flex-col items-center justify-center py-4 md:py-0">
      {/* Arrow icon */}
      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-r from-primary/20 to-success/20 border border-primary/30 mb-2">
        <ArrowRight className="w-5 h-5 text-primary" />
      </div>
      
      {/* Gains summary */}
      {hasGains && (
        <div className="text-center space-y-1">
          {gains.additionalVisits > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <Plus className="w-3 h-3 text-success" />
              <span className="font-semibold text-success">{gains.additionalVisits} visits</span>
            </div>
          )}
          
          {gains.frequencyUpgrades.length > 0 && (
            <div className="text-[10px] text-muted-foreground max-w-[100px]">
              {gains.frequencyUpgrades.slice(0, 1).map((upgrade, i) => (
                <span key={i}>
                  {formatFrequency(upgrade.from)} → {formatFrequency(upgrade.to)}
                </span>
              ))}
            </div>
          )}
          
          {gains.newServices.length > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <Plus className="w-3 h-3 text-primary" />
              <span className="font-medium text-primary">{gains.newServices.length} service{gains.newServices.length > 1 ? 's' : ''}</span>
            </div>
          )}
          
          {gains.newPerks.length > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <Plus className="w-3 h-3 text-accent" />
              <span className="font-medium text-accent">{gains.newPerks.length} perk{gains.newPerks.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}