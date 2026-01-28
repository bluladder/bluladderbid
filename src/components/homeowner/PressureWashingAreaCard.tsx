import { Check } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SqftCalculator } from './SqftCalculator';
import type { FlatworkArea } from '@/types/homeowner';

type SurfaceType = 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile';

export interface PressureWashingAreaWithSurface extends FlatworkArea {
  surfaceType?: SurfaceType;
}

interface PressureWashingAreaCardProps {
  label: string;
  area: PressureWashingAreaWithSurface;
  price: number;
  defaultSqft: number;
  calculatorType: 'porch' | 'patio' | 'poolDeck' | 'walkways';
  onChange: (area: PressureWashingAreaWithSurface) => void;
  /** If true, show individual surface type selector for this area */
  showSurfaceType?: boolean;
}

const SURFACE_TYPE_OPTIONS: { value: SurfaceType; label: string }[] = [
  { value: 'concrete', label: 'Concrete' },
  { value: 'brick', label: 'Brick' },
  { value: 'pavers', label: 'Pavers' },
  { value: 'stone', label: 'Stone' },
  { value: 'tile', label: 'Tile' },
  { value: 'stamped', label: 'Stamped Concrete' },
];

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function PressureWashingAreaCard({ 
  label, 
  area, 
  price, 
  defaultSqft, 
  calculatorType, 
  onChange,
  showSurfaceType = true,
}: PressureWashingAreaCardProps) {
  return (
    <div className={`p-3 rounded-lg border transition-all ${
      area.enabled ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-2 cursor-pointer flex-1">
          <Checkbox
            checked={area.enabled}
            onCheckedChange={(checked) => onChange({ ...area, enabled: !!checked })}
          />
          <span className="text-sm font-medium">{label}</span>
        </label>
        {area.enabled && price > 0 && (
          <span className="text-xs font-semibold text-primary">{formatPrice(price)}</span>
        )}
      </div>
      
      {area.enabled && (
        <div className="space-y-3 pl-6">
          {/* Sqft input */}
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={area.sqft || ''}
              onChange={(e) => onChange({ ...area, sqft: parseInt(e.target.value) || defaultSqft })}
              placeholder={`~${defaultSqft}`}
              className="w-24 h-8 text-sm"
              inputMode="numeric"
            />
            <span className="text-xs text-muted-foreground">sq ft</span>
            <SqftCalculator
              type={calculatorType}
              currentValue={area.sqft}
              onApply={(sqft) => onChange({ ...area, sqft })}
            />
          </div>
          
          {/* Individual surface type selector */}
          {showSurfaceType && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Surface type</Label>
              <Select
                value={area.surfaceType || 'concrete'}
                onValueChange={(v) => onChange({ ...area, surfaceType: v as SurfaceType })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SURFACE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
