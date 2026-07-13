import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { GitCompare, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { useSavedScenarios, type SavedScenario } from '@/hooks/useSavedScenarios';
import { useServerQuotes, type QuoteRequest } from '@/hooks/useServerQuotes';
import { toQuoteInput } from '@/lib/pricing/toQuoteInput';
import { fromQuoteResult } from '@/lib/pricing/fromQuoteResult';
import type { QuoteResult } from '@/lib/pricing/engine';
import type { HomeDetails, AdditionalServices } from '@/types/homeowner';

// Map an authoritative server quote → the small comparison display shape.
// Window cleaning is always priced here (parity with the legacy admin view).
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

function scenarioInput(homeDetails: HomeDetails, additionalServices: AdditionalServices) {
  return toQuoteInput(homeDetails, { ...additionalServices, windowCleaning: true });
}

interface DiffBadgeProps {
  diff: number;
  showZero?: boolean;
}

function DiffBadge({ diff, showZero = false }: DiffBadgeProps) {
  if (diff === 0 && !showZero) {
    return <Minus className="w-4 h-4 text-muted-foreground" />;
  }
  
  if (diff > 0) {
    return (
      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30 gap-1">
        <TrendingUp className="w-3 h-3" />
        +${diff.toLocaleString()}
      </Badge>
    );
  }
  
  return (
    <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 gap-1">
      <TrendingDown className="w-3 h-3" />
      -${Math.abs(diff).toLocaleString()}
    </Badge>
  );
}

interface CompareRowProps {
  label: string;
  priceA: number;
  priceB: number;
  enabledA?: boolean;
  enabledB?: boolean;
}

function CompareRow({ label, priceA, priceB, enabledA = true, enabledB = true }: CompareRowProps) {
  const diff = priceB - priceA;
  const bothDisabled = !enabledA && !enabledB;
  
  return (
    <div className={`grid grid-cols-4 gap-4 py-2 items-center ${bothDisabled ? 'opacity-40' : ''}`}>
      <span className="text-sm font-medium">{label}</span>
      <span className={`font-mono text-right ${!enabledA ? 'text-muted-foreground' : ''}`}>
        {enabledA ? `$${priceA.toLocaleString()}` : '—'}
      </span>
      <span className={`font-mono text-right ${!enabledB ? 'text-muted-foreground' : ''}`}>
        {enabledB ? `$${priceB.toLocaleString()}` : '—'}
      </span>
      <div className="flex justify-center">
        {enabledA && enabledB ? (
          <DiffBadge diff={diff} />
        ) : (
          <span className="text-xs text-muted-foreground">n/a</span>
        )}
      </div>
    </div>
  );
}

interface ScenarioDetailsProps {
  scenario: SavedScenario;
}

function ScenarioDetails({ scenario }: ScenarioDetailsProps) {
  const details = scenario.home_details;
  const services = scenario.additional_services;
  
  return (
    <div className="text-xs text-muted-foreground space-y-1">
      <p>
        {details.squareFootage.toLocaleString()} sqft • {details.stories} story • 
        {details.windowCleaningType === 'both' ? ' In+Out' : ' Ext only'}
      </p>
      <p>
        Services: {[
          services.houseWash && 'House',
          services.gutterCleaning && 'Gutters',
          services.roofCleaning && 'Roof',
          services.pressureWashing?.enabled && 'Pressure'
        ].filter(Boolean).join(', ') || 'Windows only'}
      </p>
    </div>
  );
}

export function ScenarioCompare() {
  const { data: pricing, isLoading: pricingLoading } = usePricingConfig();
  const { data: savedScenarios = [], isLoading: scenariosLoading } = useSavedScenarios();
  
  const [scenarioAId, setScenarioAId] = useState<string>('');
  const [scenarioBId, setScenarioBId] = useState<string>('');
  
  const scenarioA = savedScenarios.find(s => s.id === scenarioAId);
  const scenarioB = savedScenarios.find(s => s.id === scenarioBId);
  
  const pricesA = useMemo(() => {
    if (!pricing || !scenarioA) return null;
    return calculatePrices(scenarioA.home_details, scenarioA.additional_services, pricing);
  }, [pricing, scenarioA]);
  
  const pricesB = useMemo(() => {
    if (!pricing || !scenarioB) return null;
    return calculatePrices(scenarioB.home_details, scenarioB.additional_services, pricing);
  }, [pricing, scenarioB]);
  
  const isLoading = pricingLoading || scenariosLoading;
  
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading...
        </CardContent>
      </Card>
    );
  }
  
  if (savedScenarios.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="w-5 h-5" />
            Compare Scenarios
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-dashed">
            <AlertCircle className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Not enough scenarios to compare</p>
              <p className="text-sm text-muted-foreground">
                Save at least 2 scenarios from the Quote Preview tab to use the compare feature.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompare className="w-5 h-5" />
          Compare Scenarios
        </CardTitle>
        <CardDescription>
          Select two saved scenarios to view them side-by-side with price differences highlighted
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Scenario Selectors */}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Scenario A</label>
            <Select value={scenarioAId} onValueChange={setScenarioAId}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select first scenario" />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg z-50">
                {savedScenarios.map((scenario) => (
                  <SelectItem 
                    key={scenario.id} 
                    value={scenario.id}
                    disabled={scenario.id === scenarioBId}
                  >
                    {scenario.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scenarioA && <ScenarioDetails scenario={scenarioA} />}
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Scenario B</label>
            <Select value={scenarioBId} onValueChange={setScenarioBId}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select second scenario" />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-lg z-50">
                {savedScenarios.map((scenario) => (
                  <SelectItem 
                    key={scenario.id} 
                    value={scenario.id}
                    disabled={scenario.id === scenarioAId}
                  >
                    {scenario.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scenarioB && <ScenarioDetails scenario={scenarioB} />}
          </div>
        </div>
        
        {/* Comparison Table */}
        {pricesA && pricesB && scenarioA && scenarioB && (
          <div className="rounded-lg border overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-4 gap-4 px-4 py-3 bg-muted/50 border-b font-medium text-sm">
              <span>Service</span>
              <span className="text-right">{scenarioA.name}</span>
              <span className="text-right">{scenarioB.name}</span>
              <span className="text-center">Difference</span>
            </div>
            
            {/* Rows */}
            <div className="px-4 divide-y">
              <CompareRow 
                label="Window Cleaning" 
                priceA={pricesA.windowCleaning} 
                priceB={pricesB.windowCleaning}
              />
              <CompareRow 
                label="House Wash" 
                priceA={pricesA.houseWash} 
                priceB={pricesB.houseWash}
                enabledA={scenarioA.additional_services.houseWash}
                enabledB={scenarioB.additional_services.houseWash}
              />
              <CompareRow 
                label="Gutter Cleaning" 
                priceA={pricesA.gutterCleaning} 
                priceB={pricesB.gutterCleaning}
                enabledA={scenarioA.additional_services.gutterCleaning}
                enabledB={scenarioB.additional_services.gutterCleaning}
              />
              <CompareRow 
                label="Roof Cleaning" 
                priceA={pricesA.roofCleaning} 
                priceB={pricesB.roofCleaning}
                enabledA={scenarioA.additional_services.roofCleaning}
                enabledB={scenarioB.additional_services.roofCleaning}
              />
              <CompareRow 
                label="Pressure Washing" 
                priceA={pricesA.pressureWashing} 
                priceB={pricesB.pressureWashing}
                enabledA={scenarioA.additional_services.pressureWashing?.enabled}
                enabledB={scenarioB.additional_services.pressureWashing?.enabled}
              />
            </div>
            
            {/* Total Row */}
            <div className="grid grid-cols-4 gap-4 px-4 py-3 bg-primary/5 border-t-2 border-primary/20 font-bold">
              <span>Total</span>
              <span className="text-right font-mono">${pricesA.total.toLocaleString()}</span>
              <span className="text-right font-mono">${pricesB.total.toLocaleString()}</span>
              <div className="flex justify-center">
                <DiffBadge diff={pricesB.total - pricesA.total} showZero />
              </div>
            </div>
          </div>
        )}
        
        {/* Prompt to select */}
        {(!scenarioAId || !scenarioBId) && (
          <div className="text-center py-8 text-muted-foreground">
            <GitCompare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Select two scenarios above to compare prices</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
