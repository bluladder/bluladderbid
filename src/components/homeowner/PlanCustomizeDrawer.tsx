import { useState, useEffect, useMemo } from 'react';
import { Settings2, Calendar, Sparkles, Check, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import type { BundleTier, WindowFrequencyConfig } from '@/types/homeowner';

interface PlanCustomizeDrawerProps {
  bundle: BundleTier;
  baseExteriorPrice: number;
  baseInteriorPrice: number;
  onCustomize: (config: WindowFrequencyConfig) => void;
  children?: React.ReactNode;
}

const FREQUENCY_LABELS: Record<number, string> = {
  0: 'Not included',
  1: '1× per year',
  2: '2× per year',
  3: '3× per year',
  4: '4× per year (Quarterly)',
};

// Allowed ranges per tier to maintain hierarchy
const TIER_FREQUENCY_LIMITS = {
  good: {
    exterior: { min: 1, max: 4 },
    interior: { min: 0, max: 0 }, // Good tier = exterior only
  },
  better: {
    exterior: { min: 2, max: 4 },
    interior: { min: 1, max: 2 },
  },
  best: {
    exterior: { min: 3, max: 4 },
    interior: { min: 2, max: 2 },
  },
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function PlanCustomizeDrawer({
  bundle,
  baseExteriorPrice,
  baseInteriorPrice,
  onCustomize,
  children,
}: PlanCustomizeDrawerProps) {
  const [open, setOpen] = useState(false);
  const [exteriorFreq, setExteriorFreq] = useState<number>(
    bundle.windowFrequencyConfig.exteriorFrequency
  );
  const [interiorFreq, setInteriorFreq] = useState<number>(
    bundle.windowFrequencyConfig.interiorFrequency
  );

  const limits = TIER_FREQUENCY_LIMITS[bundle.tier];

  // Reset when bundle changes
  useEffect(() => {
    setExteriorFreq(bundle.windowFrequencyConfig.exteriorFrequency);
    setInteriorFreq(bundle.windowFrequencyConfig.interiorFrequency);
  }, [bundle]);

  // Calculate price impact
  const priceImpact = useMemo(() => {
    const originalWindowCost =
      baseExteriorPrice * bundle.windowFrequencyConfig.exteriorFrequency +
      baseInteriorPrice * bundle.windowFrequencyConfig.interiorFrequency;

    const newWindowCost =
      baseExteriorPrice * exteriorFreq + baseInteriorPrice * interiorFreq;

    return newWindowCost - originalWindowCost;
  }, [exteriorFreq, interiorFreq, baseExteriorPrice, baseInteriorPrice, bundle]);

  const newAnnualTotal = bundle.annualTotal + priceImpact;
  const newMonthlyPayment = Math.round(newAnnualTotal / 12);

  const hasChanges =
    exteriorFreq !== bundle.windowFrequencyConfig.exteriorFrequency ||
    interiorFreq !== bundle.windowFrequencyConfig.interiorFrequency;

  const handleApply = () => {
    onCustomize({
      exteriorFrequency: exteriorFreq as 1 | 2 | 3 | 4,
      interiorFrequency: interiorFreq as 0 | 1 | 2,
    });
    setOpen(false);
  };

  const handleReset = () => {
    setExteriorFreq(bundle.windowFrequencyConfig.exteriorFrequency);
    setInteriorFreq(bundle.windowFrequencyConfig.interiorFrequency);
  };

  // Check if interior is available for this tier
  const interiorAvailable = limits.interior.max > 0;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {children || (
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <Settings2 className="w-3.5 h-3.5" />
            Customize
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              Customize {bundle.name} Plan
            </DrawerTitle>
            <DrawerDescription>
              Adjust window cleaning frequency to match your needs
            </DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-4 space-y-6">
            {/* Exterior Frequency */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Calendar className="w-4 h-4 text-primary" />
                  Exterior Windows
                </Label>
                <span className="text-sm font-medium text-primary">
                  {FREQUENCY_LABELS[exteriorFreq]}
                </span>
              </div>
              <Slider
                value={[exteriorFreq]}
                onValueChange={([val]) => setExteriorFreq(val)}
                min={limits.exterior.min}
                max={limits.exterior.max}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{limits.exterior.min}×/yr</span>
                <span>{limits.exterior.max}×/yr</span>
              </div>
            </div>

            {/* Interior Frequency */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="w-4 h-4 text-accent" />
                  Interior Windows
                </Label>
                <span className="text-sm font-medium text-accent">
                  {FREQUENCY_LABELS[interiorFreq]}
                </span>
              </div>
              {interiorAvailable ? (
                <>
                  <Slider
                    value={[interiorFreq]}
                    onValueChange={([val]) => setInteriorFreq(val)}
                    min={limits.interior.min}
                    max={limits.interior.max}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{limits.interior.min}×/yr</span>
                    <span>{limits.interior.max}×/yr</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  <Info className="w-4 h-4" />
                  <span>
                    Interior cleaning requires Better or Best plan
                  </span>
                </div>
              )}
            </div>

            {/* Real-time Price Preview */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="text-sm font-medium text-muted-foreground">
                Updated Pricing
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold text-foreground">
                    {formatPrice(newMonthlyPayment)}
                    <span className="text-base font-normal text-muted-foreground">
                      /mo
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatPrice(newAnnualTotal)} per year
                  </div>
                </div>
                {hasChanges && (
                  <div
                    className={`text-sm font-medium ${
                      priceImpact > 0 ? 'text-amber-600' : 'text-green-600'
                    }`}
                  >
                    {priceImpact > 0 ? '+' : ''}
                    {formatPrice(priceImpact)}/yr
                  </div>
                )}
              </div>
            </div>

            {/* What's Included Summary */}
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">
                Your Schedule
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-success" />
                  <span>
                    Exterior windows cleaned {exteriorFreq}× per year
                  </span>
                </div>
                {interiorFreq > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-success" />
                    <span>
                      Interior windows cleaned {interiorFreq}× per year
                    </span>
                  </div>
                )}
                {bundle.additionalServicesIncluded.slice(0, 2).map((svc, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span>{svc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DrawerFooter className="flex-row gap-2">
            {hasChanges && (
              <Button variant="ghost" onClick={handleReset} className="flex-1">
                Reset
              </Button>
            )}
            <DrawerClose asChild>
              <Button variant="outline" className={hasChanges ? '' : 'flex-1'}>
                Cancel
              </Button>
            </DrawerClose>
            <Button onClick={handleApply} className="flex-1" disabled={!hasChanges}>
              Apply Changes
            </Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
