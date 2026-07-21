import { useState } from 'react';
import { Check, Plus, Sparkles, Droplets, Home, Cloud, Warehouse, ChevronDown, ChevronUp, Grid3X3, SunMedium, ArrowUpFromLine, Square, Car, ShieldCheck, Sun, Wrench } from 'lucide-react';
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

interface IntentFirstServiceSelectorProps {
  services: AdditionalServices;
  servicePrices: ServicePrices;
  homeDetails: HomeDetails;
  onChange: (updates: Partial<AdditionalServices>) => void;
  onHomeDetailsChange: (updates: Partial<HomeDetails>) => void;
  featuredService?: 'windowCleaning' | 'gutterCleaning' | 'houseWash' | 'roofCleaning' | 'drivewayCleaning' | 'pressureWashing' | 'solarPanelCleaning' | 'screenRepair';
  /** Active $99 window promo config from admin. When null, the promo option is hidden entirely. */
  windowPromo?: WindowPromoConfig | null;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

interface ServiceCardProps {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  price: number;
  isEnabled: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  isFeatured?: boolean;
  /** Optional short benefit line shown in the compact card to justify the add. */
  benefit?: string;
  /** Optional "from $X" price anchor shown in the compact card. */
  anchorPrice?: number;
  /** Optional badge label (e.g. "Included with Better plan"). */
  badge?: string;
}

function ServiceCard({ icon: Icon, title, description, price, isEnabled, onToggle, children, isFeatured, benefit, anchorPrice, badge }: ServiceCardProps) {
  // Compact view when not enabled
  if (!isEnabled) {
    return (
      <div 
        className={`relative flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
          isFeatured
            ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/20'
            : 'border-border hover:border-primary/40 hover:bg-muted/30 bg-card'
        }`}
        onClick={onToggle}
      >
        {/* Featured badge - smaller for compact */}
        {isFeatured && (
          <div className="absolute -top-2 left-3 px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-semibold rounded-full">
            ✨ Featured
          </div>
        )}
        
        <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-foreground">{title}</span>
            {badge && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/30">
                {badge}
              </span>
            )}
          </div>
          {benefit && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{benefit}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {anchorPrice && anchorPrice > 0 ? (
            <span className="text-xs text-muted-foreground">
              from <span className="font-semibold text-foreground">{formatPrice(anchorPrice)}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">Get instant pricing</span>
          )}
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-sm">
            <Plus className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    );
  }

  // Expanded view when enabled
  return (
    <div 
      className="relative p-4 rounded-xl border-2 border-primary bg-primary/5 shadow-md transition-all duration-200 cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('select, input, button, [role="radio"], [role="switch"]')) return;
        onToggle();
      }}
    >
      {/* Selection indicator */}
      <div className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-sm">
        <Check className="w-3.5 h-3.5" />
      </div>
      
