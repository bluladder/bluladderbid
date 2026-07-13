import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Calculator, Home, TrendingUp, TrendingDown, Minus, Save, FolderOpen, Trash2, ChevronDown } from 'lucide-react';
import type { HomeDetails, AdditionalServices } from '@/types/homeowner';
import { DEFAULT_HOME_DETAILS, DEFAULT_ADDITIONAL_SERVICES } from '@/types/homeowner';
import { usePricingConfig, type PricingData } from '@/hooks/usePricingConfig';
import { useSavedScenarios, useCreateScenario, useDeleteScenario, type SavedScenario } from '@/hooks/useSavedScenarios';
import { useServerQuoteCalculation } from '@/hooks/useServerQuoteCalculation';
import { useServerQuotes, type QuoteRequest } from '@/hooks/useServerQuotes';
import { toQuoteInput } from '@/lib/pricing/toQuoteInput';
import { fromQuoteResult } from '@/lib/pricing/fromQuoteResult';
import type { QuoteResult } from '@/lib/pricing/engine';

// The admin preview always prices exterior window cleaning (there is no window
// toggle here), so window cleaning is forced on when building the server input.
function previewInput(homeDetails: HomeDetails, additionalServices: AdditionalServices) {
  return toQuoteInput(homeDetails, { ...additionalServices, windowCleaning: true });
}

/** Map an authoritative server quote → the small display shape this UI needs. */
function displayPrices(quote: QuoteResult | null) {
  const sp = fromQuoteResult(quote);
  return {
    windowCleaning: sp.windowCleaningTotal,
    houseWash: sp.houseWashTotal,
    gutterCleaning: sp.gutterCleaningTotal,
    roofCleaning: sp.roofCleaning,
    drivewayCleaning: sp.drivewayCleaning,
    pressureWashing: sp.pressureWashing,
    total: quote?.total ?? 0,
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
  const { data: savedScenarios = [], isLoading: scenariosLoading } = useSavedScenarios();
  const createScenario = useCreateScenario();
  const deleteScenario = useDeleteScenario();
  
  // In the admin preview we want a blank sqft field (no preset), so admins can type an exact number easily.
  const [homeDetails, setHomeDetails] = useState<HomeDetails>({
    ...DEFAULT_HOME_DETAILS,
    squareFootage: 0,
  });
  const [additionalServices, setAdditionalServices] = useState<AdditionalServices>({
    ...DEFAULT_ADDITIONAL_SERVICES,
    gutterCleaning: true,
    houseWash: true,
    roofCleaning: true,
  });
  
  // Save scenario dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDescription, setScenarioDescription] = useState('');
  
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
  
  const handleSaveScenario = () => {
    if (!scenarioName.trim()) return;
    
    createScenario.mutate({
      name: scenarioName.trim(),
      description: scenarioDescription.trim() || undefined,
      homeDetails,
      additionalServices,
    }, {
      onSuccess: () => {
        setSaveDialogOpen(false);
        setScenarioName('');
        setScenarioDescription('');
      }
    });
  };
  
  const handleLoadScenario = (scenario: SavedScenario) => {
    setHomeDetails(scenario.home_details);
    setAdditionalServices(scenario.additional_services);
  };
  
  const handleDeleteScenario = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this scenario?')) {
      deleteScenario.mutate(id);
    }
  };
  
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
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Home className="w-5 h-5" />
                Custom Quote Calculator
              </CardTitle>
              <CardDescription>
                Adjust home details to see exactly how pricing is calculated
              </CardDescription>
            </div>
            
            {/* Scenario Actions */}
            <div className="flex gap-2">
              {/* Load Scenario Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={scenariosLoading || savedScenarios.length === 0}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Load
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 bg-background">
                  {savedScenarios.length === 0 ? (
                    <DropdownMenuItem disabled>No saved scenarios</DropdownMenuItem>
                  ) : (
                    savedScenarios.map((scenario) => (
                      <DropdownMenuItem
                        key={scenario.id}
                        onClick={() => handleLoadScenario(scenario)}
                        className="flex items-center justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{scenario.name}</div>
                          {scenario.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {scenario.description}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 ml-2 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteScenario(scenario.id, e)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </DropdownMenuItem>
                    ))
                  )}
                  {savedScenarios.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                        {savedScenarios.length} saved scenario{savedScenarios.length !== 1 ? 's' : ''}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* Save Scenario Dialog */}
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Save className="w-4 h-4 mr-2" />
                    Save
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save Scenario</DialogTitle>
                    <DialogDescription>
                      Save the current home details and service selections for quick access later.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="scenario-name">Scenario Name</Label>
                      <Input
                        id="scenario-name"
                        placeholder="e.g. Typical 2-Story Home"
                        value={scenarioName}
                        onChange={(e) => setScenarioName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="scenario-desc">Description (optional)</Label>
                      <Input
                        id="scenario-desc"
                        placeholder="e.g. 3,000 sqft with all services"
                        value={scenarioDescription}
                        onChange={(e) => setScenarioDescription(e.target.value)}
                      />
                    </div>
                    <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                      <strong>Current config:</strong>
                      <ul className="mt-1 space-y-1">
                        <li>• {homeDetails.squareFootage.toLocaleString()} sqft, {homeDetails.stories} story</li>
                        <li>• Window cleaning: {homeDetails.windowCleaningType === 'both' ? 'Interior + Exterior' : 'Exterior only'}</li>
                        <li>• Services: {[
                          additionalServices.houseWash && 'House Wash',
                          additionalServices.gutterCleaning && 'Gutters',
                          additionalServices.roofCleaning && 'Roof',
                          additionalServices.pressureWashing.enabled && 'Pressure Washing'
                        ].filter(Boolean).join(', ') || 'None'}
                        </li>
                      </ul>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleSaveScenario} 
                      disabled={!scenarioName.trim() || createScenario.isPending}
                    >
                      {createScenario.isPending ? 'Saving...' : 'Save Scenario'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
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
                      value={homeDetails.squareFootage === 0 ? '' : homeDetails.squareFootage}
                      onChange={(e) => {
                        const value = e.target.value;
                        setHomeDetails(prev => ({ 
                          ...prev, 
                          squareFootage: value === '' ? 0 : parseInt(value, 10)
                        }));
                      }}
                      placeholder="e.g. 3200"
                      step={1}
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
