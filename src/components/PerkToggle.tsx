import { Perk, MemberDiscountSettings } from '@/types/servicePlan';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, Star, Shield, Trash2, Percent } from 'lucide-react';

interface PerkToggleProps {
  perk: Perk;
  onToggle: (id: string) => void;
  onTierChange?: (id: string, tier: Perk['tier']) => void;
  onDelete?: (id: string) => void;
  isCustom?: boolean;
  // For member discount perks
  memberDiscounts?: MemberDiscountSettings;
  onMemberDiscountChange?: (key: keyof MemberDiscountSettings, value: number) => void;
}

const tierIcons: Record<string, React.ElementType> = {
  good: Check,
  better: Shield,
  best: Star,
};

export function PerkToggle({ 
  perk, 
  onToggle, 
  onTierChange, 
  onDelete, 
  isCustom,
  memberDiscounts,
  onMemberDiscountChange,
}: PerkToggleProps) {
  const Icon = tierIcons[perk.tier];
  const isDiscountPerk = perk.id.startsWith('tier-discount-');

  // Determine which tier this discount perk applies to
  const discountTier = isDiscountPerk ? perk.id.replace('tier-discount-', '') as 'good' | 'better' | 'best' : null;
  
  // Get the current member discount value for this tier
  const getMemberDiscountValue = (): number => {
    if (!memberDiscounts || !discountTier) return 0;
    const keyMap = { good: 'goodMemberDiscount', better: 'betterMemberDiscount', best: 'bestMemberDiscount' } as const;
    return memberDiscounts[keyMap[discountTier]];
  };
  
  const discountValue = getMemberDiscountValue();

  const tierLabel = isDiscountPerk
    ? `${discountTier === 'good' ? 'Standard' : discountTier === 'better' ? 'Recommended' : 'Complete'}`
    : perk.tier === 'good'
      ? 'All'
      : perk.tier === 'better'
        ? 'Better+Best'
        : 'Best only';

  const handleDiscountChange = (value: number) => {
    if (!onMemberDiscountChange || !discountTier) return;
    const keyMap = { good: 'goodMemberDiscount', better: 'betterMemberDiscount', best: 'bestMemberDiscount' } as const;
    onMemberDiscountChange(keyMap[discountTier], value);
  };

  return (
    <div
      className={`flex flex-col p-4 rounded-lg border transition-all duration-200 ${
        perk.enabled
          ? 'border-primary/30 bg-primary/5'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              perk.tier === 'good'
                ? 'bg-tier-good/10 text-tier-good'
                : perk.tier === 'better'
                ? 'bg-tier-better/10 text-tier-better'
                : 'bg-tier-best/10 text-tier-best'
            }`}
          >
            {isDiscountPerk ? <Percent className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                {isDiscountPerk ? `${discountValue}% Member Discount` : perk.name}
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  perk.tier === 'good'
                    ? 'bg-tier-good/10 text-tier-good'
                    : perk.tier === 'better'
                    ? 'bg-tier-better/10 text-tier-better'
                    : 'bg-tier-best/10 text-tier-best'
                }`}
              >
                {tierLabel}
              </span>
              {isCustom && (
                <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                  Custom
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {isDiscountPerk ? 'Exclusive member pricing on all additional services' : (perk.description || 'Custom perk')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isDiscountPerk && onTierChange && (
            <div className="hidden sm:block">
              <Select
                value={perk.tier}
                onValueChange={(v) => onTierChange(perk.id, v as Perk['tier'])}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue placeholder="Applies to" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">All packages</SelectItem>
                  <SelectItem value="better">Better + Best</SelectItem>
                  <SelectItem value="best">Best only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {isCustom && onDelete && (
            <button
              onClick={() => onDelete(perk.id)}
              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete perk"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <Switch checked={perk.enabled} onCheckedChange={() => onToggle(perk.id)} />
        </div>
      </div>
      
      {/* Adjustable slider for member discount perks */}
      {isDiscountPerk && perk.enabled && onMemberDiscountChange && memberDiscounts && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Discount Amount</span>
            <span className={`text-sm font-bold ${
              perk.tier === 'good'
                ? 'text-tier-good'
                : perk.tier === 'better'
                ? 'text-tier-better'
                : 'text-tier-best'
            }`}>
              {discountValue}%
            </span>
          </div>
          <Slider
            value={[discountValue]}
            onValueChange={([v]) => handleDiscountChange(v)}
            min={0}
            max={25}
            step={1}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}
