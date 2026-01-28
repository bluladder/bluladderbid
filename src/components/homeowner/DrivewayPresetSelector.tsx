import { useState } from 'react';
import { Car, Check } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Driveway preset sizes in sq ft
const DRIVEWAY_PRESETS = [
  { label: '1-car', sqft: 200, description: '~200 sq ft' },
  { label: '2-car', sqft: 400, description: '~400 sq ft' },
  { label: '3-car', sqft: 600, description: '~600 sq ft' },
  { label: 'RV / Extended', sqft: 800, description: '~800 sq ft' },
] as const;

interface DrivewayPresetSelectorProps {
  value: number;
  onChange: (sqft: number) => void;
}

export function DrivewayPresetSelector({ value, onChange }: DrivewayPresetSelectorProps) {
  const [showCustom, setShowCustom] = useState(false);
  
  // Check if current value matches a preset
  const selectedPreset = DRIVEWAY_PRESETS.find(p => p.sqft === value);
  const isCustomValue = value > 0 && !selectedPreset;

  const handlePresetSelect = (sqft: number) => {
    setShowCustom(false);
    onChange(sqft);
  };

  const handleCustomClick = () => {
    setShowCustom(true);
  };

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Driveway Size</Label>
      
      {/* Preset buttons */}
      <div className="grid grid-cols-2 gap-2">
        {DRIVEWAY_PRESETS.map((preset) => {
          const isSelected = selectedPreset?.sqft === preset.sqft && !showCustom;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => handlePresetSelect(preset.sqft)}
              className={cn(
                'flex flex-col items-start p-3 rounded-lg border text-left transition-all',
                isSelected
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'border-border hover:border-primary/40 hover:bg-muted/30'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-medium text-sm">{preset.label}</span>
                {isSelected && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">{preset.description}</span>
            </button>
          );
        })}
      </div>

      {/* Custom size option */}
      <div className="pt-2 border-t border-border/50">
        {showCustom || isCustomValue ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Custom size</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => {
                  setShowCustom(false);
                  onChange(400); // Reset to default 2-car
                }}
              >
                Use preset
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={value || ''}
                onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                placeholder="Enter sq ft"
                className="w-32 h-9"
                inputMode="numeric"
              />
              <span className="text-sm text-muted-foreground">sq ft</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleCustomClick}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Custom size →
          </button>
        )}
      </div>

      {/* Show calculated sqft after selection */}
      {(selectedPreset || isCustomValue) && value > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1.5 rounded">
          <Car className="w-3.5 h-3.5" />
          <span>Driveway: {value.toLocaleString()} sq ft</span>
        </div>
      )}
    </div>
  );
}
