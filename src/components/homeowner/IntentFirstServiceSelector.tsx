import { useState } from 'react';
import { Check, Plus, Sparkles, Droplets, Home, Cloud, Warehouse, ChevronDown, ChevronUp, Grid3X3, SunMedium, ArrowUpFromLine, Square, Car } from 'lucide-react';
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
interface IntentFirstServiceSelectorProps {
  services: AdditionalServices;
  servicePrices: ServicePrices;
  homeDetails: HomeDetails;
  onChange: (updates: Partial<AdditionalServices>) => void;
  onHomeDetailsChange: (updates: Partial<HomeDetails>) => void;
  featuredService?: 'windowCleaning' | 'gutterCleaning' | 'houseWash' | 'roofCleaning' | 'drivewayCleaning' | 'pressureWashing';
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
}

function ServiceCard({ icon: Icon, title, description, price, isEnabled, onToggle, children, isFeatured }: ServiceCardProps) {
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
        
        <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-muted text-muted-foreground">
          <Icon className="w-4 h-4" />
        </div>
        
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm text-foreground/80">{title}</span>
        </div>
        
        <div className="flex items-center gap-2 flex-shrink-0">
          {price > 0 && (
            <span className="text-xs text-muted-foreground">{formatPrice(price)}</span>
          )}
          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-muted/80 text-muted-foreground">
            <Plus className="w-3 h-3" />
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
  featuredService
}: IntentFirstServiceSelectorProps) {
  const [windowExpanded, setWindowExpanded] = useState(true);
  
  // Helper to check if a service is featured
  const isFeatured = (serviceId: string) => featuredService === serviceId;

  // Define service order - featured service goes first
  const serviceOrder: Array<'windowCleaning' | 'drivewayCleaning' | 'pressureWashing' | 'gutterCleaning' | 'houseWash' | 'roofCleaning'> = [
    'windowCleaning',
    'drivewayCleaning', 
    'pressureWashing',
    'gutterCleaning',
    'houseWash',
    'roofCleaning',
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
    >
          {/* Window Options - shown when enabled */}
          <div className="space-y-4">
            {/* Window Cleaning Type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Service Type</Label>
              <RadioGroup
                value={homeDetails.windowCleaningType}
                onValueChange={(v) => onHomeDetailsChange({ windowCleaningType: v as 'exterior' | 'both' })}
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
                    <div className="font-medium text-sm">Inside + Outside</div>
                    <div className="text-xs text-muted-foreground">Complete clean</div>
                  </div>
                </label>
              </RadioGroup>
            </div>
            
            {/* Window Condition */}
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
            
            {/* Advanced Window Details */}
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
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm">Driveway Area</Label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={services.drivewayCleaning.sqft || ''}
                onChange={(e) => 
                  onChange({ 
                    drivewayCleaning: { 
                      ...services.drivewayCleaning, 
                      sqft: parseInt(e.target.value) || FLATWORK_DEFAULT_SQFT.driveway 
                    } 
                  })
                }
                placeholder={`~${FLATWORK_DEFAULT_SQFT.driveway}`}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">sq ft</span>
              <SqftCalculator
                type="driveway"
                currentValue={services.drivewayCleaning.sqft}
                onApply={(sqft) => onChange({ 
                  drivewayCleaning: { ...services.drivewayCleaning, sqft } 
                })}
              />
            </div>
          </div>
          
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
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm">Surface Type</Label>
          <Select
            value={services.pressureWashing.surfaceType}
            onValueChange={(v) => 
              onChange({ 
                pressureWashing: { ...services.pressureWashing, surfaceType: v as any } 
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
        
        <div className="space-y-2">
          <Label className="text-sm">Select Areas to Clean</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <FlatworkAreaInput
              label="Front Porch"
              area={services.pressureWashing.frontPorch}
              price={servicePrices.pressureWashingBreakdown.frontPorch}
              defaultSqft={FLATWORK_DEFAULT_SQFT.frontPorch}
              calculatorType="porch"
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, frontPorch: area }
              })}
            />
            
            <FlatworkAreaInput
              label="Back Patio"
              area={services.pressureWashing.backPatio}
              price={servicePrices.pressureWashingBreakdown.backPatio}
              defaultSqft={FLATWORK_DEFAULT_SQFT.backPatio}
              calculatorType="patio"
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, backPatio: area }
              })}
            />
            
            <FlatworkAreaInput
              label="Pool Deck"
              area={services.pressureWashing.poolDeck}
              price={servicePrices.pressureWashingBreakdown.poolDeck}
              defaultSqft={FLATWORK_DEFAULT_SQFT.poolDeck}
              calculatorType="poolDeck"
              onChange={(area) => onChange({
                pressureWashing: { ...services.pressureWashing, poolDeck: area }
              })}
            />
            
            <FlatworkAreaInput
              label="Walkways"
              area={services.pressureWashing.walkways}
              price={servicePrices.pressureWashingBreakdown.walkways}
              defaultSqft={FLATWORK_DEFAULT_SQFT.walkways}
              calculatorType="walkways"
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
      price={servicePrices.gutterCleaning}
      isEnabled={services.gutterCleaning}
      onToggle={() => onChange({ gutterCleaning: !services.gutterCleaning })}
      isFeatured={isFeatured('gutterCleaning')}
    />
  );

  const renderHouseWash = () => (
    <ServiceCard
      key="houseWash"
      id="houseWash"
      icon={Warehouse}
      title="House Wash"
      description="Gentle exterior soft washing"
      price={servicePrices.houseWash}
      isEnabled={services.houseWash}
      onToggle={() => onChange({ houseWash: !services.houseWash })}
      isFeatured={isFeatured('houseWash')}
    />
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
    >
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
