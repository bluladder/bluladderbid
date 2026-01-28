import { Info, ArrowDownCircle, Wrench, ShieldCheck } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { GutterCleaningAddons, DrainCount } from '@/types/homeowner';

interface GutterAddonsCardProps {
  addons: GutterCleaningAddons;
  prices: {
    drainCleaning: number;
    minorRepairs: number;
    gutterGuards: number;
  };
  onChange: (updates: Partial<GutterCleaningAddons>) => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function GutterAddonsCard({ addons, prices, onChange }: GutterAddonsCardProps) {
  return (
    <div className="space-y-3">
      {/* Underground Drain Cleaning */}
      <div className={`p-3 rounded-lg border transition-all ${
        addons.undergroundDrains.enabled 
          ? 'border-primary bg-primary/5' 
          : 'border-border hover:border-primary/50'
      }`}>
        <div className="flex items-start gap-3">
          <Checkbox
            id="drain-cleaning"
            checked={addons.undergroundDrains.enabled}
            onCheckedChange={(checked) => 
              onChange({ 
                undergroundDrains: { ...addons.undergroundDrains, enabled: !!checked } 
              })
            }
            className="mt-1"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <ArrowDownCircle className="w-4 h-4 text-primary" />
              <Label htmlFor="drain-cleaning" className="font-medium text-sm cursor-pointer">
                Underground Drain Cleaning
              </Label>
              {addons.undergroundDrains.enabled && prices.drainCleaning > 0 && (
                <span className="ml-auto text-sm font-semibold text-primary">
                  +{formatPrice(prices.drainCleaning)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Clears buried downspout lines to restore proper drainage.
            </p>
            
            {addons.undergroundDrains.enabled && (
              <div className="mt-3">
                <Label className="text-xs font-medium text-muted-foreground">Number of Drains</Label>
                <RadioGroup
                  value={addons.undergroundDrains.count}
                  onValueChange={(v) => 
                    onChange({ 
                      undergroundDrains: { ...addons.undergroundDrains, count: v as DrainCount } 
                    })
                  }
                  className="flex flex-wrap gap-2 mt-1.5"
                >
                  {(['1', '2', '3', '4+'] as DrainCount[]).map((count) => (
                    <label
                      key={count}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-all ${
                        addons.undergroundDrains.count === count
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <RadioGroupItem value={count} className="sr-only" />
                      <span>{count} drain{count !== '1' ? 's' : ''}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Minor Gutter Repairs */}
      <div className={`p-3 rounded-lg border transition-all ${
        addons.minorRepairs 
          ? 'border-primary bg-primary/5' 
          : 'border-border hover:border-primary/50'
      }`}>
        <div className="flex items-start gap-3">
          <Checkbox
            id="minor-repairs"
            checked={addons.minorRepairs}
            onCheckedChange={(checked) => onChange({ minorRepairs: !!checked })}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" />
              <Label htmlFor="minor-repairs" className="font-medium text-sm cursor-pointer">
                Minor Gutter Repairs
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[250px]">
                    <p className="text-xs">
                      Includes resealing corners, reattaching loose sections, and small adjustments.
                      Materials included unless otherwise noted.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {addons.minorRepairs && prices.minorRepairs > 0 && (
                <span className="ml-auto text-sm font-semibold text-primary">
                  +{formatPrice(prices.minorRepairs)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Fix common issues during your gutter cleaning visit.
            </p>
          </div>
        </div>
      </div>
      
      {/* Gutter Guards */}
      <div className={`p-3 rounded-lg border transition-all ${
        addons.gutterGuards.enabled 
          ? 'border-primary bg-primary/5' 
          : 'border-border hover:border-primary/50'
      }`}>
        <div className="flex items-start gap-3">
          <Checkbox
            id="gutter-guards"
            checked={addons.gutterGuards.enabled}
            onCheckedChange={(checked) => 
              onChange({ 
                gutterGuards: { ...addons.gutterGuards, enabled: !!checked } 
              })
            }
            className="mt-1"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <Label htmlFor="gutter-guards" className="font-medium text-sm cursor-pointer">
                Gutter Guards Installation
              </Label>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent/20 text-accent-foreground">
                ONE-TIME
              </span>
              {addons.gutterGuards.enabled && prices.gutterGuards > 0 && (
                <span className="ml-auto text-sm font-semibold text-primary">
                  +{formatPrice(prices.gutterGuards)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Premium stainless steel micro-mesh with 2-year workmanship warranty.
            </p>
            
            {addons.gutterGuards.enabled && (
              <div className="mt-3">
                <Label className="text-xs font-medium text-muted-foreground">Linear Feet of Gutters</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Input
                    type="number"
                    value={addons.gutterGuards.linearFeet || ''}
                    onChange={(e) => 
                      onChange({ 
                        gutterGuards: { 
                          ...addons.gutterGuards, 
                          linearFeet: parseInt(e.target.value) || 150 
                        } 
                      })
                    }
                    placeholder="150"
                    className="w-24 h-8 text-sm"
                    min={10}
                    step={10}
                  />
                  <span className="text-xs text-muted-foreground">linear ft</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
