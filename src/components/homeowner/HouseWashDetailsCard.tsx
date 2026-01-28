import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { HouseWashDetails, SidingMaterial, StainType } from '@/types/homeowner';

interface HouseWashDetailsCardProps {
  details: HouseWashDetails;
  rustSurcharge: number;
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

export function HouseWashDetailsCard({ details, rustSurcharge, onChange }: HouseWashDetailsCardProps) {
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
      
      {/* Stain Type */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Primary Stain Type</Label>
        <RadioGroup
          value={details.stainType}
          onValueChange={(v) => onChange({ stainType: v as StainType })}
          className="grid gap-2 sm:grid-cols-2"
        >
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              details.stainType === 'organic'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <RadioGroupItem value="organic" className="mt-0.5" />
            <div>
              <div className="font-medium text-sm">Organic (Algae, Mildew, Dirt)</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Most common staining — included in base price
              </div>
            </div>
          </label>
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              details.stainType === 'rust'
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <RadioGroupItem value="rust" className="mt-0.5" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">Rust / Irrigation Stains</span>
                {details.stainType === 'rust' && rustSurcharge > 0 && (
                  <span className="text-xs font-semibold text-amber-600">
                    +{formatPrice(rustSurcharge)}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Requires specialized treatment
              </div>
            </div>
          </label>
        </RadioGroup>
        
        {details.stainType === 'rust' && (
          <Alert className="bg-amber-50 border-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs text-amber-800">
              Rust and irrigation stains require specialized treatment products and additional time. A 15% surcharge applies.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
