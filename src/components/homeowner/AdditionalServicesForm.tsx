import { Droplets, Home, Cloud, Warehouse, Plus, Check, Car } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AdditionalServices, ServicePrices, FlatworkArea } from '@/types/homeowner';
import { FLATWORK_DEFAULT_SQFT } from '@/types/homeowner';

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

// Component for flatwork area selection with sqft input
interface FlatworkAreaInputProps {
  label: string;
  area: FlatworkArea;
  price: number;
  defaultSqft: number;
  onChange: (area: FlatworkArea) => void;
}

function FlatworkAreaInput({ label, area, price, defaultSqft, onChange }: FlatworkAreaInputProps) {
  return (
    <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
      area.enabled ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
    }`}>
      <Checkbox
        checked={area.enabled}
        onCheckedChange={(checked) => onChange({ ...area, enabled: !!checked })}
      />
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        {area.enabled ? (
          <div className="flex items-center gap-1 mt-1">
            <Input
              type="number"
              value={area.sqft || ''}
              onChange={(e) => onChange({ ...area, sqft: parseInt(e.target.value) || defaultSqft })}
              placeholder={`~${defaultSqft}`}
              className="w-20 h-6 text-xs"
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-xs text-muted-foreground">sqft</span>
            {price > 0 && <span className="text-xs text-primary ml-auto">{formatPrice(price)}</span>}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">~{defaultSqft} sqft avg</div>
        )}
      </div>
    </label>
  );
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
        {/* Driveway Cleaning */}
        <div className={`p-4 rounded-lg border-2 transition-all ${
          services.drivewayCleaning.enabled 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/30'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Car className="w-5 h-5 text-primary" />
              <div>
                <Label className="font-semibold text-base cursor-pointer">Driveway Cleaning</Label>
                <p className="text-sm text-muted-foreground">Power wash your driveway</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {services.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0 && (
                <span className="price-display text-lg text-primary">
                  {formatPrice(servicePrices.drivewayCleaning)}
                </span>
              )}
              <Switch
                checked={services.drivewayCleaning.enabled}
                onCheckedChange={(checked) => 
                  onChange({ 
                    drivewayCleaning: { ...services.drivewayCleaning, enabled: checked } 
                  })
                }
              />
            </div>
          </div>
          
          {services.drivewayCleaning.enabled && (
            <div className="space-y-4 pt-3 border-t border-border mt-3">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm">Driveway Area</Label>
                  <div className="flex items-center gap-2">
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
          )}
        </div>
        
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
                <p className="text-sm text-muted-foreground">Porches, patios, pool decks, walkways</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {services.pressureWashing.enabled && servicePrices.pressureWashing > 0 && (
                <span className="price-display text-lg text-primary">
                  {formatPrice(servicePrices.pressureWashing)}
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
                <Label className="text-sm">Select Areas</Label>
                <div className="grid grid-cols-2 gap-3">
                  <FlatworkAreaInput
                    label="Front Porch"
                    area={services.pressureWashing.frontPorch}
                    price={servicePrices.pressureWashingBreakdown.frontPorch}
                    defaultSqft={FLATWORK_DEFAULT_SQFT.frontPorch}
                    onChange={(area) => onChange({
                      pressureWashing: { ...services.pressureWashing, frontPorch: area }
                    })}
                  />
                  <FlatworkAreaInput
                    label="Back Patio"
                    area={services.pressureWashing.backPatio}
                    price={servicePrices.pressureWashingBreakdown.backPatio}
                    defaultSqft={FLATWORK_DEFAULT_SQFT.backPatio}
                    onChange={(area) => onChange({
                      pressureWashing: { ...services.pressureWashing, backPatio: area }
                    })}
                  />
                  <FlatworkAreaInput
                    label="Pool Deck"
                    area={services.pressureWashing.poolDeck}
                    price={servicePrices.pressureWashingBreakdown.poolDeck}
                    defaultSqft={FLATWORK_DEFAULT_SQFT.poolDeck}
                    onChange={(area) => onChange({
                      pressureWashing: { ...services.pressureWashing, poolDeck: area }
                    })}
                  />
                  <FlatworkAreaInput
                    label="Walkways"
                    area={services.pressureWashing.walkways}
                    price={servicePrices.pressureWashingBreakdown.walkways}
                    defaultSqft={FLATWORK_DEFAULT_SQFT.walkways}
                    onChange={(area) => onChange({
                      pressureWashing: { ...services.pressureWashing, walkways: area }
                    })}
                  />
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
