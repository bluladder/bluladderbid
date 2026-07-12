import { useState, useEffect, useMemo } from 'react';
import { Settings2, Calendar, Sparkles, Check, Info, ArrowLeftRight, AlertCircle } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import type { BundleTier, WindowFrequencyConfig, HomeDetails, AdditionalServices } from '@/types/homeowner';
import { useServerBundleTiers } from '@/hooks/useServerBundleTiers';

// Service swap configuration
export interface ServiceSwap {
  from: string;
  to: string;
}

export interface PlanCustomization {
  windowFrequency: WindowFrequencyConfig;
  serviceSwaps: ServiceSwap[];
  addedServices: string[];
}

interface PlanCustomizeDrawerProps {
  bundle: BundleTier;
  baseExteriorPrice: number;
  baseInteriorPrice: number;
  servicePrices: {
    gutterCleaning: number;
    houseWash: number;
    roofCleaning: number;
  };
  /** Needed so the live preview price is computed by the server, not locally. */
  homeDetails: HomeDetails;
  additionalServices: AdditionalServices;
  onCustomize: (customization: PlanCustomization) => void;
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
    interior: { min: 0, max: 0 },
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

// Service definitions for swapping
const SWAPPABLE_SERVICES = {
  gutter_cleaning: { label: 'Gutter Cleaning', icon: '🏠' },
  house_wash: { label: 'House Wash', icon: '🧽' },
  roof_cleaning: { label: 'Roof Cleaning', icon: '🏡' },
};

// What services each tier can include (for swaps)
const TIER_SWAP_OPTIONS: Record<string, string[]> = {
  good: [], // Good tier has no included services to swap
  better: ['gutter_cleaning', 'house_wash'], // Can swap between these
  best: ['gutter_cleaning', 'house_wash', 'roof_cleaning'], // Can swap between these
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
  servicePrices,
  homeDetails,
  additionalServices,
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
  
  // Service swap state - track which services are currently selected
  const [selectedServices, setSelectedServices] = useState<string[]>(bundle.baseServices);

  const limits = TIER_FREQUENCY_LIMITS[bundle.tier];
  const swapOptions = TIER_SWAP_OPTIONS[bundle.tier];
  const canSwap = swapOptions.length > 1;

  // Get the default included services for this tier
  const defaultIncludedServices = useMemo(() => {
    return bundle.baseServices;
  }, [bundle.baseServices]);

  // Calculate minimum required services based on tier
  const minServices = bundle.tier === 'good' ? 0 : bundle.tier === 'better' ? 1 : 2;
  const maxServices = bundle.tier === 'good' ? 0 : bundle.tier === 'better' ? 2 : 3;

  // Reset when bundle changes
  useEffect(() => {
    setExteriorFreq(bundle.windowFrequencyConfig.exteriorFrequency);
    setInteriorFreq(bundle.windowFrequencyConfig.interiorFrequency);
    setSelectedServices(bundle.baseServices);
  }, [bundle]);

  // Check if there are any changes
  const hasFrequencyChanges =
    exteriorFreq !== bundle.windowFrequencyConfig.exteriorFrequency ||
    interiorFreq !== bundle.windowFrequencyConfig.interiorFrequency;

  const hasServiceChanges = useMemo(() => {
    if (selectedServices.length !== defaultIncludedServices.length) return true;
    return !selectedServices.every(svc => defaultIncludedServices.includes(svc));
  }, [selectedServices, defaultIncludedServices]);

  const hasChanges = hasFrequencyChanges || hasServiceChanges;

  // Calculate swaps for the callback
  const calculateSwaps = (): ServiceSwap[] => {
    const removed = defaultIncludedServices.filter(svc => !selectedServices.includes(svc));
    const added = selectedServices.filter(svc => !defaultIncludedServices.includes(svc));
    
    const swaps: ServiceSwap[] = [];
    const swapCount = Math.min(removed.length, added.length);
    
    for (let i = 0; i < swapCount; i++) {
      swaps.push({ from: removed[i], to: added[i] });
    }
    
    return swaps;
  };

  // ------------------------------------------------------------------
  // LIVE PREVIEW PRICING — server-authoritative. The in-progress
  // customization is sent to calculate-plan-options (bundle_tiers) and the
  // returned tier price is displayed. No local delta/frequency/swap math.
  // ------------------------------------------------------------------
  const previewCustomization = useMemo<PlanCustomization>(() => {
    const removed = defaultIncludedServices.filter((svc) => !selectedServices.includes(svc));
    const added = selectedServices.filter((svc) => !defaultIncludedServices.includes(svc));
    const swaps: ServiceSwap[] = [];
    const swapCount = Math.min(removed.length, added.length);
    for (let i = 0; i < swapCount; i++) swaps.push({ from: removed[i], to: added[i] });
    return {
      windowFrequency: {
        exteriorFrequency: exteriorFreq as 1 | 2 | 3 | 4,
        interiorFrequency: interiorFreq as 0 | 1 | 2,
      },
      serviceSwaps: swaps,
      addedServices: added,
    };
  }, [defaultIncludedServices, selectedServices, exteriorFreq, interiorFreq]);

  const previewState = useServerBundleTiers(
    open ? { homeDetails, additionalServices, customizations: { [bundle.tier]: previewCustomization } } : null,
    { enabled: open, debounceMs: 300 },
  );
  const previewTier = previewState.bundles.find((b) => b.tier === bundle.tier) ?? null;
  const previewLoading = previewState.loading || (open && !previewTier && !previewState.isUnavailable);
  const newAnnualTotal = previewTier?.annualTotal ?? null;
  const newMonthlyPayment = previewTier?.monthlyPayment ?? null;
  // Display-only difference between two server-computed totals (not a price calc).
  const totalPriceImpact =
    previewTier != null ? previewTier.annualTotal - bundle.annualTotal : 0;

  const handleApply = () => {
    onCustomize({
      windowFrequency: {
        exteriorFrequency: exteriorFreq as 1 | 2 | 3 | 4,
        interiorFrequency: interiorFreq as 0 | 1 | 2,
      },
      serviceSwaps: calculateSwaps(),
      addedServices: selectedServices.filter(svc => !defaultIncludedServices.includes(svc)),
    });
    setOpen(false);
  };

  const handleReset = () => {
    setExteriorFreq(bundle.windowFrequencyConfig.exteriorFrequency);
    setInteriorFreq(bundle.windowFrequencyConfig.interiorFrequency);
    setSelectedServices(bundle.baseServices);
  };

  const toggleService = (serviceId: string) => {
    setSelectedServices(prev => {
      const isCurrentlySelected = prev.includes(serviceId);
      
      if (isCurrentlySelected) {
        // Don't allow going below minimum
        if (prev.length <= minServices) return prev;
        return prev.filter(s => s !== serviceId);
      } else {
        // Don't allow going above maximum
        if (prev.length >= maxServices) return prev;
        return [...prev, serviceId];
      }
    });
  };

  const interiorAvailable = limits.interior.max > 0;

  // Check for pricing guardrail violations
  const guardrailWarning = useMemo(() => {
    // The $25 minimum-tier-buffer guardrail is enforced SERVER-SIDE by the
    // canonical engine; this is only a soft, display-time hint.
    if (newAnnualTotal == null) return null;
    if (bundle.tier === 'better' && newAnnualTotal < bundle.annualTotal * 0.7) {
      return "This configuration may be limited to maintain plan hierarchy";
    }
    if (bundle.tier === 'best' && newAnnualTotal < bundle.annualTotal * 0.8) {
      return "This configuration may be limited to maintain plan hierarchy";
    }
    return null;
  }, [bundle, newAnnualTotal]);

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
        <div className="mx-auto w-full max-w-md max-h-[85vh] overflow-y-auto">
          <DrawerHeader className="text-left">
            <DrawerTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              Customize {bundle.name} Plan
            </DrawerTitle>
            <DrawerDescription>
              Adjust frequency and services to match your needs
            </DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-4 space-y-6">
            {/* Window Frequency Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Calendar className="w-4 h-4 text-primary" />
                Window Cleaning Schedule
              </div>
              
              {/* Exterior Frequency */}
              <div className="space-y-2 pl-6">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Exterior Windows</Label>
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
              <div className="space-y-2 pl-6">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Interior Windows</Label>
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
                  <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-xs text-muted-foreground">
                    <Info className="w-3.5 h-3.5" />
                    <span>Upgrade to Better or Best for interior cleaning</span>
                  </div>
                )}
              </div>
            </div>

            {/* Service Swap Section */}
            {canSwap && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ArrowLeftRight className="w-4 h-4 text-primary" />
                      Included Services
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {selectedServices.length}/{maxServices} selected
                    </Badge>
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    Toggle services on or off. Select {minServices}-{maxServices} services for your plan.
                  </p>

                  <div className="space-y-3">
                    {swapOptions.map((serviceId) => {
                      const service = SWAPPABLE_SERVICES[serviceId as keyof typeof SWAPPABLE_SERVICES];
                      const isSelected = selectedServices.includes(serviceId);
                      const isDefault = defaultIncludedServices.includes(serviceId);
                      const price = serviceId === 'gutter_cleaning' 
                        ? servicePrices.gutterCleaning 
                        : serviceId === 'house_wash' 
                          ? servicePrices.houseWash 
                          : servicePrices.roofCleaning;
                      
                      return (
                        <div
                          key={serviceId}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                            isSelected 
                              ? 'border-primary/50 bg-primary/5' 
                              : 'border-border bg-muted/30'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{service.icon}</span>
                            <div>
                              <div className="text-sm font-medium">{service.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatPrice(price)}/year
                                {isDefault && !isSelected && (
                                  <span className="ml-1 text-amber-600">(was included)</span>
                                )}
                                {!isDefault && isSelected && (
                                  <span className="ml-1 text-green-600">(adding)</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <Switch
                            checked={isSelected}
                            onCheckedChange={() => toggleService(serviceId)}
                            disabled={
                              (isSelected && selectedServices.length <= minServices) ||
                              (!isSelected && selectedServices.length >= maxServices)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Guardrail Warning */}
            {guardrailWarning && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{guardrailWarning}</span>
              </div>
            )}

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
                      totalPriceImpact > 0 ? 'text-amber-600' : totalPriceImpact < 0 ? 'text-green-600' : ''
                    }`}
                  >
                    {totalPriceImpact > 0 ? '+' : ''}
                    {totalPriceImpact !== 0 && formatPrice(totalPriceImpact) + '/yr'}
                  </div>
                )}
              </div>
            </div>

            {/* Summary of Changes */}
            {hasChanges && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">
                  Your Customizations
                </div>
                <div className="space-y-1.5">
                  {hasFrequencyChanges && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-success" />
                      <span>
                        Windows: {exteriorFreq}× exterior
                        {interiorFreq > 0 && `, ${interiorFreq}× interior`}
                      </span>
                    </div>
                  )}
                  {selectedServices.map((svc) => {
                    const service = SWAPPABLE_SERVICES[svc as keyof typeof SWAPPABLE_SERVICES];
                    const isNew = !defaultIncludedServices.includes(svc);
                    return (
                      <div key={svc} className="flex items-center gap-2 text-sm">
                        <Sparkles className={`w-4 h-4 ${isNew ? 'text-accent' : 'text-primary'}`} />
                        <span>
                          {service?.label}
                          {isNew && <Badge variant="secondary" className="ml-2 text-xs">Added</Badge>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
