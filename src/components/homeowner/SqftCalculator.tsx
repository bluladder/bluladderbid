import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calculator, Car, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";

interface SqftCalculatorProps {
  type: 'driveway' | 'porch' | 'patio' | 'poolDeck' | 'walkways';
  currentValue: number;
  onApply: (sqft: number) => void;
}

const PRESETS = {
  driveway: {
    label: "Driveway Size",
    icon: Car,
    options: [
      { label: "1-Car Driveway", sqft: 200, description: "~10' × 20'" },
      { label: "2-Car Driveway", sqft: 400, description: "~20' × 20'" },
      { label: "3-Car Driveway", sqft: 600, description: "~30' × 20'" },
      { label: "Extended/RV", sqft: 800, description: "~40' × 20'" },
    ],
  },
  porch: {
    label: "Porch Size",
    icon: Ruler,
    options: [
      { label: "Small Porch", sqft: 50, description: "~5' × 10'" },
      { label: "Medium Porch", sqft: 80, description: "~8' × 10'" },
      { label: "Large Porch", sqft: 120, description: "~10' × 12'" },
      { label: "Wraparound", sqft: 200, description: "~10' × 20'" },
    ],
  },
  patio: {
    label: "Patio Size",
    icon: Ruler,
    options: [
      { label: "Small Patio", sqft: 100, description: "~10' × 10'" },
      { label: "Medium Patio", sqft: 200, description: "~10' × 20'" },
      { label: "Large Patio", sqft: 300, description: "~15' × 20'" },
      { label: "Extra Large", sqft: 450, description: "~15' × 30'" },
    ],
  },
  poolDeck: {
    label: "Pool Deck Size",
    icon: Ruler,
    options: [
      { label: "Small Deck", sqft: 200, description: "~10' × 20'" },
      { label: "Medium Deck", sqft: 300, description: "~15' × 20'" },
      { label: "Large Deck", sqft: 450, description: "~15' × 30'" },
      { label: "Extra Large", sqft: 600, description: "~20' × 30'" },
    ],
  },
  walkways: {
    label: "Walkway Size",
    icon: Ruler,
    options: [
      { label: "Short Path", sqft: 50, description: "~3' × 15'" },
      { label: "Medium Path", sqft: 100, description: "~4' × 25'" },
      { label: "Long Path", sqft: 150, description: "~4' × 40'" },
      { label: "Multiple Paths", sqft: 200, description: "~Total area" },
    ],
  },
};

export function SqftCalculator({ type, currentValue, onApply }: SqftCalculatorProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [customLength, setCustomLength] = useState<string>("");
  const [customWidth, setCustomWidth] = useState<string>("");

  const config = PRESETS[type];
  const Icon = config.icon;

  const customSqft = (parseFloat(customLength) || 0) * (parseFloat(customWidth) || 0);

  const handleApply = () => {
    if (mode === 'preset' && selectedPreset) {
      const preset = config.options.find(o => o.label === selectedPreset);
      if (preset) {
        onApply(preset.sqft);
      }
    } else if (mode === 'custom' && customSqft > 0) {
      onApply(Math.round(customSqft));
    }
    setOpen(false);
    // Reset state
    setSelectedPreset("");
    setCustomLength("");
    setCustomWidth("");
    setMode('preset');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-primary"
        >
          <Calculator className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-popover z-50" align="end">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <h4 className="font-medium">{config.label} Calculator</h4>
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'preset' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setMode('preset')}
            >
              Quick Select
            </Button>
            <Button
              type="button"
              variant={mode === 'custom' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setMode('custom')}
            >
              Custom Size
            </Button>
          </div>

          {mode === 'preset' ? (
            <RadioGroup
              value={selectedPreset}
              onValueChange={setSelectedPreset}
              className="space-y-2"
            >
              {config.options.map((option) => (
                <label
                  key={option.label}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedPreset === option.label
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value={option.label} />
                    <div>
                      <p className="font-medium text-sm">{option.label}</p>
                      <p className="text-xs text-muted-foreground">{option.description}</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    {option.sqft} sqft
                  </span>
                </label>
              ))}
            </RadioGroup>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Enter length and width in feet
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Length (ft)</Label>
                  <Input
                    type="number"
                    placeholder="20"
                    value={customLength}
                    onChange={(e) => setCustomLength(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Width (ft)</Label>
                  <Input
                    type="number"
                    placeholder="10"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              {customSqft > 0 && (
                <div className="p-2 bg-muted rounded text-center">
                  <span className="text-sm">Calculated: </span>
                  <span className="font-semibold text-primary">{Math.round(customSqft)} sqft</span>
                </div>
              )}
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            onClick={handleApply}
            disabled={
              (mode === 'preset' && !selectedPreset) ||
              (mode === 'custom' && customSqft <= 0)
            }
          >
            Apply Estimate
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
