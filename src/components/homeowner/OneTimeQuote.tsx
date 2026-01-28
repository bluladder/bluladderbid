import { Calendar, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { ServicePrices, AdditionalServices } from '@/types/homeowner';

interface OneTimeQuoteProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  isSelected: boolean;
  onSelect: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

interface ServiceLineProps {
  label: string;
  price: number;
  enabled: boolean;
  isAddon?: boolean;
}

function ServiceLine({ label, price, enabled, isAddon = false }: ServiceLineProps) {
  if (!enabled || price === 0) return null;
  
  return (
    <div className={`flex justify-between items-center py-2 ${isAddon ? 'pl-4 text-muted-foreground text-sm' : ''}`}>
      <span className="flex items-center gap-2">
        {!isAddon && <Check className="w-4 h-4 text-success" />}
        {isAddon && <span className="text-xs">•</span>}
        {label}
      </span>
      <span className={`font-mono ${isAddon ? '' : 'font-medium'}`}>
        {isAddon ? '+' : ''}{formatPrice(price)}
      </span>
    </div>
  );
}

export function OneTimeQuote({ 
  servicePrices, 
  additionalServices,
  isSelected,
  onSelect 
}: OneTimeQuoteProps) {
  const hasServices = servicePrices.grandTotal > 0;
  const hasWindowsOnly = servicePrices.windowCleaningTotal > 0 && servicePrices.additionalServicesTotal === 0;
  
  // Count enabled services
  const enabledServices = [
    servicePrices.windowCleaningTotal > 0,
    additionalServices.houseWash,
    additionalServices.gutterCleaning,
    additionalServices.roofCleaning,
    additionalServices.pressureWashing.enabled,
  ].filter(Boolean).length;
  
  return (
    <Card className={`relative overflow-hidden transition-all duration-200 ${
      isSelected 
        ? 'card-selected scale-[1.02]' 
        : 'card-secondary-option'
    }`}>
      <CardHeader className="pt-5 pb-2">
        <CardTitle className="text-center">
          <span className="text-xs text-muted-foreground block mb-1 uppercase tracking-wide">Single Visit</span>
          <span className="text-base font-semibold">One-Time Service</span>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Real-time price display */}
        <div className="text-center py-3 rounded-lg bg-muted/30">
          <div className="text-2xl font-bold price-display text-foreground">
            {hasServices ? formatPrice(servicePrices.grandTotal) : '$0'}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {hasServices 
              ? `${enabledServices} service${enabledServices !== 1 ? 's' : ''} selected`
              : 'Configure services above'
            }
          </div>
        </div>
        
        {/* Service breakdown */}
        {hasServices && (
          <div className="space-y-1 divide-y divide-border/50">
            <ServiceLine 
              label="Window Cleaning" 
              price={servicePrices.windowCleaningTotal} 
              enabled={servicePrices.windowCleaningTotal > 0} 
            />
            
            {/* Window addons */}
            {servicePrices.hardWaterAddon > 0 && (
              <ServiceLine label="Hard water treatment" price={servicePrices.hardWaterAddon} enabled isAddon />
            )}
            {servicePrices.frenchPanesAddon > 0 && (
              <ServiceLine label="French panes" price={servicePrices.frenchPanesAddon} enabled isAddon />
            )}
            {servicePrices.solarScreensAddon > 0 && (
              <ServiceLine label="Solar screens" price={servicePrices.solarScreensAddon} enabled isAddon />
            )}
            
            <ServiceLine 
              label="House Wash" 
              price={servicePrices.houseWash} 
              enabled={additionalServices.houseWash} 
            />
            
            <ServiceLine 
              label="Gutter Cleaning" 
              price={servicePrices.gutterCleaning} 
              enabled={additionalServices.gutterCleaning} 
            />
            
            <ServiceLine 
              label="Roof Cleaning" 
              price={servicePrices.roofCleaning} 
              enabled={additionalServices.roofCleaning} 
            />
            
            <ServiceLine 
              label="Driveway Cleaning" 
              price={servicePrices.drivewayCleaning} 
              enabled={additionalServices.drivewayCleaning.enabled} 
            />
            
            <ServiceLine 
              label="Pressure Washing" 
              price={servicePrices.pressureWashing} 
              enabled={additionalServices.pressureWashing.enabled} 
            />
          </div>
        )}
        
        {!hasServices && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <p>Enter your home details above to see pricing</p>
          </div>
        )}
        
        <Separator />
        
        {/* Compact Benefits */}
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-1.5">
            <Check className="w-3 h-3 text-success flex-shrink-0" />
            <span>No commitment</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className="w-3 h-3 text-success flex-shrink-0" />
            <span>Perfect for one-time deep cleans</span>
          </div>
        </div>
        
        <Button
          className="w-full h-14 text-lg font-bold shadow-lg"
          onClick={onSelect}
          disabled={!hasServices}
        >
          {isSelected ? (
            <>
              <Check className="w-5 h-5 mr-2" />
              Selected — Continue
            </>
          ) : (
            <>
              <Calendar className="w-5 h-5 mr-2" />
              Book One-Time Service
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
