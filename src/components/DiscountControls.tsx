import { DiscountSettings } from '@/types/servicePlan';
import { Slider } from '@/components/ui/slider';
import { AlertTriangle } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

interface DiscountControlsProps {
  discounts: DiscountSettings;
  depositPercent: number;
  pricingDisplayMode: 'monthly' | 'deposit';
  onDiscountChange: (key: keyof DiscountSettings, value: number) => void;
  onDepositChange: (value: number) => void;
  onPricingDisplayModeChange: (mode: 'monthly' | 'deposit') => void;
}

export function DiscountControls({
  discounts,
  depositPercent,
  pricingDisplayMode,
  onDiscountChange,
  onDepositChange,
  onPricingDisplayModeChange,
}: DiscountControlsProps) {
  return (
    <div className="card-elevated p-6 h-fit">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center shadow-sm">
          <svg className="w-5 h-5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h3 className="font-display font-bold text-foreground">Pricing & Discounts</h3>
          <p className="text-xs text-muted-foreground">Tier discounts & payment terms</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Tier Discounts */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tier Discounts</p>
          <DiscountSlider
            label="Standard"
            hint="Basic Coverage • 0-5% recommended"
            value={discounts.goodDiscount}
            onChange={(v) => onDiscountChange('goodDiscount', v)}
            tier="good"
            min={0}
            max={15}
          />
          <DiscountSlider
            label="Recommended"
            hint="Consistent Maintenance • 5-10% recommended"
            value={discounts.betterDiscount}
            onChange={(v) => onDiscountChange('betterDiscount', v)}
            tier="better"
            min={0}
            max={20}
          />
          <DiscountSlider
            label="Complete"
            hint="Total Coverage • 10-15% recommended"
            value={discounts.bestDiscount}
            onChange={(v) => onDiscountChange('bestDiscount', v)}
            tier="best"
            min={0}
            max={25}
            showWarning={discounts.bestDiscount > 20}
          />
        </div>

        {/* Payment Terms */}
        <div className="space-y-4 pt-4 border-t border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payment Terms</p>
          <DiscountSlider
            label="Pay-in-Full Bonus"
            hint="Extra discount for upfront payment"
            value={discounts.payInFullDiscount}
            onChange={(v) => onDiscountChange('payInFullDiscount', v)}
            tier="best"
            max={10}
          />

          {/* Pricing Display Mode */}
          <div className="bg-muted/50 rounded-lg p-4">
            <label className="text-sm font-medium text-foreground block mb-3">
              Pricing Display Format
            </label>
            <RadioGroup
              value={pricingDisplayMode}
              onValueChange={(v) => onPricingDisplayModeChange(v as 'monthly' | 'deposit')}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="monthly" id="monthly" />
                <Label htmlFor="monthly" className="text-sm cursor-pointer">
                  Flat monthly rate (e.g., $150/mo)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="deposit" id="deposit" />
                <Label htmlFor="deposit" className="text-sm cursor-pointer">
                  Deposit + 11 payments (e.g., $180 deposit + 11 × $135)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Deposit Amount - only show when deposit mode is selected */}
          {pricingDisplayMode === 'deposit' && (
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-foreground">
                  Deposit Amount
                </label>
                <span className="text-sm font-bold text-primary">
                  {depositPercent.toFixed(1)}%
                </span>
              </div>
              <Slider
                value={[depositPercent]}
                onValueChange={([v]) => onDepositChange(v)}
                min={0}
                max={25}
                step={0.5}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Deposit collected upfront, remaining in 11 monthly payments
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DiscountSliderProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  tier: 'good' | 'better' | 'best';
  min?: number;
  max: number;
  showWarning?: boolean;
}

function DiscountSlider({
  label,
  hint,
  value,
  onChange,
  tier,
  min = 0,
  max,
  showWarning,
}: DiscountSliderProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-2">
          {showWarning && (
            <AlertTriangle className="w-4 h-4 text-warning animate-pulse-subtle" />
          )}
          <span
            className={`text-sm font-bold ${
              tier === 'good'
                ? 'text-tier-good'
                : tier === 'better'
                ? 'text-tier-better'
                : 'text-tier-best'
            }`}
          >
            {value}% off
          </span>
        </div>
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground mb-2">{hint}</p>
      )}
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={1}
        className="w-full"
      />
    </div>
  );
}
