import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import type { HouseWashDetails, SidingMaterial } from '@/types/homeowner';

interface HouseWashDetailsCardProps {
  details: HouseWashDetails;
  rustSurcharge: number;
  showAuthoritativePrice: boolean;
  priceStatus: string;
  onChange: (updates: Partial<HouseWashDetails>) => void;
}

const SIDING_OPTIONS: { value: SidingMaterial; label: string }[] = [
  { value: 'brick', label: 'Brick' },
  { value: 'hardie', label: 'Hardie / Fiber Cement' },
  { value: 'vinyl', label: 'Vinyl' },
  { value: 'stucco', label: 'Stucco' },
  { value: 'wood', label: 'Wood' },
];

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function HouseWashDetailsCard({
  details,
  rustSurcharge,
  showAuthoritativePrice,
  priceStatus,
  onChange,
}: HouseWashDetailsCardProps) {
  const rustSelected = details.stainType === 'rust';

  return (
    <div className="space-y-4">
      {/* Siding Material (informational only) */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Siding Material</Label>
        <p className="text-xs text-muted-foreground">Helps our team prepare the right cleaning approach</p>
        <RadioGroup
          value={details.sidingMaterial}
          onValueChange={(v) => onChange({ sidingMaterial: v as SidingMaterial })}
          className="grid grid-cols-2 sm:grid-cols-3 gap-2"
        >
          {SIDING_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm cursor-pointer transition-all ${
                details.sidingMaterial === option.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border hover:border-primary/50 text-muted-foreground'
              }`}
            >
              <RadioGroupItem value={option.value} className="sr-only" />
              <span>{option.label}</span>
            </label>
          ))}
        </RadioGroup>
      </div>
      
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-muted/30 p-3" data-testid="organic-cleaning-inclusion">
          <div className="text-sm font-medium text-foreground">Organic Cleaning Included</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Covers algae, mildew, cobwebs, dirt, and normal organic buildup.
          </p>
        </div>

        <label
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${
            rustSelected
              ? 'border-primary bg-primary/10'
              : 'border-border hover:border-primary/50'
          }`}
          data-testid="rust-treatment-option"
        >
          <Checkbox
            checked={rustSelected}
            onCheckedChange={(checked) => onChange({ stainType: checked ? 'rust' : 'organic' })}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Add Rust / Irrigation Stain Treatment</span>
              {rustSelected && (
                <span className="ml-auto text-xs font-semibold text-amber-700" data-testid="rust-surcharge-price">
                  {showAuthoritativePrice && rustSurcharge > 0
                    ? `+${formatPrice(rustSurcharge)}`
                    : priceStatus}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Specialized treatment for rust and sprinkler stains. Additional pricing applies.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
