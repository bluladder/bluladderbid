import { Droplets, Home, Cloud, Warehouse, Plus, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AdditionalServices, ServicePrices } from '@/types/homeowner';

interface AdditionalServicesFormProps {
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

export function AdditionalServicesForm({ services, servicePrices, onChange }: AdditionalServicesFormProps) {
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-4">
        <div className="section-header">
          <div className="section-icon">
            <Plus className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">Additional Services</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Add more services to your package for a complete home care solution
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pressure Washing */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          services.pressureWashing.enabled 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/30'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Droplets className="w-5 h-5 text-primary" />
              <div>
                <Label className="font-semibold text-base cursor-pointer">Pressure Washing</Label>
                <p className="text-sm text-muted-foreground">Driveway, patio, and more</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {services.pressureWashing.enabled && servicePrices.pressureWashing > 0 && (
                <span className="price-display text-lg text-primary">
                  {formatPrice(servicePrices.pressureWashing + servicePrices.pressureWashingAddons)}
                </span>
              )}
              <Switch
                checked={services.pressureWashing.enabled}
                onCheckedChange={(checked) => 
                  onChange({ 
                    pressureWashing: { ...services.pressureWashing, enabled: checked } 
                  })
                }
              />
            </div>
          </div>
          
          {services.pressureWashing.enabled && (
            <div className="space-y-4 pt-3 border-t border-border mt-3">
              <div className="grid gap-4 md:grid-cols-2">
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
              
              <div className="space-y-2">
                <Label className="text-sm">Add-On Areas</Label>
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
              </div>
            </div>
          )}
        </div>
        
        {/* Gutter Cleaning */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          services.gutterCleaning 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Home className="w-5 h-5 text-primary" />
              <div>
                <Label className="font-semibold text-base cursor-pointer">Gutter Cleaning</Label>
                <p className="text-sm text-muted-foreground">Full gutter and downspout cleaning</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {services.gutterCleaning && servicePrices.gutterCleaning > 0 && (
                <span className="price-display text-lg text-primary">
                  {formatPrice(servicePrices.gutterCleaning)}
                </span>
              )}
              <Switch
                checked={services.gutterCleaning}
                onCheckedChange={(checked) => onChange({ gutterCleaning: checked })}
              />
            </div>
          </div>
        </div>
        
        {/* House Wash */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          services.houseWash 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Warehouse className="w-5 h-5 text-primary" />
              <div>
                <Label className="font-semibold text-base cursor-pointer">House Wash</Label>
                <p className="text-sm text-muted-foreground">Gentle exterior soft washing</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {services.houseWash && servicePrices.houseWash > 0 && (
                <span className="price-display text-lg text-primary">
                  {formatPrice(servicePrices.houseWash)}
                </span>
              )}
              <Switch
                checked={services.houseWash}
                onCheckedChange={(checked) => onChange({ houseWash: checked })}
              />
            </div>
          </div>
        </div>
        
        {/* Roof Cleaning */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          services.roofCleaning 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/30'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Cloud className="w-5 h-5 text-primary" />
              <div>
                <Label className="font-semibold text-base cursor-pointer">Roof Cleaning</Label>
                <p className="text-sm text-muted-foreground">Safe, low-pressure roof treatment</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {services.roofCleaning && servicePrices.roofCleaning > 0 && (
                <span className="price-display text-lg text-primary">
                  {formatPrice(servicePrices.roofCleaning)}
                </span>
              )}
              <Switch
                checked={services.roofCleaning}
                onCheckedChange={(checked) => onChange({ roofCleaning: checked })}
              />
            </div>
          </div>
          
          {services.roofCleaning && (
            <div className="space-y-4 pt-3 border-t border-border mt-3">
              <div className="grid gap-4 md:grid-cols-2">
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
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