      <div className="flex items-start gap-3 pr-8">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary text-primary-foreground shadow-md">
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-foreground">{title}</h3>
            {price > 0 && (
              <span className="text-primary font-bold price-display">
                {formatPrice(price)}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      
      {/* Expandable options */}
      {children && (
        <div className="mt-4 pt-4 border-t border-border" onClick={e => e.stopPropagation()}>
          {children}
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
  windowPromo
}: IntentFirstServiceSelectorProps) {
  const [windowExpanded, setWindowExpanded] = useState(true);

  // Helper to check if a service is featured
  const isFeatured = (serviceId: string) => featuredService === serviceId;

  const promoActive = !!windowPromo;
  const isPromoSelected = promoActive && homeDetails.windowCleaningType === 'promo_99';

  // Define service order - featured service goes first
  const serviceOrder: string[] = [
    'windowCleaning',
    'drivewayCleaning', 
    'pressureWashing',
    'gutterCleaning',
    'houseWash',
    'roofCleaning',
    'solarPanelCleaning',
    'screenRepair',
  ];
  
  // Reorder to put featured service first
  const orderedServices = featuredService 
    ? [featuredService, ...serviceOrder.filter(s => s !== featuredService)]
    : serviceOrder;

  // Render individual service cards
  const renderWindowCleaning = () => (
    <ServiceCard
      key="windowCleaning"
      id="window-cleaning"
      icon={Sparkles}
      title="Window Cleaning"
      description="Crystal clear windows, inside or out"
      price={servicePrices.windowCleaningTotal}
      isEnabled={services.windowCleaning}
      onToggle={() => onChange({ windowCleaning: !services.windowCleaning })}
      isFeatured={isFeatured('windowCleaning')}
      benefit="Streak-free interior + exterior clean, screens included"
      anchorPrice={servicePrices.windowCleaningTotal}
    >
          {/* Window Options - shown when enabled */}
          <div className="space-y-4">
          {/* Window Cleaning Type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Service Type</Label>
              <RadioGroup
                value={homeDetails.windowCleaningType}
                onValueChange={(v) => onHomeDetailsChange({ windowCleaningType: v as HomeDetails['windowCleaningType'] })}
                className="grid gap-2 sm:grid-cols-2"
              >
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
              </RadioGroup>

              {/* $99 promo option — only when active in admin. Visually distinct
                  from the standard two options so its terms are unmissable. */}
              {promoActive && (
                <label
                  htmlFor="type-promo-99"
                  className={`block mt-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
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
                      checked={isPromoSelected}
                      onClick={() => onHomeDetailsChange({ windowCleaningType: 'promo_99' })}
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
      price={servicePrices.drivewayCleaning}
      isEnabled={services.drivewayCleaning.enabled}
      onToggle={() => onChange({ 
        drivewayCleaning: { ...services.drivewayCleaning, enabled: !services.drivewayCleaning.enabled } 
      })}
      isFeatured={isFeatured('drivewayCleaning')}
      benefit="Lift oil stains, mildew and buildup — instant curb appeal"
      anchorPrice={servicePrices.drivewayCleaning}
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
                drivewayCleaning: { ...services.drivewayCleaning, surfaceType: v as any } 
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
      price={servicePrices.pressureWashing}
      isEnabled={services.pressureWashing.enabled}
      onToggle={() => onChange({ 
        pressureWashing: { ...services.pressureWashing, enabled: !services.pressureWashing.enabled } 
      })}
      isFeatured={isFeatured('pressureWashing')}
      benefit="Refresh porches, patios, pool decks and walkways"
      anchorPrice={servicePrices.pressureWashing}
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
              price={servicePrices.pressureWashingBreakdown.frontPorch}
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
              price={servicePrices.pressureWashingBreakdown.backPatio}
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
              price={servicePrices.pressureWashingBreakdown.poolDeck}
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
              price={servicePrices.pressureWashingBreakdown.walkways}
              defaultSqft={FLATWORK_DEFAULT_SQFT.walkways}
              calculatorType="walkways"
              showSurfaceType={true}
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, walkways: area }
              })}
            />
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
      price={servicePrices.gutterCleaningTotal}
      isEnabled={services.gutterCleaning}
      onToggle={() => onChange({ gutterCleaning: !services.gutterCleaning })}
      isFeatured={isFeatured('gutterCleaning')}
      benefit="Prevent water damage and foundation issues"
      anchorPrice={servicePrices.gutterCleaningTotal}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Base gutter cleaning: {servicePrices.gutterCleaning > 0 ? `$${servicePrices.gutterCleaning}` : 'Included'}
        </p>
        
        <GutterAddonsCard
          addons={services.gutterAddons}
          prices={{
            drainCleaning: servicePrices.gutterDrainCleaning,
            minorRepairs: servicePrices.gutterMinorRepairs,
            gutterGuards: servicePrices.gutterGuards,
          }}
          onChange={(updates) => onChange({ 
            gutterAddons: { ...services.gutterAddons, ...updates } 
          })}
        />
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
      price={servicePrices.houseWashTotal}
      isEnabled={services.houseWash}
      onToggle={() => onChange({ houseWash: !services.houseWash })}
      isFeatured={isFeatured('houseWash')}
      benefit="Kills mold and algae — safe soft-wash system"
      anchorPrice={servicePrices.houseWashTotal}
    >
      <HouseWashDetailsCard
        details={services.houseWashDetails}
        rustSurcharge={servicePrices.houseWashRustSurcharge}
        onChange={(updates) => onChange({ 
          houseWashDetails: { ...services.houseWashDetails, ...updates } 
        })}
      />
    </ServiceCard>
  );

  const renderRoofCleaning = () => (
    <ServiceCard
      key="roofCleaning"
      id="roofCleaning"
      icon={Cloud}
      title="Roof Cleaning"
      description="Safe, low-pressure roof treatment"
      price={servicePrices.roofCleaning}
      isEnabled={services.roofCleaning}
      onToggle={() => onChange({ roofCleaning: !services.roofCleaning })}
      isFeatured={isFeatured('roofCleaning')}
      benefit="Extend roof life — remove black streaks and moss"
      anchorPrice={servicePrices.roofCleaning}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm">Roof Type</Label>
            <Select
              value={services.roofType}
              onValueChange={(v) => onChange({ roofType: v as any })}
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
              onValueChange={(v) => onChange({ roofSeverity: v as any })}
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
      price={servicePrices.solarPanelCleaning}
      isEnabled={services.solarPanelCleaning.enabled}
      onToggle={() => onChange({
        solarPanelCleaning: { ...services.solarPanelCleaning, enabled: !services.solarPanelCleaning.enabled }
      })}
      isFeatured={isFeatured('solarPanelCleaning' as any)}
      benefit="Boost energy output — $10 per panel, no minimums"
      anchorPrice={services.solarPanelCleaning.panelCount * 10}
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
            <span className="text-sm text-muted-foreground">panels × $10 each</span>
          </div>
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
      price={servicePrices.screenRepair}
      isEnabled={services.screenRepair.enabled}
      onToggle={() => onChange({
        screenRepair: { ...services.screenRepair, enabled: !services.screenRepair.enabled }
      })}
      isFeatured={isFeatured('screenRepair' as any)}
      benefit="Fresh screens installed on-site — $35 per screen, all materials included"
      anchorPrice={services.screenRepair.screenCount * 35}
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
            <span className="text-sm text-muted-foreground">screens × $35 each</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Standard fiberglass mesh in charcoal or grey. Pet-resistant mesh available on request.
        </p>
      </div>
    </ServiceCard>
  );

  // Map service IDs to their render functions
  const serviceRenderers: Record<string, () => JSX.Element> = {
    windowCleaning: renderWindowCleaning,
    drivewayCleaning: renderDrivewayCleaning,
    pressureWashing: renderPressureWashing,
    gutterCleaning: renderGutterCleaning,
    houseWash: renderHouseWash,
    roofCleaning: renderRoofCleaning,
    solarPanelCleaning: renderSolarPanelCleaning,
    screenRepair: renderScreenRepair,
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
        {orderedServices.map((serviceId) => serviceRenderers[serviceId]())}
      </CardContent>
    </Card>
  );
}
