import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Calculator, Home, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { HomeDetails, AdditionalServices } from '@/types/homeowner';
import { DEFAULT_HOME_DETAILS, DEFAULT_ADDITIONAL_SERVICES } from '@/types/homeowner';
import { usePricingConfig, type PricingData } from '@/hooks/usePricingConfig';

// Pricing calculation function (mirrors useServicePricing logic)
function calculatePrices(
  homeDetails: HomeDetails,
  additionalServices: AdditionalServices,
  pricing: PricingData
) {
  const { squareFootage, stories, windowCleaningType, condition } = homeDetails;
  
  // Helper to apply percentage modifiers
  const applyModifiers = (basePrice: number, modifierPercents: number[]): number => {
    const totalPercent = modifierPercents.reduce((sum, pct) => sum + pct, 0);
    return Math.round(basePrice * (1 + totalPercent / 100));
  };
  
  // Window Cleaning
  const windowConfig = pricing.window_cleaning;
  const windowModifiers = windowConfig.modifiers;
  
  const baseExterior = squareFootage * windowConfig.exteriorPerSqFt;
  const baseInterior = windowCleaningType === 'both' 
    ? squareFootage * windowConfig.interiorPerSqFt
    : 0;
  const baseWindowPrice = baseExterior + baseInterior;
  
  const windowModifierPercents: number[] = [];
  const storyMod = windowModifiers.stories[stories.toString()] ?? 0;
  windowModifierPercents.push(storyMod);
  const conditionMod = windowModifiers.condition?.[condition] ?? 0;
  windowModifierPercents.push(conditionMod);
  
  const windowCleaning = applyModifiers(baseWindowPrice, windowModifierPercents);
  
  // House Wash
  let houseWash = 0;
  if (additionalServices.houseWash) {
    const houseConfig = pricing.house_wash;
    const baseHouseWash = squareFootage * houseConfig.perSqFt;
    const houseStoryMod = houseConfig.modifiers.stories[stories.toString()] ?? 0;
    houseWash = applyModifiers(baseHouseWash, [houseStoryMod]);
  }
  
  // Gutter Cleaning
  let gutterCleaning = 0;
  if (additionalServices.gutterCleaning) {
    const gutterConfig = pricing.gutter_cleaning;
    const baseGutter = squareFootage * gutterConfig.perSqFt;
    const gutterStoryMod = gutterConfig.modifiers.stories[stories.toString()] ?? 0;
    gutterCleaning = applyModifiers(baseGutter, [gutterStoryMod]);
  }
  
  // Roof Cleaning
  let roofCleaning = 0;
  if (additionalServices.roofCleaning) {
    const roofConfig = pricing.roof_cleaning;
    const baseRoof = squareFootage * roofConfig.perSqFt;
    const roofModifiers: number[] = [];
    roofModifiers.push(roofConfig.modifiers.stories[stories.toString()] ?? 0);
    roofModifiers.push(roofConfig.modifiers.roofType?.[additionalServices.roofType] ?? 0);
    roofModifiers.push(roofConfig.modifiers.severity?.[additionalServices.roofSeverity] ?? 0);
    roofCleaning = applyModifiers(baseRoof, roofModifiers);
  }
  
  // Pressure Washing
  let pressureWashing = 0;
  if (additionalServices.pressureWashing.enabled) {
    const pwConfig = pricing.pressure_washing;
    const { drivewaySize, surfaceType } = additionalServices.pressureWashing;
    const drivewayBase = pwConfig.driveway[drivewaySize] ?? 0;
    const surfaceMult = pwConfig.surfaceMultipliers[surfaceType] ?? 1;
    pressureWashing = Math.round(drivewayBase * surfaceMult);
    
    if (additionalServices.pressureWashing.frontPorch) pressureWashing += pwConfig.addons.frontPorch ?? 0;
    if (additionalServices.pressureWashing.backPatio) pressureWashing += pwConfig.addons.backPatio ?? 0;
    if (additionalServices.pressureWashing.poolDeck) pressureWashing += pwConfig.addons.poolDeck ?? 0;
    if (additionalServices.pressureWashing.sidewalks) pressureWashing += pwConfig.addons.sidewalks ?? 0;
  }
  
  const total = windowCleaning + houseWash + gutterCleaning + roofCleaning + pressureWashing;
  
  return {
    windowCleaning,
    houseWash,
    gutterCleaning,
    roofCleaning,
    pressureWashing,
    total,
  };
}

interface PriceRowProps {
  label: string;
  price: number;
  enabled?: boolean;
}

function PriceRow({ label, price, enabled = true }: PriceRowProps) {
  return (
    <div className={`flex justify-between items-center py-2 ${!enabled ? 'opacity-50' : ''}`}>
      <span className="text-sm">{label}</span>
      <span className="font-mono font-medium">
        ${price.toLocaleString()}
      </span>
    </div>
  );
}

