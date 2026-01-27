import { Home, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ServicePlanHomeDetails } from '@/types/servicePlanBuilder';

interface PlanHomeDetailsFormProps {
  homeDetails: ServicePlanHomeDetails;
  onChange: (updates: Partial<ServicePlanHomeDetails>) => void;
  enabledServices: string[];
}

const SURFACE_TYPES = [
  { value: 'concrete', label: 'Concrete' },
  { value: 'stamped', label: 'Stamped Concrete' },
  { value: 'pavers', label: 'Pavers' },
  { value: 'brick', label: 'Brick' },
  { value: 'stone', label: 'Stone' },
  { value: 'tile', label: 'Tile' },
] as const;

const ROOF_TYPES = [
  { value: 'asphalt', label: 'Asphalt Shingles' },
  { value: 'tile', label: 'Tile' },
  { value: 'metal', label: 'Metal' },
  { value: 'flat', label: 'Flat Roof' },
] as const;

const ROOF_SEVERITY = [
  { value: 'light', label: 'Light staining' },
  { value: 'moderate', label: 'Moderate buildup' },
  { value: 'heavy', label: 'Heavy moss/algae' },
] as const;

const PERCENTAGE_OPTIONS = [25, 50, 75, 100] as const;

export function PlanHomeDetailsForm({ homeDetails, onChange, enabledServices }: PlanHomeDetailsFormProps) {
  const [showWindowAdvanced, setShowWindowAdvanced] = useState(false);
  
  // Determine which sections to show based on enabled services
  const showWindowSection = enabledServices.some(s => 
    s === 'window-cleaning-exterior' || s === 'window-cleaning-interior'
  );
  const showRoofSection = enabledServices.includes('roof-cleaning');
  const showDrivewaySection = enabledServices.includes('driveway-cleaning');
  const showFlatworkSection = enabledServices.includes('pressure-washing');
  
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-4">
        <div className="section-header">
          <div className="section-icon">
            <Home className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">Home Details</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Enter details for accurate pricing
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Base Home Info - Always shown */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sqft" className="text-sm font-medium">
              Home Square Footage *
            </Label>
            <Input
              id="sqft"
              type="number"
              value={homeDetails.squareFootage === 0 ? '' : homeDetails.squareFootage}
              onChange={(e) => {
                const value = e.target.value;
                onChange({ squareFootage: value === '' ? 0 : parseInt(value, 10) });
              }}
              placeholder="e.g. 2500"
            />
          </div>
          
          <div className="space-y-2">
            <Label className="text-sm font-medium">Number of Stories</Label>
            <RadioGroup
              value={String(homeDetails.stories)}
              onValueChange={(v) => onChange({ stories: parseInt(v) as 1 | 2 | 3 })}
              className="flex gap-4"
            >
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center space-x-2">
                  <RadioGroupItem value={String(n)} id={`stories-${n}`} />
                  <Label htmlFor={`stories-${n}`} className="cursor-pointer">
                    {n} {n === 1 ? 'Story' : 'Stories'}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label className="text-sm font-medium">Current Condition</Label>
          <RadioGroup
            value={homeDetails.condition}
            onValueChange={(v) => onChange({ condition: v as 'maintenance' | 'heavy' })}
            className="flex gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="maintenance" id="condition-maintenance" />
              <Label htmlFor="condition-maintenance" className="cursor-pointer">
                Regular Maintenance
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="heavy" id="condition-heavy" />
              <Label htmlFor="condition-heavy" className="cursor-pointer">
                Heavy Cleaning Needed
              </Label>
            </div>
          </RadioGroup>
        </div>
        
        {/* Window Details */}
        {showWindowSection && (
          <div className="border-t pt-6 space-y-4">
            <h4 className="font-medium text-foreground">Window Details</h4>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Window Cleaning Type</Label>
              <RadioGroup
                value={homeDetails.windowCleaningType}
                onValueChange={(v) => onChange({ windowCleaningType: v as 'exterior' | 'both' })}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="exterior" id="window-exterior" />
                  <Label htmlFor="window-exterior" className="cursor-pointer">
                    Exterior Only
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="both" id="window-both" />
                  <Label htmlFor="window-both" className="cursor-pointer">
                    Interior & Exterior
                  </Label>
                </div>
              </RadioGroup>
            </div>
            
            <Collapsible open={showWindowAdvanced} onOpenChange={setShowWindowAdvanced}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-primary hover:text-primary/80">
                {showWindowAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Advanced window options
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 space-y-4">
                {/* Hard Water Stains */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <Label className="text-sm font-medium">Hard Water Stains</Label>
                    <p className="text-xs text-muted-foreground">Mineral deposits on windows</p>
                  </div>
                  <Switch
                    checked={homeDetails.hardWaterStains}
                    onCheckedChange={(checked) => onChange({ hardWaterStains: checked })}
                  />
                </div>
                {homeDetails.hardWaterStains && (
                  <div className="ml-4 space-y-2">
                    <Label className="text-xs text-muted-foreground">Percentage of windows affected</Label>
                    <RadioGroup
                      value={String(homeDetails.hardWaterPercent)}
                      onValueChange={(v) => onChange({ hardWaterPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                      className="flex gap-2"
                    >
                      {PERCENTAGE_OPTIONS.map((pct) => (
                        <div key={pct} className="flex items-center space-x-1">
                          <RadioGroupItem value={String(pct)} id={`hardwater-${pct}`} />
                          <Label htmlFor={`hardwater-${pct}`} className="text-xs cursor-pointer">{pct}%</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
                
                {/* French Panes */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <Label className="text-sm font-medium">French Panes</Label>
                    <p className="text-xs text-muted-foreground">Multi-pane windows</p>
                  </div>
                  <Switch
                    checked={homeDetails.frenchPanes}
                    onCheckedChange={(checked) => onChange({ frenchPanes: checked })}
                  />
                </div>
                {homeDetails.frenchPanes && (
                  <div className="ml-4 space-y-2">
                    <Label className="text-xs text-muted-foreground">Percentage of windows affected</Label>
                    <RadioGroup
                      value={String(homeDetails.frenchPanesPercent)}
                      onValueChange={(v) => onChange({ frenchPanesPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                      className="flex gap-2"
                    >
                      {PERCENTAGE_OPTIONS.map((pct) => (
                        <div key={pct} className="flex items-center space-x-1">
                          <RadioGroupItem value={String(pct)} id={`french-${pct}`} />
                          <Label htmlFor={`french-${pct}`} className="text-xs cursor-pointer">{pct}%</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
                
                {/* Solar Screens */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <Label className="text-sm font-medium">Solar Screens</Label>
                    <p className="text-xs text-muted-foreground">Windows with solar screens</p>
                  </div>
                  <Switch
                    checked={homeDetails.solarScreens}
                    onCheckedChange={(checked) => onChange({ solarScreens: checked })}
                  />
                </div>
                {homeDetails.solarScreens && (
                  <div className="ml-4 space-y-2">
                    <Label className="text-xs text-muted-foreground">Percentage of windows affected</Label>
                    <RadioGroup
                      value={String(homeDetails.solarScreensPercent)}
                      onValueChange={(v) => onChange({ solarScreensPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                      className="flex gap-2"
                    >
                      {PERCENTAGE_OPTIONS.map((pct) => (
                        <div key={pct} className="flex items-center space-x-1">
                          <RadioGroupItem value={String(pct)} id={`solar-${pct}`} />
                          <Label htmlFor={`solar-${pct}`} className="text-xs cursor-pointer">{pct}%</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
        
        {/* Roof Details */}
        {showRoofSection && (
          <div className="border-t pt-6 space-y-4">
            <h4 className="font-medium text-foreground">Roof Details</h4>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Roof Type</Label>
                <RadioGroup
                  value={homeDetails.roofType}
                  onValueChange={(v) => onChange({ roofType: v as typeof homeDetails.roofType })}
                  className="space-y-2"
                >
                  {ROOF_TYPES.map((type) => (
                    <div key={type.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={type.value} id={`roof-${type.value}`} />
                      <Label htmlFor={`roof-${type.value}`} className="cursor-pointer">{type.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm font-medium">Staining Severity</Label>
                <RadioGroup
                  value={homeDetails.roofSeverity}
                  onValueChange={(v) => onChange({ roofSeverity: v as typeof homeDetails.roofSeverity })}
                  className="space-y-2"
                >
                  {ROOF_SEVERITY.map((sev) => (
                    <div key={sev.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={sev.value} id={`severity-${sev.value}`} />
                      <Label htmlFor={`severity-${sev.value}`} className="cursor-pointer">{sev.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            </div>
          </div>
        )}
        
        {/* Driveway Details */}
        {showDrivewaySection && (
          <div className="border-t pt-6 space-y-4">
            <h4 className="font-medium text-foreground">Driveway Details</h4>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="driveway-sqft" className="text-sm font-medium">
                  Driveway Size (sq ft)
                </Label>
                <Input
                  id="driveway-sqft"
                  type="number"
                  value={homeDetails.drivewaySqft}
                  onChange={(e) => onChange({ drivewaySqft: parseInt(e.target.value) || 0 })}
                  placeholder="e.g. 400"
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm font-medium">Surface Type</Label>
                <RadioGroup
                  value={homeDetails.drivewaySurfaceType}
                  onValueChange={(v) => onChange({ drivewaySurfaceType: v as typeof homeDetails.drivewaySurfaceType })}
                  className="grid grid-cols-2 gap-2"
                >
                  {SURFACE_TYPES.map((type) => (
                    <div key={type.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={type.value} id={`dw-surface-${type.value}`} />
                      <Label htmlFor={`dw-surface-${type.value}`} className="text-sm cursor-pointer">{type.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            </div>
          </div>
        )}
        
        {/* Flatwork/Pressure Washing Details */}
        {showFlatworkSection && (
          <div className="border-t pt-6 space-y-4">
            <h4 className="font-medium text-foreground">Flatwork Areas</h4>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Surface Type</Label>
              <RadioGroup
                value={homeDetails.flatworkSurfaceType}
                onValueChange={(v) => onChange({ flatworkSurfaceType: v as typeof homeDetails.flatworkSurfaceType })}
                className="flex flex-wrap gap-3"
              >
                {SURFACE_TYPES.map((type) => (
                  <div key={type.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={type.value} id={`fw-surface-${type.value}`} />
                    <Label htmlFor={`fw-surface-${type.value}`} className="text-sm cursor-pointer">{type.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="front-porch" className="text-sm font-medium">
                  Front Porch (sq ft)
                </Label>
                <Input
                  id="front-porch"
                  type="number"
                  value={homeDetails.frontPorchSqft}
                  onChange={(e) => onChange({ frontPorchSqft: parseInt(e.target.value) || 0 })}
                  placeholder="e.g. 80"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="back-patio" className="text-sm font-medium">
                  Back Patio (sq ft)
                </Label>
                <Input
                  id="back-patio"
                  type="number"
                  value={homeDetails.backPatioSqft}
                  onChange={(e) => onChange({ backPatioSqft: parseInt(e.target.value) || 0 })}
                  placeholder="e.g. 200"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="pool-deck" className="text-sm font-medium">
                  Pool Deck (sq ft)
                </Label>
                <Input
                  id="pool-deck"
                  type="number"
                  value={homeDetails.poolDeckSqft}
                  onChange={(e) => onChange({ poolDeckSqft: parseInt(e.target.value) || 0 })}
                  placeholder="e.g. 300"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="walkways" className="text-sm font-medium">
                  Walkways (sq ft)
                </Label>
                <Input
                  id="walkways"
                  type="number"
                  value={homeDetails.walkwaysSqft}
                  onChange={(e) => onChange({ walkwaysSqft: parseInt(e.target.value) || 0 })}
                  placeholder="e.g. 100"
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
