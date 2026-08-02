import { useState } from 'react';
import { Sparkles, Droplets, Home, Cloud, Warehouse, ChevronDown, ChevronUp, Grid3X3, SunMedium, ArrowUpFromLine, Square, Car, ShieldCheck, Sun, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AdditionalServices, ServicePrices, HomeDetails, FlatworkArea } from '@/types/homeowner';
import { FLATWORK_DEFAULT_SQFT } from '@/types/homeowner';
import { SqftCalculator } from './SqftCalculator';
import { DrivewayPresetSelector } from './DrivewayPresetSelector';
import { PressureWashingAreaCard } from './PressureWashingAreaCard';
import { GutterAddonsCard } from './GutterAddonsCard';
import { HouseWashDetailsCard } from './HouseWashDetailsCard';
import { RoofPitchSelector } from './RoofPitchSelector';
import type { WindowPromoConfig } from '@/hooks/useWindowPromoConfig';
import { ChoiceCard } from '@/components/quote/ChoiceCard';
import { SummaryRow } from '@/components/quote/SummaryRow';
import type { ServerQuotePhase } from '@/hooks/useServerQuoteCalculation';
import type { QuoteIntegrity, QuoteServiceId } from '@/lib/pricing/quoteIntegrity';

interface IntentFirstServiceSelectorProps {
  services: AdditionalServices;
  servicePrices: ServicePrices;
  homeDetails: HomeDetails;
  onChange: (updates: Partial<AdditionalServices>) => void;
  onHomeDetailsChange: (updates: Partial<HomeDetails>) => void;
  featuredService?: 'windowCleaning' | 'gutterCleaning' | 'houseWash' | 'roofCleaning' | 'drivewayCleaning' | 'pressureWashing' | 'solarPanelCleaning' | 'screenRepair';
  /** Active $99 window promo config from admin. When null, the promo option is hidden entirely. */
  windowPromo?: WindowPromoConfig | null;
  /** Current canonical one-time quote state; prices are actionable only for firm/estimated quotes. */
  quotePhase: ServerQuotePhase;
  quoteIntegrity?: QuoteIntegrity;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

const SERVICE_ORDER = [
  'windowCleaning',
  'drivewayCleaning',
  'pressureWashing',
  'gutterCleaning',
  'houseWash',
  'roofCleaning',
  'solarPanelCleaning',
  'screenRepair',
] as const;

type ServiceId = (typeof SERVICE_ORDER)[number];

const servicePresentation: Record<ServiceId, {
  icon: React.ElementType;
  title: string;
  description: string;
}> = {
  windowCleaning: {
    icon: Sparkles,
    title: 'Window Cleaning',
    description: 'Streak-free interior or exterior window care',
  },
  drivewayCleaning: {
    icon: Car,
    title: 'Driveway Cleaning',
    description: 'Lift stains, mildew, and buildup from driveways',
  },
  pressureWashing: {
    icon: Droplets,
    title: 'Pressure Washing',
    description: 'Refresh porches, patios, pool decks, and walkways',
  },
  gutterCleaning: {
    icon: Home,
    title: 'Gutter Cleaning',
    description: 'Help prevent water damage and drainage problems',
  },
  houseWash: {
    icon: Warehouse,
    title: 'House Wash',
    description: 'Gentle soft washing for exterior organic buildup',
  },
  roofCleaning: {
    icon: Cloud,
    title: 'Roof Cleaning',
    description: 'Low-pressure treatment for roof stains and growth',
  },
  solarPanelCleaning: {
    icon: Sun,
    title: 'Solar Panel Cleaning',
    description: 'Remove output-blocking dust, pollen, and debris',
  },
  screenRepair: {
    icon: Wrench,
    title: 'Screen Repair',
    description: 'Repair standard removable window-screen mesh',
  },
};

interface ServiceCardProps {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  price: number;
  isEnabled: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  children?: React.ReactNode;
  isFeatured?: boolean;
  /** Optional short benefit line shown in the compact card to justify the add. */
  benefit?: string;
  /** Optional "from $X" price anchor shown in the compact card. */
  anchorPrice?: number;
  /** Optional badge label (e.g. "Included with Better plan"). */
  badge?: string;
  /** Fail-closed status shown instead of a missing or stale dollar amount. */
  priceStatus?: string;
}

function ServiceCard({
  id,
  icon: Icon,
  title,
  description,
  price,
  isEnabled,
  isExpanded,
  onSelect,
  onEdit,
  onRemove,
  children,
  isFeatured,
  benefit,
  anchorPrice,
  badge,
  priceStatus,
}: ServiceCardProps) {
  if (!isEnabled) {
    return (
      <ChoiceCard
        icon={Icon}
        title={title}
        description={benefit || description}
        featured={isFeatured}
        badge={badge}
        meta={anchorPrice && anchorPrice > 0 ? <>from <strong>{formatPrice(anchorPrice)}</strong></> : 'Get instant pricing'}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className="space-y-3" data-service-id={id}>
      <SummaryRow
        icon={Icon}
        title={title}
        description={description}
        price={price > 0 ? formatPrice(price) : priceStatus}
        onEdit={onEdit}
        onRemove={onRemove}
      />
      {isExpanded && children && (
        <div className="rounded-xl border-2 border-primary bg-card p-4 shadow-sm" data-testid={`service-editor-${id}`}>
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <h3 className="font-semibold text-foreground">Customize {title}</h3>
              <p className="text-xs text-muted-foreground">Your service stays selected while you edit these details.</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onEdit}
              aria-label={`Collapse ${title}`}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

// Component for flatwork area selection with sqft input
interface FlatworkAreaInputProps {
  label: string;
  area: FlatworkArea;
  price: number;
  defaultSqft: number;
  calculatorType: 'porch' | 'patio' | 'poolDeck' | 'walkways';
  onChange: (area: FlatworkArea) => void;
}

function FlatworkAreaInput({ label, area, price, defaultSqft, calculatorType, onChange }: FlatworkAreaInputProps) {
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
        <div className="flex items-center gap-1 pl-6">
          <Input
            type="number"
            value={area.sqft || ''}
            onChange={(e) => onChange({ ...area, sqft: parseInt(e.target.value) || defaultSqft })}
            placeholder={`~${defaultSqft}`}
            className="w-24 h-8 text-sm"
          />
          <span className="text-xs text-muted-foreground">sq ft</span>
          <SqftCalculator
            type={calculatorType}
            currentValue={area.sqft}
            onApply={(sqft) => onChange({ ...area, sqft })}
          />
        </div>
      )}
    </div>
  );
}

export function IntentFirstServiceSelector({ 
  services, 
  servicePrices, 
  homeDetails,
  onChange,
  onHomeDetailsChange,
  featuredService,
  windowPromo,
  quotePhase,
  quoteIntegrity,
}: IntentFirstServiceSelectorProps) {
  const [editingService, setEditingService] = useState<string | null>(featuredService ?? null);

  // Helper to check if a service is featured
  const isFeatured = (serviceId: string) => featuredService === serviceId;

  const promoActive = !!windowPromo;
  const isPromoSelected = promoActive && homeDetails.windowCleaningType === 'promo_99';

  // Define service order - featured service goes first
  // Reorder to put featured service first
  const orderedServices: readonly ServiceId[] = featuredService
    ? [featuredService, ...SERVICE_ORDER.filter(s => s !== featuredService)]
    : SERVICE_ORDER;

  const isServiceEnabled = (serviceId: ServiceId) => {
    switch (serviceId) {
      case 'windowCleaning': return services.windowCleaning;
      case 'drivewayCleaning': return services.drivewayCleaning.enabled;
      case 'pressureWashing': return services.pressureWashing.enabled;
      case 'gutterCleaning': return services.gutterCleaning;
      case 'houseWash': return services.houseWash;
      case 'roofCleaning': return services.roofCleaning;
      case 'solarPanelCleaning': return services.solarPanelCleaning.enabled;
      case 'screenRepair': return services.screenRepair.enabled;
      default: return false;
    }
  };

  const selectedServiceIds = orderedServices.filter(isServiceEnabled);
  const inactiveServiceIds = orderedServices.filter((serviceId) => !isServiceEnabled(serviceId));
  const readinessFor = (serviceId: QuoteServiceId) =>
    quoteIntegrity?.services.find((service) => service.id === serviceId);
  const priceStatusFor = (serviceId: QuoteServiceId) => {
    const readiness = readinessFor(serviceId);
    if (readiness) return readiness.message;
    if (quotePhase === 'loading' || quotePhase === 'idle') return 'Recalculating';
    if (quotePhase === 'missing_information') return 'Complete required service details';
    if (quotePhase === 'manual_review_required') return 'Manual review required';
    return 'Pricing temporarily unavailable';
  };
  const authoritativePrice = (price: number, serviceId: QuoteServiceId) =>
    (readinessFor(serviceId)?.state === 'priced' ||
      (!quoteIntegrity && (quotePhase === 'firm' || quotePhase === 'estimated'))) && price > 0 ? price : 0;
  const pressureWashingHasArea = [
    services.pressureWashing.frontPorch,
    services.pressureWashing.backPatio,
    services.pressureWashing.poolDeck,
    services.pressureWashing.walkways,
  ].some((area) => area.enabled);
  const hasAuthoritativePressureWashingPrice =
    pressureWashingHasArea && authoritativePrice(servicePrices.pressureWashing, 'pressureWashing') > 0;
  const pressureWashingPriceStatus = pressureWashingHasArea
    ? priceStatusFor('pressureWashing')
    : 'Select at least one area';
  const hasAuthoritativeGutterPrice =
    (readinessFor('gutterCleaning')?.state === 'priced' ||
      (!quoteIntegrity && (quotePhase === 'firm' || quotePhase === 'estimated'))) &&
    servicePrices.gutterCleaning > 0 &&
    servicePrices.gutterCleaningTotal >= servicePrices.gutterCleaning;
  const rustTreatmentSelected = services.houseWashDetails.stainType === 'rust';
  const hasAuthoritativeHouseWashPrice =
    (readinessFor('houseWash')?.state === 'priced' ||
      (!quoteIntegrity && (quotePhase === 'firm' || quotePhase === 'estimated'))) &&
    servicePrices.houseWash > 0 &&
    servicePrices.houseWashTotal >= servicePrices.houseWash &&
    (!rustTreatmentSelected || servicePrices.houseWashRustSurcharge > 0);

  const gutterPriceStatus = priceStatusFor('gutterCleaning');
  const houseWashPriceStatus = priceStatusFor('houseWash');

  const toggleGutterCleaning = () => {
    if (!services.gutterCleaning) {
      onChange({ gutterCleaning: true });
      return;
    }
    onChange({
      gutterCleaning: false,
      gutterAddons: {
        ...services.gutterAddons,
        undergroundDrains: {
          ...services.gutterAddons.undergroundDrains,
          enabled: false,
        },
        minorRepairs: false,
        gutterGuards: {
          ...services.gutterAddons.gutterGuards,
          enabled: false,
        },
      },
    });
  };

  const toggleHouseWash = () => {
    if (!services.houseWash) {
      onChange({ houseWash: true });
      return;
    }
    onChange({
      houseWash: false,
      houseWashDetails: {
        ...services.houseWashDetails,
        stainType: 'organic',
      },
    });
  };

  const removeService = (serviceId: ServiceId) => {
    switch (serviceId) {
      case 'windowCleaning':
        onChange({ windowCleaning: false });
        break;
      case 'drivewayCleaning':
        onChange({ drivewayCleaning: { ...services.drivewayCleaning, enabled: false } });
        break;
      case 'pressureWashing':
        onChange({
          pressureWashing: {
            ...services.pressureWashing,
            enabled: false,
            frontPorch: { ...services.pressureWashing.frontPorch, enabled: false },
            backPatio: { ...services.pressureWashing.backPatio, enabled: false },
            poolDeck: { ...services.pressureWashing.poolDeck, enabled: false },
            walkways: { ...services.pressureWashing.walkways, enabled: false },
          },
        });
        break;
      case 'gutterCleaning':
        toggleGutterCleaning();
        break;
      case 'houseWash':
        toggleHouseWash();
        break;
      case 'roofCleaning':
        onChange({ roofCleaning: false, roofRiskFlags: undefined });
        break;
      case 'solarPanelCleaning':
        onChange({
          solarPanelCleaning: {
            ...services.solarPanelCleaning,
            enabled: false,
            accessType: undefined,
            knownDamage: undefined,
            extremePitch: undefined,
            fragileMaterial: undefined,
            unusualAccess: undefined,
          },
        });
        break;
      case 'screenRepair':
        onChange({ screenRepair: { ...services.screenRepair, enabled: false, scopeType: undefined } });
        break;
    }
  };

  const focusSelectedService = (serviceId: string) => {
    const title = servicePresentation[serviceId as ServiceId].title;
    const focusAndScroll = () => {
      const editButton = document.querySelector<HTMLButtonElement>(
        `button[aria-label="Edit ${title}"]`,
      );
      const selectedSummary = editButton?.closest<HTMLElement>('[data-service-id]');
      selectedSummary?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      editButton?.focus();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusAndScroll);
    } else {
      globalThis.setTimeout(focusAndScroll, 0);
    }
  };

  const selectCompactService = (serviceId: ServiceId) => {
    switch (serviceId) {
      case 'windowCleaning':
        onChange({ windowCleaning: true });
        break;
      case 'drivewayCleaning':
        onChange({ drivewayCleaning: { ...services.drivewayCleaning, enabled: true } });
        break;
      case 'pressureWashing':
        onChange({ pressureWashing: { ...services.pressureWashing, enabled: true } });
        break;
      case 'gutterCleaning':
        onChange({ gutterCleaning: true });
        break;
      case 'houseWash':
        onChange({ houseWash: true });
        break;
      case 'roofCleaning':
        onChange({ roofCleaning: true });
        break;
      case 'solarPanelCleaning':
        onChange({
          solarPanelCleaning: { ...services.solarPanelCleaning, enabled: true },
        });
        break;
      case 'screenRepair':
        onChange({ screenRepair: { ...services.screenRepair, enabled: true } });
        break;
    }
    setEditingService(serviceId);
    focusSelectedService(serviceId);
  };

  const serviceCardControls = (serviceId: string, isEnabled: boolean, toggle: () => void) => ({
    isEnabled,
    isExpanded: editingService === serviceId,
    onSelect: () => {
      if (!isEnabled) toggle();
      setEditingService(serviceId);
      focusSelectedService(serviceId);
    },
    onEdit: () => setEditingService((current) => current === serviceId ? null : serviceId),
    onRemove: () => {
      if (isEnabled) removeService(serviceId as ServiceId);
      setEditingService((current) => current === serviceId ? null : current);
    },
  });

  // Render individual service cards
  const renderWindowCleaning = () => (
    <ServiceCard
      key="windowCleaning"
      id="window-cleaning"
      icon={Sparkles}
      title="Window Cleaning"
      description="Crystal clear windows, inside or out"
      price={authoritativePrice(servicePrices.windowCleaningTotal, 'windowCleaning')}
      priceStatus={priceStatusFor('windowCleaning')}
      {...serviceCardControls('windowCleaning', services.windowCleaning, () =>
        onChange({ windowCleaning: !services.windowCleaning })
      )}
      isFeatured={isFeatured('windowCleaning')}
      benefit="Streak-free interior + exterior clean, screens included"
      anchorPrice={authoritativePrice(servicePrices.windowCleaningTotal, 'windowCleaning')}
    >
          {/* Window Options - shown when enabled */}
          <div className="space-y-4">
          {/* Window Cleaning Type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Service Type</Label>
              <RadioGroup
                value={homeDetails.windowCleaningType}
                onValueChange={(v) => onHomeDetailsChange({ windowCleaningType: v as HomeDetails['windowCleaningType'] })}
                className="space-y-2"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                <label
                  htmlFor="type-exterior"
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    homeDetails.windowCleaningType === 'exterior'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <RadioGroupItem value="exterior" id="type-exterior" />
                  <div>
                    <div className="font-medium text-sm">Exterior Only</div>
                    <div className="text-xs text-muted-foreground">Outside windows</div>
                  </div>
                </label>
                <label
                  htmlFor="type-both"
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    homeDetails.windowCleaningType === 'both'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <RadioGroupItem value="both" id="type-both" />
                  <div>
                    <div className="font-medium text-sm">Full Service — Inside + Outside</div>
                    <div className="text-xs text-muted-foreground">Complete clean</div>
                  </div>
                </label>
                </div>

                {/* $99 promo option — only when active in admin. Visually
                    distinct from the standard two options so its terms are
                    unmissable. Sits inside the RadioGroup so state stays in
                    sync via `value`. */}
                {promoActive && (
                <label
                  htmlFor="type-promo-99"
                  className={`block p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    isPromoSelected
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-500/30'
                      : 'border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/10 hover:border-amber-500'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem
                      value="promo_99"
                      id="type-promo-99"
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-amber-900 dark:text-amber-100">
                          $99 Special — 10 Exterior Windows
                        </span>
                        <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Limited Promo
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-amber-900/80 dark:text-amber-100/80 space-y-0.5">
                        <p className="font-medium">Flat ${windowPromo!.flatPrice} for up to {windowPromo!.maxWindows} standard exterior windows.</p>
                        <p><strong>Screens NOT included.</strong> Screens must be removed before we arrive.</p>
                        <p>Interior windows, tracks, and sills are not included.</p>
                      </div>
                    </div>
                  </div>
                </label>
                )}
              </RadioGroup>

              {/* Complimentary services note — hidden for the promo since screens
                  are explicitly excluded from the $99 offer. */}
              {!isPromoSelected && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-success/10 border border-success/20">
                <ShieldCheck className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-success">
                    {homeDetails.windowCleaningType === 'both' 
                      ? 'Complimentary screen & track cleaning included'
                      : 'Complimentary screen cleaning included'
                    }
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    {homeDetails.windowCleaningType === 'both'
                      ? 'We\'ll clean all screens and tracks at no extra charge'
                      : 'All removable screens cleaned at no extra charge'
                    }
                  </p>
                </div>
              </div>
              )}
            </div>
            
            {/* Window Condition — hidden for the flat-price $99 promo */}
            {!isPromoSelected && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Window Condition</Label>
              <RadioGroup
                value={homeDetails.condition}
                onValueChange={(v) => onHomeDetailsChange({ condition: v as 'maintenance' | 'heavy' })}
                className="grid gap-2 sm:grid-cols-2"
              >
                <label
                  htmlFor="condition-maintenance"
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    homeDetails.condition === 'maintenance'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <RadioGroupItem value="maintenance" id="condition-maintenance" />
                  <div>
                    <div className="font-medium text-sm">Regular Maintenance</div>
                    <div className="text-xs text-muted-foreground">Cleaned within past year</div>
                  </div>
                </label>
                <label
                  htmlFor="condition-heavy"
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    homeDetails.condition === 'heavy'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <RadioGroupItem value="heavy" id="condition-heavy" />
                  <div>
                    <div className="font-medium text-sm">First-Time / Heavy</div>
                    <div className="text-xs text-muted-foreground">Hasn't been cleaned in a while</div>
                  </div>
                </label>
              </RadioGroup>
            </div>
            )}

            {/* Advanced Window Details — hidden for the flat-price $99 promo */}
            {!isPromoSelected && (
            <Collapsible 
              open={homeDetails.showAdvanced} 
              onOpenChange={(open) => onHomeDetailsChange({ showAdvanced: open })}
            >
              <CollapsibleTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="w-full justify-between p-3 h-auto border border-border rounded-lg hover:bg-muted/50"
                >
                  <span className="text-sm font-medium">Advanced Window Details</span>
                  {homeDetails.showAdvanced ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
                  <p className="text-xs text-muted-foreground">
                    These details help us provide a more accurate quote.
                  </p>
                  
                  {/* Hard Water Stains */}
                  <div className="space-y-2 p-3 rounded-lg bg-background border border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Droplets className="w-4 h-4 text-primary" />
                        <Label className="font-medium text-sm">Hard Water Stains</Label>
                      </div>
                      <Switch
                        checked={homeDetails.hardWaterStains}
                        onCheckedChange={(checked) => onHomeDetailsChange({ hardWaterStains: checked })}
                      />
                    </div>
                    {homeDetails.hardWaterStains && (
                      <div className="pl-6 space-y-1">
                        <Label className="text-xs text-muted-foreground">% of windows affected</Label>
                        <RadioGroup
                          value={String(homeDetails.hardWaterPercent)}
                          onValueChange={(v) => onHomeDetailsChange({ hardWaterPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                          className="flex gap-3 flex-wrap"
                        >
                          {[25, 50, 75, 100].map((pct) => (
                            <div key={pct} className="flex items-center space-x-1">
                              <RadioGroupItem value={String(pct)} id={`hw-${pct}`} />
                              <Label htmlFor={`hw-${pct}`} className="cursor-pointer text-sm">{pct}%</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </div>
                  
                  {/* French Panes */}
                  <div className="space-y-2 p-3 rounded-lg bg-background border border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Grid3X3 className="w-4 h-4 text-primary" />
                        <Label className="font-medium text-sm">French Panes</Label>
                      </div>
                      <Switch
                        checked={homeDetails.frenchPanes}
                        onCheckedChange={(checked) => onHomeDetailsChange({ frenchPanes: checked })}
                      />
                    </div>
                    {homeDetails.frenchPanes && (
                      <div className="pl-6 space-y-1">
                        <Label className="text-xs text-muted-foreground">% of windows affected</Label>
                        <RadioGroup
                          value={String(homeDetails.frenchPanesPercent)}
                          onValueChange={(v) => onHomeDetailsChange({ frenchPanesPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                          className="flex gap-3 flex-wrap"
                        >
                          {[25, 50, 75, 100].map((pct) => (
                            <div key={pct} className="flex items-center space-x-1">
                              <RadioGroupItem value={String(pct)} id={`fp-${pct}`} />
                              <Label htmlFor={`fp-${pct}`} className="cursor-pointer text-sm">{pct}%</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </div>
                  
                  {/* Solar Screens */}
                  <div className="space-y-2 p-3 rounded-lg bg-background border border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SunMedium className="w-4 h-4 text-primary" />
                        <Label className="font-medium text-sm">Solar Screens</Label>
                      </div>
                      <Switch
                        checked={homeDetails.solarScreens}
                        onCheckedChange={(checked) => onHomeDetailsChange({ solarScreens: checked })}
                      />
                    </div>
                    {homeDetails.solarScreens && (
                      <div className="pl-6 space-y-1">
                        <Label className="text-xs text-muted-foreground">% of windows affected</Label>
                        <RadioGroup
                          value={String(homeDetails.solarScreensPercent)}
                          onValueChange={(v) => onHomeDetailsChange({ solarScreensPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                          className="flex gap-3 flex-wrap"
                        >
                          {[25, 50, 75, 100].map((pct) => (
                            <div key={pct} className="flex items-center space-x-1">
                              <RadioGroupItem value={String(pct)} id={`ss-${pct}`} />
                              <Label htmlFor={`ss-${pct}`} className="cursor-pointer text-sm">{pct}%</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </div>
                  
                  {/* Ladder Work */}
                  <div className="space-y-2 p-3 rounded-lg bg-background border border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ArrowUpFromLine className="w-4 h-4 text-primary" />
                        <Label className="font-medium text-sm">2nd Floor Ladder Work</Label>
                      </div>
                      <Switch
                        checked={homeDetails.ladderWork}
                        onCheckedChange={(checked) => onHomeDetailsChange({ ladderWork: checked })}
                      />
                    </div>
                    {homeDetails.ladderWork && (
                      <div className="pl-6 space-y-1">
                        <Label className="text-xs text-muted-foreground">How many windows?</Label>
                        <RadioGroup
                          value={homeDetails.ladderWorkCount}
                          onValueChange={(v) => onHomeDetailsChange({ ladderWorkCount: v as '1-3' | '4-8' | '9+' })}
                          className="flex gap-3 flex-wrap"
                        >
                          {(['1-3', '4-8', '9+'] as const).map((count) => (
                            <div key={count} className="flex items-center space-x-1">
                              <RadioGroupItem value={count} id={`lw-${count}`} />
                              <Label htmlFor={`lw-${count}`} className="cursor-pointer text-sm">{count}</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </div>
                  
                  {/* Sunroom */}
                  <div className="space-y-2 p-3 rounded-lg bg-background border border-border">
                    <div className="flex items-center gap-2">
                      <Square className="w-4 h-4 text-primary" />
                      <Label className="font-medium text-sm">Sunroom / Window Walls</Label>
                    </div>
                    <Select
                      value={homeDetails.sunroom}
                      onValueChange={(v) => onHomeDetailsChange({ sunroom: v as 'none' | 'small' | 'medium' | 'large' })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="small">Small (6-10 windows)</SelectItem>
                        <SelectItem value="medium">Medium (11-20 windows)</SelectItem>
                        <SelectItem value="large">Large (20+ windows)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
            )}
          </div>
    </ServiceCard>
  );

  const renderDrivewayCleaning = () => (
    <ServiceCard
      key="drivewayCleaning"
      id="drivewayCleaning"
      icon={Car}
      title="Driveway Cleaning"
      description="Power wash your driveway to remove stains and buildup"
      price={authoritativePrice(servicePrices.drivewayCleaning, 'drivewayCleaning')}
      priceStatus={priceStatusFor('drivewayCleaning')}
      {...serviceCardControls('drivewayCleaning', services.drivewayCleaning.enabled, () => onChange({
        drivewayCleaning: { ...services.drivewayCleaning, enabled: !services.drivewayCleaning.enabled } 
      }))}
      isFeatured={isFeatured('drivewayCleaning')}
      benefit="Lift oil stains, mildew and buildup — instant curb appeal"
      anchorPrice={authoritativePrice(servicePrices.drivewayCleaning, 'drivewayCleaning')}
    >
      <div className="space-y-4">
        {/* Driveway preset selector */}
        <DrivewayPresetSelector
          value={services.drivewayCleaning.sqft}
          onChange={(sqft) => onChange({ 
            drivewayCleaning: { ...services.drivewayCleaning, sqft } 
          })}
        />
        
        {/* Surface type */}
        <div className="space-y-2">
          <Label className="text-sm">Surface Type</Label>
          <Select
            value={services.drivewayCleaning.surfaceType}
            onValueChange={(v) => 
              onChange({ 
                drivewayCleaning: {
                  ...services.drivewayCleaning,
                  surfaceType: v as AdditionalServices['drivewayCleaning']['surfaceType'],
                }
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="concrete">Concrete</SelectItem>
              <SelectItem value="stamped">Stamped Concrete</SelectItem>
              <SelectItem value="pavers">Pavers</SelectItem>
              <SelectItem value="brick">Brick</SelectItem>
              <SelectItem value="stone">Stone</SelectItem>
              <SelectItem value="tile">Tile</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </ServiceCard>
  );

  const renderPressureWashing = () => (
    <ServiceCard
      key="pressureWashing"
      id="pressureWashing"
      icon={Droplets}
      title="Pressure Washing"
      description="Porches, patios, pool decks, and walkways"
      price={hasAuthoritativePressureWashingPrice ? servicePrices.pressureWashing : 0}
      priceStatus={pressureWashingPriceStatus}
      {...serviceCardControls('pressureWashing', services.pressureWashing.enabled, () => onChange({
        pressureWashing: { ...services.pressureWashing, enabled: !services.pressureWashing.enabled } 
      }))}
      isFeatured={isFeatured('pressureWashing')}
      benefit="Refresh porches, patios, pool decks and walkways"
      anchorPrice={hasAuthoritativePressureWashingPrice ? servicePrices.pressureWashing : 0}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm">Select Areas to Clean</Label>
          <p className="text-xs text-muted-foreground">
            Choose surface type for each area for accurate pricing
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PressureWashingAreaCard
              label="Front Porch"
              area={services.pressureWashing.frontPorch}
              price={hasAuthoritativePressureWashingPrice
                ? servicePrices.pressureWashingBreakdown.frontPorch
                : 0}
              defaultSqft={FLATWORK_DEFAULT_SQFT.frontPorch}
              calculatorType="porch"
              showSurfaceType={true}
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, frontPorch: area }
              })}
            />
            
            <PressureWashingAreaCard
              label="Back Patio"
              area={services.pressureWashing.backPatio}
              price={hasAuthoritativePressureWashingPrice
                ? servicePrices.pressureWashingBreakdown.backPatio
                : 0}
              defaultSqft={FLATWORK_DEFAULT_SQFT.backPatio}
              calculatorType="patio"
              showSurfaceType={true}
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, backPatio: area }
              })}
            />
            
            <PressureWashingAreaCard
              label="Pool Deck"
              area={services.pressureWashing.poolDeck}
              price={hasAuthoritativePressureWashingPrice
                ? servicePrices.pressureWashingBreakdown.poolDeck
                : 0}
              defaultSqft={FLATWORK_DEFAULT_SQFT.poolDeck}
              calculatorType="poolDeck"
              showSurfaceType={true}
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, poolDeck: area }
              })}
            />
            
            <PressureWashingAreaCard
              label="Walkways"
              area={services.pressureWashing.walkways}
              price={hasAuthoritativePressureWashingPrice
                ? servicePrices.pressureWashingBreakdown.walkways
                : 0}
              defaultSqft={FLATWORK_DEFAULT_SQFT.walkways}
              calculatorType="walkways"
              showSurfaceType={true}
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, walkways: area }
              })}
            />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
            <span className="font-medium text-foreground">Pressure Washing total</span>
            <span className="font-semibold text-primary" data-testid="pressure-washing-service-total">
              {hasAuthoritativePressureWashingPrice
                ? formatPrice(servicePrices.pressureWashing)
                : pressureWashingPriceStatus}
            </span>
          </div>
        </div>
      </div>
    </ServiceCard>
  );

  const renderGutterCleaning = () => (
    <ServiceCard
      key="gutterCleaning"
      id="gutterCleaning"
      icon={Home}
      title="Gutter Cleaning"
      description="Full gutter and downspout cleaning"
      price={hasAuthoritativeGutterPrice ? servicePrices.gutterCleaningTotal : 0}
      priceStatus={gutterPriceStatus}
      {...serviceCardControls('gutterCleaning', services.gutterCleaning, toggleGutterCleaning)}
      isFeatured={isFeatured('gutterCleaning')}
      benefit="Prevent water damage and foundation issues"
      anchorPrice={hasAuthoritativeGutterPrice ? servicePrices.gutterCleaningTotal : 0}
    >
      <div className="space-y-4">
        <div
          className="rounded-lg border border-primary bg-primary/5 p-3"
          data-testid="gutter-base-selection"
        >
          <div className="flex items-start gap-3">
            <Checkbox id="basic-gutter-cleaning" checked disabled className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="basic-gutter-cleaning" className="font-medium text-foreground">
                  Basic Gutter Cleaning
                </Label>
                <span
                  className="ml-auto font-semibold text-primary"
                  data-testid="gutter-base-price"
                >
                  {hasAuthoritativeGutterPrice
                    ? formatPrice(servicePrices.gutterCleaning)
                    : gutterPriceStatus}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Complete gutter and downspout cleaning
              </p>
            </div>
          </div>
        </div>
        
        <GutterAddonsCard
          addons={services.gutterAddons}
          prices={{
            drainCleaning: hasAuthoritativeGutterPrice ? servicePrices.gutterDrainCleaning : 0,
            minorRepairs: hasAuthoritativeGutterPrice ? servicePrices.gutterMinorRepairs : 0,
            gutterGuards: hasAuthoritativeGutterPrice ? servicePrices.gutterGuards : 0,
          }}
          onChange={(updates) => onChange({ 
            gutterAddons: { ...services.gutterAddons, ...updates } 
          })}
        />

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="font-medium text-foreground">Gutter cleaning total</span>
          <span className="font-semibold text-primary" data-testid="gutter-service-total">
            {hasAuthoritativeGutterPrice
              ? formatPrice(servicePrices.gutterCleaningTotal)
              : gutterPriceStatus}
          </span>
        </div>
      </div>
    </ServiceCard>
  );

  const renderHouseWash = () => (
    <ServiceCard
      key="houseWash"
      id="houseWash"
      icon={Warehouse}
      title="House Wash"
      description="Gentle exterior soft washing"
      price={hasAuthoritativeHouseWashPrice ? servicePrices.houseWashTotal : 0}
      priceStatus={houseWashPriceStatus}
      {...serviceCardControls('houseWash', services.houseWash, toggleHouseWash)}
      isFeatured={isFeatured('houseWash')}
      benefit="Kills mold and algae — safe soft-wash system"
      anchorPrice={hasAuthoritativeHouseWashPrice ? servicePrices.houseWashTotal : 0}
    >
      <div className="space-y-4">
        <div
          className="rounded-lg border border-primary bg-primary/5 p-3"
          data-testid="house-wash-base-selection"
        >
          <div className="flex items-start gap-3">
            <Checkbox id="basic-house-wash" checked disabled className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="basic-house-wash" className="font-medium text-foreground">
                  Basic House Wash
                </Label>
                <span className="ml-auto font-semibold text-primary" data-testid="house-wash-base-price">
                  {hasAuthoritativeHouseWashPrice
                    ? formatPrice(servicePrices.houseWash)
                    : houseWashPriceStatus}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Organic soft washing for algae, mildew, cobwebs, dirt, and normal buildup
              </p>
            </div>
          </div>
        </div>

        <HouseWashDetailsCard
          details={services.houseWashDetails}
          rustSurcharge={hasAuthoritativeHouseWashPrice ? servicePrices.houseWashRustSurcharge : 0}
          showAuthoritativePrice={hasAuthoritativeHouseWashPrice}
          priceStatus={houseWashPriceStatus}
          onChange={(updates) => onChange({
            houseWashDetails: { ...services.houseWashDetails, ...updates }
          })}
        />

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="font-medium text-foreground">House Wash total</span>
          <span className="font-semibold text-primary" data-testid="house-wash-service-total">
            {hasAuthoritativeHouseWashPrice
              ? formatPrice(servicePrices.houseWashTotal)
              : houseWashPriceStatus}
          </span>
        </div>
      </div>
    </ServiceCard>
  );

  const renderRoofCleaning = () => (
    <ServiceCard
      key="roofCleaning"
      id="roofCleaning"
      icon={Cloud}
      title="Roof Cleaning"
      description="Safe, low-pressure roof treatment"
      price={authoritativePrice(servicePrices.roofCleaning, 'roofCleaning')}
      priceStatus={priceStatusFor('roofCleaning')}
      {...serviceCardControls('roofCleaning', services.roofCleaning, () =>
        onChange({ roofCleaning: !services.roofCleaning })
      )}
      isFeatured={isFeatured('roofCleaning')}
      benefit="Extend roof life — remove black streaks and moss"
      anchorPrice={authoritativePrice(servicePrices.roofCleaning, 'roofCleaning')}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm">Roof Type</Label>
            <Select
              value={services.roofType}
              onValueChange={(v) => onChange({
                roofType: v as AdditionalServices['roofType'],
              })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asphalt">Asphalt Shingles</SelectItem>
                <SelectItem value="tile">Tile</SelectItem>
                <SelectItem value="metal">Metal</SelectItem>
                <SelectItem value="flat">Flat Roof</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label className="text-sm">Condition</Label>
            <Select
              value={services.roofSeverity}
              onValueChange={(v) => onChange({
                roofSeverity: v as AdditionalServices['roofSeverity'],
              })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light (minimal buildup)</SelectItem>
                <SelectItem value="moderate">Moderate (some staining)</SelectItem>
                <SelectItem value="heavy">Heavy (significant buildup)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <RoofPitchSelector
          pitch={services.roofPitch}
          onChange={(pitch) => onChange({ roofPitch: pitch })}
        />

        <div className="space-y-2">
          <Label className="text-sm">Roof condition and access</Label>
          <Select
            value={services.roofRiskFlags
              ? (Object.values(services.roofRiskFlags).some(Boolean) ? 'review' : 'standard')
              : undefined}
            onValueChange={(value) => onChange({
              roofRiskFlags: value === 'standard'
                ? { knownDamage: false, extremePitch: false, fragileMaterial: false, unusualAccess: false }
                : { knownDamage: false, extremePitch: false, fragileMaterial: false, unusualAccess: true },
            })}
          >
            <SelectTrigger aria-label="Roof condition and access">
              <SelectValue placeholder="Confirm roof conditions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">No known damage, fragile material, extreme pitch, or unusual access</SelectItem>
              <SelectItem value="review">One or more of these conditions applies or I am not sure</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Roof pitch above helps us plan the visit; it does not change the automated price by itself.</p>
        </div>
      </div>
    </ServiceCard>
  );

  const renderSolarPanelCleaning = () => (
    <ServiceCard
      key="solarPanelCleaning"
      id="solarPanelCleaning"
      icon={Sun}
      title="Solar Panel Cleaning"
      description="Restore panel efficiency — dust, pollen and bird droppings block output"
      price={authoritativePrice(servicePrices.solarPanelCleaning, 'solarPanelCleaning')}
      priceStatus={priceStatusFor('solarPanelCleaning')}
      {...serviceCardControls('solarPanelCleaning', services.solarPanelCleaning.enabled, () => onChange({
        solarPanelCleaning: { ...services.solarPanelCleaning, enabled: !services.solarPanelCleaning.enabled }
      }))}
      isFeatured={isFeatured('solarPanelCleaning')}
      benefit="Restore output by removing dust, pollen, and debris"
      anchorPrice={authoritativePrice(servicePrices.solarPanelCleaning, 'solarPanelCleaning')}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label className="text-sm">How many solar panels?</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={200}
              value={services.solarPanelCleaning.panelCount || ''}
              onChange={(e) => onChange({
                solarPanelCleaning: {
                  ...services.solarPanelCleaning,
                  panelCount: Math.max(1, parseInt(e.target.value) || 1),
                },
              })}
              placeholder="20"
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">panels</span>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Panel access</Label>
          <Select
            value={services.solarPanelCleaning.accessType
              ? (services.solarPanelCleaning.accessType === 'standard_residential' &&
                  !services.solarPanelCleaning.knownDamage &&
                  !services.solarPanelCleaning.extremePitch &&
                  !services.solarPanelCleaning.fragileMaterial &&
                  !services.solarPanelCleaning.unusualAccess ? 'standard' : 'review')
              : undefined}
            onValueChange={(value) => onChange({
              solarPanelCleaning: value === 'standard'
                ? {
                    ...services.solarPanelCleaning,
                    stories: homeDetails.stories,
                    accessType: 'standard_residential',
                    knownDamage: false,
                    extremePitch: false,
                    fragileMaterial: false,
                    unusualAccess: false,
                  }
                : {
                    ...services.solarPanelCleaning,
                    stories: homeDetails.stories,
                    accessType: 'unusual_or_uncertain',
                    knownDamage: false,
                    extremePitch: false,
                    fragileMaterial: false,
                    unusualAccess: true,
                  },
            })}
          >
            <SelectTrigger aria-label="Solar panel access">
              <SelectValue placeholder="Confirm panel access" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard residential access; no known damage or unusual conditions</SelectItem>
              <SelectItem value="review">Unusual access, damage, fragile material, steep pitch, or not sure</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          We use pure-water fed-pole systems — no soaps, no residue, no roof damage.
        </p>
      </div>
    </ServiceCard>
  );

  const renderScreenRepair = () => (
    <ServiceCard
      key="screenRepair"
      id="screenRepair"
      icon={Wrench}
      title="Screen Repair"
      description="We re-screen torn or damaged window screens on the same visit"
      price={authoritativePrice(servicePrices.screenRepair, 'screenRepair')}
      priceStatus={priceStatusFor('screenRepair')}
      {...serviceCardControls('screenRepair', services.screenRepair.enabled, () => onChange({
        screenRepair: { ...services.screenRepair, enabled: !services.screenRepair.enabled }
      }))}
      isFeatured={isFeatured('screenRepair')}
      benefit="Fresh standard screen mesh installed on-site"
      anchorPrice={authoritativePrice(servicePrices.screenRepair, 'screenRepair')}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label className="text-sm">How many screens need repair?</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={100}
              value={services.screenRepair.screenCount || ''}
              onChange={(e) => onChange({
                screenRepair: {
                  ...services.screenRepair,
                  screenCount: Math.max(1, parseInt(e.target.value) || 1),
                },
              })}
              placeholder="1"
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">screens</span>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Screen repair type</Label>
          <Select
            value={services.screenRepair.scopeType}
            onValueChange={(value) => onChange({
              screenRepair: {
                ...services.screenRepair,
                scopeType: value as NonNullable<AdditionalServices['screenRepair']['scopeType']>,
              },
            })}
          >
            <SelectTrigger aria-label="Screen repair type">
              <SelectValue placeholder="Select screen type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard_removable_reusable_frame">Standard removable window screen; reuse existing frame</SelectItem>
              <SelectItem value="screen_door">Screen door</SelectItem>
              <SelectItem value="new_frame">New frame needed</SelectItem>
              <SelectItem value="damaged_frame">Damaged frame</SelectItem>
              <SelectItem value="solar_screen">Solar screen</SelectItem>
              <SelectItem value="specialty_or_oversized">Specialty or oversized screen</SelectItem>
              <SelectItem value="unknown">Not sure</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Standard fiberglass mesh in charcoal or grey. Pet-resistant mesh available on request.
        </p>
      </div>
    </ServiceCard>
  );

  // Map service IDs to their render functions
  const serviceRenderers: Record<ServiceId, () => JSX.Element> = {
    windowCleaning: renderWindowCleaning,
    drivewayCleaning: renderDrivewayCleaning,
    pressureWashing: renderPressureWashing,
    gutterCleaning: renderGutterCleaning,
    houseWash: renderHouseWash,
    roofCleaning: renderRoofCleaning,
    solarPanelCleaning: renderSolarPanelCleaning,
    screenRepair: renderScreenRepair,
  };

  const renderCompactServiceChoice = (serviceId: ServiceId) => {
    const presentation = servicePresentation[serviceId];
    return (
      <ChoiceCard
        key={serviceId}
        icon={presentation.icon}
        title={presentation.title}
        description={presentation.description}
        meta="Select for pricing"
        variant="compact"
        testId={`compact-service-${serviceId}`}
        onSelect={() => selectCompactService(serviceId)}
      />
    );
  };

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-4">
        <div className="section-header">
          <div className="section-icon">
            <Sparkles className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">What service are you looking for today?</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Select all that apply — we'll show you pricing instantly
            </p>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {selectedServiceIds.length > 0 && (
          <div className="space-y-3" aria-label="Selected services">
            {selectedServiceIds.map((serviceId) => serviceRenderers[serviceId]())}
          </div>
        )}

        {selectedServiceIds.length === 0 && inactiveServiceIds.length > 0 && (
          <div className="space-y-3" aria-label="Available services" data-testid="service-catalog">
            {inactiveServiceIds.map((serviceId) => serviceRenderers[serviceId]())}
          </div>
        )}

        {selectedServiceIds.length > 0 && inactiveServiceIds.length > 0 && (
          <section className="space-y-2 border-t border-border pt-4" aria-labelledby="other-services-title">
            <div>
              <h3 id="other-services-title" className="text-sm font-semibold text-foreground">
                Other services you can add
              </h3>
              <p className="text-xs text-muted-foreground">
                Add another service without changing your current selections.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="compact-service-catalog">
              {inactiveServiceIds.map(renderCompactServiceChoice)}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
