import { Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { RoofPitch } from '@/types/homeowner';

interface RoofPitchSelectorProps {
  pitch: RoofPitch;
  onChange: (pitch: RoofPitch) => void;
}

const PITCH_OPTIONS: { value: RoofPitch; label: string; description: string }[] = [
  { value: 'walkable', label: 'Walkable', description: 'Low slope, easy to stand on' },
  { value: 'moderate', label: 'Moderate Pitch', description: 'Some incline, requires care' },
  { value: 'steep', label: 'Steep / Non-Walkable', description: 'High incline, special equipment needed' },
];

export function RoofPitchSelector({ pitch, onChange }: RoofPitchSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">Roof Pitch</Label>
        <span className="text-xs text-muted-foreground italic flex items-center gap-1">
          <Info className="w-3 h-3" />
          Planning only
        </span>
      </div>
      <RadioGroup
        value={pitch}
        onValueChange={(v) => onChange(v as RoofPitch)}
        className="grid gap-2"
      >
        {PITCH_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              pitch === option.value
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <RadioGroupItem value={option.value} />
            <div>
              <div className="font-medium text-sm">{option.label}</div>
              <div className="text-xs text-muted-foreground">{option.description}</div>
            </div>
          </label>
        ))}
      </RadioGroup>
      <p className="text-xs text-muted-foreground mt-1 pl-1">
        Used for planning only — not final pricing.
      </p>
    </div>
  );
}