// Sample scenarios for quick testing
const SAMPLE_SCENARIOS = [
  {
    name: 'Small 1-Story',
    homeDetails: { ...DEFAULT_HOME_DETAILS, squareFootage: 1500, stories: 1 as const },
    services: { ...DEFAULT_ADDITIONAL_SERVICES, gutterCleaning: true, houseWash: true },
  },
  {
    name: 'Medium 2-Story',
    homeDetails: { ...DEFAULT_HOME_DETAILS, squareFootage: 2500, stories: 2 as const },
    services: { ...DEFAULT_ADDITIONAL_SERVICES, gutterCleaning: true, houseWash: true, roofCleaning: true },
  },
  {
    name: 'Large 2-Story (All Services)',
    homeDetails: { ...DEFAULT_HOME_DETAILS, squareFootage: 4000, stories: 2 as const, windowCleaningType: 'both' as const },
    services: { 
      ...DEFAULT_ADDITIONAL_SERVICES, 
      gutterCleaning: true, 
      houseWash: true, 
      roofCleaning: true,
      pressureWashing: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing, enabled: true },
    },
  },
  {
    name: 'Luxury 3-Story',
    homeDetails: { ...DEFAULT_HOME_DETAILS, squareFootage: 6000, stories: 3 as const, windowCleaningType: 'both' as const, condition: 'heavy' as const },
    services: { 
      ...DEFAULT_ADDITIONAL_SERVICES, 
      gutterCleaning: true, 
      houseWash: true, 
      roofCleaning: true,
      roofType: 'tile' as const,
      roofSeverity: 'moderate' as const,
      pressureWashing: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing, enabled: true, drivewaySize: 'large' as const },
    },
  },
];

