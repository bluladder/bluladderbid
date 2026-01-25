import { Home, ChevronDown, ChevronUp, Droplets, SunMedium, Grid3X3, ArrowUpFromLine, Square } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { HomeDetails } from '@/types/homeowner';

interface HomeDetailsFormProps {
  homeDetails: HomeDetails;
  onChange: (updates: Partial<HomeDetails>) => void;
}

export function HomeDetailsForm({ homeDetails, onChange }: HomeDetailsFormProps) {
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-4">
        <div className="section-header">
          <div className="section-icon">
            <Home className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">Tell Us About Your Home</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              We'll use this to calculate your exact pricing
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Home Size */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sqft" className="text-sm font-medium">
              Home Square Footage
            </Label>
            <Input
              id="sqft"
              type="number"
              min={500}
              max={15000}
              value={homeDetails.squareFootage}
              onChange={(e) => onChange({ squareFootage: Math.max(500, parseInt(e.target.value) || 0) })}
              className="input-field"
              placeholder="e.g. 2,500"
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
        
        {/* Window Cleaning Type */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Window Cleaning Service</Label>
          <RadioGroup
            value={homeDetails.windowCleaningType}
            onValueChange={(v) => onChange({ windowCleaningType: v as 'exterior' | 'both' })}
            className="grid gap-3 md:grid-cols-2"
          >
            <label
              htmlFor="type-exterior"
              className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                homeDetails.windowCleaningType === 'exterior'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <RadioGroupItem value="exterior" id="type-exterior" />
              <div>
                <div className="font-medium">Exterior Only</div>
                <div className="text-sm text-muted-foreground">
                  Outside windows cleaned
                </div>
              </div>
            </label>
            <label
              htmlFor="type-both"
              className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                homeDetails.windowCleaningType === 'both'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <RadioGroupItem value="both" id="type-both" />
              <div>
                <div className="font-medium">Inside + Outside</div>
                <div className="text-sm text-muted-foreground">
                  Complete window cleaning
                </div>
              </div>
            </label>
          </RadioGroup>
        </div>
        
        {/* Condition */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Window Condition</Label>
          <RadioGroup
            value={homeDetails.condition}
            onValueChange={(v) => onChange({ condition: v as 'maintenance' | 'heavy' })}
            className="grid gap-3 md:grid-cols-2"
          >
            <label
              htmlFor="condition-maintenance"
              className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                homeDetails.condition === 'maintenance'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <RadioGroupItem value="maintenance" id="condition-maintenance" />
              <div>
                <div className="font-medium">Regular Maintenance</div>
                <div className="text-sm text-muted-foreground">
                  Cleaned within the past year
                </div>
              </div>
            </label>
            <label
              htmlFor="condition-heavy"
              className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                homeDetails.condition === 'heavy'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <RadioGroupItem value="heavy" id="condition-heavy" />
              <div>
                <div className="font-medium">First-Time / Heavy Buildup</div>
                <div className="text-sm text-muted-foreground">
                  Hasn't been cleaned in a while
                </div>
              </div>
            </label>
          </RadioGroup>
        </div>
        
        {/* Advanced Window Details */}
        <Collapsible 
          open={homeDetails.showAdvanced} 
          onOpenChange={(open) => onChange({ showAdvanced: open })}
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-4 h-auto border border-border rounded-lg hover:bg-muted/50">
              <span className="text-sm font-medium">Advanced Window Details</span>
              {homeDetails.showAdvanced ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="space-y-4 p-4 rounded-lg bg-muted/30 border border-border">
              <p className="text-sm text-muted-foreground">
                These details help us provide a more accurate quote for your specific situation.
              </p>
              
              {/* Hard Water Stains */}
              <div className="space-y-3 p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-primary" />
                    <Label className="font-medium">Hard Water Stains</Label>
                  </div>
                  <Switch
                    checked={homeDetails.hardWaterStains}
                    onCheckedChange={(checked) => onChange({ hardWaterStains: checked })}
                  />
                </div>
                {homeDetails.hardWaterStains && (
                  <div className="pl-6 space-y-2">
                    <Label className="text-sm text-muted-foreground">% of windows affected</Label>
                    <RadioGroup
                      value={String(homeDetails.hardWaterPercent)}
                      onValueChange={(v) => onChange({ hardWaterPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                      className="flex gap-4 flex-wrap"
                    >
                      {[25, 50, 75, 100].map((pct) => (
                        <div key={pct} className="flex items-center space-x-2">
                          <RadioGroupItem value={String(pct)} id={`hw-${pct}`} />
                          <Label htmlFor={`hw-${pct}`} className="cursor-pointer">{pct}%</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </div>
              
              {/* French Panes */}
              <div className="space-y-3 p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Grid3X3 className="w-4 h-4 text-primary" />
                    <Label className="font-medium">French Panes (Multi-Pane Windows)</Label>
                  </div>
                  <Switch
                    checked={homeDetails.frenchPanes}
                    onCheckedChange={(checked) => onChange({ frenchPanes: checked })}
                  />
                </div>
                {homeDetails.frenchPanes && (
                  <div className="pl-6 space-y-2">
                    <Label className="text-sm text-muted-foreground">% of windows affected</Label>
                    <RadioGroup
                      value={String(homeDetails.frenchPanesPercent)}
                      onValueChange={(v) => onChange({ frenchPanesPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                      className="flex gap-4 flex-wrap"
                    >
                      {[25, 50, 75, 100].map((pct) => (
                        <div key={pct} className="flex items-center space-x-2">
                          <RadioGroupItem value={String(pct)} id={`fp-${pct}`} />
                          <Label htmlFor={`fp-${pct}`} className="cursor-pointer">{pct}%</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </div>
              
              {/* Solar Screens */}
              <div className="space-y-3 p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SunMedium className="w-4 h-4 text-primary" />
                    <Label className="font-medium">Solar Screens Covering Windows</Label>
                  </div>
                  <Switch
                    checked={homeDetails.solarScreens}
                    onCheckedChange={(checked) => onChange({ solarScreens: checked })}
                  />
                </div>
                {homeDetails.solarScreens && (
                  <div className="pl-6 space-y-2">
                    <Label className="text-sm text-muted-foreground">% of windows affected</Label>
                    <RadioGroup
                      value={String(homeDetails.solarScreensPercent)}
                      onValueChange={(v) => onChange({ solarScreensPercent: parseInt(v) as 25 | 50 | 75 | 100 })}
                      className="flex gap-4 flex-wrap"
                    >
                      {[25, 50, 75, 100].map((pct) => (
                        <div key={pct} className="flex items-center space-x-2">
                          <RadioGroupItem value={String(pct)} id={`ss-${pct}`} />
                          <Label htmlFor={`ss-${pct}`} className="cursor-pointer">{pct}%</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </div>
              
              {/* Ladder Work */}
              <div className="space-y-3 p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowUpFromLine className="w-4 h-4 text-primary" />
                    <Label className="font-medium">2nd Floor Interior Windows Need Ladder</Label>
                  </div>
                  <Switch
                    checked={homeDetails.ladderWork}
                    onCheckedChange={(checked) => onChange({ ladderWork: checked })}
                  />
                </div>
                {homeDetails.ladderWork && (
                  <div className="pl-6 space-y-2">
                    <Label className="text-sm text-muted-foreground">How many windows?</Label>
                    <RadioGroup
                      value={homeDetails.ladderWorkCount}
                      onValueChange={(v) => onChange({ ladderWorkCount: v as '1-3' | '4-8' | '9+' })}
                      className="flex gap-4 flex-wrap"
                    >
                      {(['1-3', '4-8', '9+'] as const).map((count) => (
                        <div key={count} className="flex items-center space-x-2">
                          <RadioGroupItem value={count} id={`lw-${count}`} />
                          <Label htmlFor={`lw-${count}`} className="cursor-pointer">{count}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </div>
              
              {/* Sunroom */}
              <div className="space-y-3 p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center gap-2">
                  <Square className="w-4 h-4 text-primary" />
                  <Label className="font-medium">Sunroom or Room with Walls of Windows</Label>
                </div>
                <Select
                  value={homeDetails.sunroom}
                  onValueChange={(v) => onChange({ sunroom: v as 'none' | 'small' | 'medium' | 'large' })}
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
      </CardContent>
    </Card>
  );
}
