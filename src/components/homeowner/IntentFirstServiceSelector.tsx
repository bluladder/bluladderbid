import { useState } from 'react';
import { Check, Plus, Sparkles, Droplets, Home, Cloud, Warehouse, Grid3X3, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { AdditionalServices, ServicePrices } from '@/types/homeowner';

interface IntentFirstServiceSelectorProps {
  services: AdditionalServices;
  servicePrices: ServicePrices;
  onChange: (updates: Partial<AdditionalServices>) => void;
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
        if ((e.target as HTMLElement).closest('select, input, button')) return;
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

export function IntentFirstServiceSelector({ services, servicePrices, onChange }: IntentFirstServiceSelectorProps) {
  const [expandedPressureWash, setExpandedPressureWash] = useState(false);
  
  // Window cleaning is always included by default
  const windowCleaningEnabled = servicePrices.windowCleaningTotal > 0;
  
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
        {/* Window Cleaning - Always shown as primary */}
        <div className={`relative p-4 rounded-xl border-2 border-primary bg-primary/5 shadow-md`}>
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