export function PricingPreview() {
  const { data: pricing, isLoading } = usePricingConfig();
  
  const [homeDetails, setHomeDetails] = useState<HomeDetails>(DEFAULT_HOME_DETAILS);
  const [additionalServices, setAdditionalServices] = useState<AdditionalServices>({
    ...DEFAULT_ADDITIONAL_SERVICES,
    gutterCleaning: true,
    houseWash: true,
    roofCleaning: true,
  });
  
  const prices = useMemo(() => {
    if (!pricing) return null;
    return calculatePrices(homeDetails, additionalServices, pricing);
  }, [homeDetails, additionalServices, pricing]);
  
  // Calculate prices for all sample scenarios
  const scenarioPrices = useMemo(() => {
    if (!pricing) return [];
    return SAMPLE_SCENARIOS.map((scenario) => ({
      ...scenario,
      prices: calculatePrices(scenario.homeDetails, scenario.services, pricing),
    }));
  }, [pricing]);
  
  if (isLoading || !pricing) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading pricing data...
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Quick Scenario Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Sample Quote Comparison
          </CardTitle>
          <CardDescription>
            See how current pricing affects different home sizes and service combinations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {scenarioPrices.map((scenario) => (
              <div key={scenario.name} className="p-4 rounded-lg border bg-card">
                <h4 className="font-semibold text-sm mb-1">{scenario.name}</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  {scenario.homeDetails.squareFootage.toLocaleString()} sq ft • {scenario.homeDetails.stories} story
                </p>
                
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Windows</span>
                    <span>${scenario.prices.windowCleaning}</span>
                  </div>
                  {scenario.services.houseWash && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">House Wash</span>
                      <span>${scenario.prices.houseWash}</span>
                    </div>
                  )}
                  {scenario.services.gutterCleaning && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gutters</span>
                      <span>${scenario.prices.gutterCleaning}</span>
                    </div>
                  )}
                  {scenario.services.roofCleaning && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Roof</span>
                      <span>${scenario.prices.roofCleaning}</span>
                    </div>
                  )}
                  {scenario.services.pressureWashing.enabled && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pressure Wash</span>
                      <span>${scenario.prices.pressureWashing}</span>
                    </div>
                  )}
                </div>
                
                <Separator className="my-3" />
                
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Total</span>
                  <Badge variant="secondary" className="text-base font-mono">
                    ${scenario.prices.total.toLocaleString()}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Custom Quote Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="w-5 h-5" />
            Custom Quote Calculator
          </CardTitle>
          <CardDescription>
            Adjust home details to see exactly how pricing is calculated
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Input Controls */}
            <div className="space-y-6">
              <div className="space-y-4">
                <h4 className="font-semibold text-sm">Home Details</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Square Footage</Label>
                    <Input
                      type="number"
                      value={homeDetails.squareFootage}
                      onChange={(e) => setHomeDetails(prev => ({ 
                        ...prev, 
                        squareFootage: parseInt(e.target.value) || 0 
                      }))}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Stories</Label>
                    <Select
                      value={homeDetails.stories.toString()}
                      onValueChange={(val) => setHomeDetails(prev => ({ 
                        ...prev, 
                        stories: parseInt(val) as 1 | 2 | 3 
                      }))}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border shadow-lg z-50">
                        <SelectItem value="1">1 Story</SelectItem>
                        <SelectItem value="2">2 Stories</SelectItem>
                        <SelectItem value="3">3 Stories</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Window Cleaning</Label>
                    <Select
                      value={homeDetails.windowCleaningType}
                      onValueChange={(val) => setHomeDetails(prev => ({ 
                        ...prev, 
                        windowCleaningType: val as 'exterior' | 'both' 
                      }))}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border shadow-lg z-50">
                        <SelectItem value="exterior">Exterior Only</SelectItem>
                        <SelectItem value="both">Interior + Exterior</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Condition</Label>
                    <Select
                      value={homeDetails.condition}
                      onValueChange={(val) => setHomeDetails(prev => ({ 
                        ...prev, 
                        condition: val as 'maintenance' | 'heavy' 
                      }))}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border shadow-lg z-50">
                        <SelectItem value="maintenance">Maintenance Clean</SelectItem>
                        <SelectItem value="heavy">Heavy Buildup</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div className="space-y-4">
                <h4 className="font-semibold text-sm">Additional Services</h4>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>House Wash</Label>
                    <Switch
                      checked={additionalServices.houseWash}
                      onCheckedChange={(checked) => setAdditionalServices(prev => ({
                        ...prev,
                        houseWash: checked,
                      }))}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label>Gutter Cleaning</Label>
                    <Switch
                      checked={additionalServices.gutterCleaning}
                      onCheckedChange={(checked) => setAdditionalServices(prev => ({
                        ...prev,
                        gutterCleaning: checked,
                      }))}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label>Roof Cleaning</Label>
                    <Switch
                      checked={additionalServices.roofCleaning}
                      onCheckedChange={(checked) => setAdditionalServices(prev => ({
                        ...prev,
                        roofCleaning: checked,
                      }))}
                    />
                  </div>
                  
                  {additionalServices.roofCleaning && (
                    <div className="pl-4 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={additionalServices.roofType}
                          onValueChange={(val) => setAdditionalServices(prev => ({
                            ...prev,
                            roofType: val as 'asphalt' | 'tile' | 'metal' | 'flat',
                          }))}
                        >
                          <SelectTrigger className="bg-background text-xs">
                            <SelectValue placeholder="Roof Type" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border shadow-lg z-50">
                            <SelectItem value="asphalt">Asphalt</SelectItem>
                            <SelectItem value="tile">Tile</SelectItem>
                            <SelectItem value="metal">Metal</SelectItem>
                            <SelectItem value="flat">Flat</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        <Select
                          value={additionalServices.roofSeverity}
                          onValueChange={(val) => setAdditionalServices(prev => ({
                            ...prev,
                            roofSeverity: val as 'light' | 'moderate' | 'heavy',
                          }))}
                        >
                          <SelectTrigger className="bg-background text-xs">
                            <SelectValue placeholder="Severity" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border shadow-lg z-50">
                            <SelectItem value="light">Light</SelectItem>
                            <SelectItem value="moderate">Moderate</SelectItem>
                            <SelectItem value="heavy">Heavy</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <Label>Pressure Washing</Label>
                    <Switch
                      checked={additionalServices.pressureWashing.enabled}
                      onCheckedChange={(checked) => setAdditionalServices(prev => ({
                        ...prev,
                        pressureWashing: { ...prev.pressureWashing, enabled: checked },
                      }))}
                    />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Price Output */}
            <div className="space-y-4">
              <div className="p-6 rounded-lg border-2 border-primary/20 bg-primary/5">
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Calculated Quote
                </h4>
                
                {prices && (
                  <div className="space-y-2">
                    <PriceRow label="Window Cleaning" price={prices.windowCleaning} />
                    <PriceRow 
                      label="House Wash" 
                      price={prices.houseWash} 
                      enabled={additionalServices.houseWash} 
                    />
                    <PriceRow 
                      label="Gutter Cleaning" 
                      price={prices.gutterCleaning} 
                      enabled={additionalServices.gutterCleaning} 
                    />
                    <PriceRow 
                      label="Roof Cleaning" 
                      price={prices.roofCleaning} 
                      enabled={additionalServices.roofCleaning} 
                    />
                    <PriceRow 
                      label="Pressure Washing" 
                      price={prices.pressureWashing} 
                      enabled={additionalServices.pressureWashing.enabled} 
                    />
                    
                    <Separator className="my-3" />
                    
                    <div className="flex justify-between items-center pt-2">
                      <span className="font-bold text-lg">Total</span>
                      <Badge className="text-xl font-mono px-4 py-2">
                        ${prices.total.toLocaleString()}
                      </Badge>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Rate Breakdown */}
              <div className="p-4 rounded-lg border bg-muted/30 text-sm">
                <h5 className="font-medium mb-2">Current Rates Applied:</h5>
                <div className="space-y-1 text-muted-foreground">
                  <p>• Window: ${pricing.window_cleaning.exteriorPerSqFt}/sq ft exterior</p>
                  <p>• House Wash: ${pricing.house_wash.perSqFt}/sq ft</p>
                  <p>• Gutters: ${pricing.gutter_cleaning.perSqFt}/sq ft</p>
                  <p>• Roof: ${pricing.roof_cleaning.perSqFt}/sq ft</p>
                  <p>• Story modifier ({homeDetails.stories}-story): +{pricing.window_cleaning.modifiers.stories[homeDetails.stories.toString()] ?? 0}%</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
