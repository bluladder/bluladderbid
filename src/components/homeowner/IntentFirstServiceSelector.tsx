import { useState } from 'react';
import { Check, Plus, Sparkles, Droplets, Home, Cloud, Warehouse, ChevronDown, ChevronUp, Grid3X3, SunMedium, ArrowUpFromLine, Square } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import type { AdditionalServices, ServicePrices, HomeDetails } from '@/types/homeowner';

interface IntentFirstServiceSelectorProps {
  services: AdditionalServices;
  servicePrices: ServicePrices;
  homeDetails: HomeDetails;
  onChange: (updates: Partial<AdditionalServices>) => void;
  onHomeDetailsChange: (updates: Partial<HomeDetails>) => void;
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
}

function ServiceCard({ icon: Icon, title, description, price, isEnabled, onToggle, children }: ServiceCardProps) {
  return (
    <div 
      className={`relative p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer ${
        isEnabled 
          ? 'border-primary bg-primary/5 shadow-md' 
          : 'border-border hover:border-primary/40 hover:shadow-sm bg-card'
      }`}
      onClick={(e) => {
        // Don't toggle if clicking on a child input
        if ((e.target as HTMLElement).closest('select, input, button, [role="radio"], [role="switch"]')) return;
        onToggle();
      }}
    >
      {/* Selection indicator */}
      <div className={`
        absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200
        ${isEnabled 
          ? 'bg-primary text-primary-foreground shadow-sm' 
          : 'bg-muted/80 text-muted-foreground'
        }
      `}>
        {isEnabled ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Plus className="w-3.5 h-3.5" />
        )}
      </div>
      
      <div className="flex items-start gap-3 pr-8">
        <div className={`
          w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200
          ${isEnabled 
            ? 'bg-primary text-primary-foreground shadow-md' 
            : 'bg-muted text-muted-foreground'
          }
        `}>
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className={`font-semibold ${isEnabled ? 'text-foreground' : 'text-foreground/80'}`}>
              {title}
            </h3>
            {isEnabled && price > 0 && (
              <span className="text-primary font-bold price-display">
                {formatPrice(price)}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {description}
          </p>
        </div>
      </div>
      
      {/* Expandable options */}
      {isEnabled && children && (
        <div className="mt-4 pt-4 border-t border-border" onClick={e => e.stopPropagation()}>
          {children}
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
  onHomeDetailsChange 
}: IntentFirstServiceSelectorProps) {
  const [expandedPressureWash, setExpandedPressureWash] = useState(false);
  const [windowExpanded, setWindowExpanded] = useState(true);
  
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
        {/* Window Cleaning - Always shown as primary with expandable options */}
        <div className="relative p-4 rounded-xl border-2 border-primary bg-primary/5 shadow-md">
          <div className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-sm">
            <Check className="w-3.5 h-3.5" />
          </div>
          
          <div className="flex items-start gap-3 pr-8">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary text-primary-foreground shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-foreground">Window Cleaning</h3>
                <span className="text-primary font-bold price-display">
                  {formatPrice(servicePrices.windowCleaningTotal)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Crystal clear windows, inside or out
              </p>
            </div>
          </div>
          
          {/* Window Options - Always visible */}
          <div className="mt-4 pt-4 border-t border-border space-y-4">
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
        </div>
        
        {/* Pressure Washing */}
        <ServiceCard
          id="pressureWashing"
          icon={Droplets}
          title="Pressure Washing"
          description="Driveway, patio, and flatwork"
          price={servicePrices.pressureWashing + servicePrices.pressureWashingAddons}
          isEnabled={services.pressureWashing.enabled}
          onToggle={() => onChange({ 
            pressureWashing: { ...services.pressureWashing, enabled: !services.pressureWashing.enabled } 
          })}
        >
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm">Driveway Size</Label>
                <Select
                  value={services.pressureWashing.drivewaySize}
                  onValueChange={(v) => 
                    onChange({ 
                      pressureWashing: { ...services.pressureWashing, drivewaySize: v as 'small' | 'medium' | 'large' } 
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small (1-car)</SelectItem>
                    <SelectItem value="medium">Medium (2-car)</SelectItem>
                    <SelectItem value="large">Large (3+ car)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
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
            </div>
            
            <Collapsible open={expandedPressureWash} onOpenChange={setExpandedPressureWash}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                {expandedPressureWash ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {expandedPressureWash ? 'Hide add-on areas' : 'Add more areas'}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'frontPorch', label: 'Front Porch', price: 75 },
                    { key: 'backPatio', label: 'Back Patio', price: 95 },
                    { key: 'poolDeck', label: 'Pool Deck', price: 125 },
                    { key: 'sidewalks', label: 'Sidewalks', price: 65 },
                  ].map(({ key, label, price }) => (
                    <label
                      key={key}
                      className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                        services.pressureWashing[key as keyof typeof services.pressureWashing]
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <Checkbox
                        checked={services.pressureWashing[key as keyof typeof services.pressureWashing] as boolean}
                        onCheckedChange={(checked) =>
                          onChange({
                            pressureWashing: { ...services.pressureWashing, [key]: checked }
                          })
                        }
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">+{formatPrice(price)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </ServiceCard>
        
        {/* Gutter Cleaning */}
        <ServiceCard
          id="gutterCleaning"
          icon={Home}
          title="Gutter Cleaning"
          description="Full gutter and downspout cleaning"
          price={servicePrices.gutterCleaning}
          isEnabled={services.gutterCleaning}
          onToggle={() => onChange({ gutterCleaning: !services.gutterCleaning })}
        />
        
        {/* House Wash */}
        <ServiceCard
          id="houseWash"
          icon={Warehouse}
          title="House Wash"
          description="Gentle exterior soft washing"
          price={servicePrices.houseWash}
          isEnabled={services.houseWash}
          onToggle={() => onChange({ houseWash: !services.houseWash })}
        />
        
        {/* Roof Cleaning */}
        <ServiceCard
          id="roofCleaning"
          icon={Cloud}
          title="Roof Cleaning"
          description="Safe, low-pressure roof treatment"
          price={servicePrices.roofCleaning}
          isEnabled={services.roofCleaning}
          onToggle={() => onChange({ roofCleaning: !services.roofCleaning })}
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
      </CardContent>
    </Card>
  );
}
