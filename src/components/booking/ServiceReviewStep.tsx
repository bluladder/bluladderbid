import { Check, Clock, Home, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { ServicePrices, AdditionalServices, HomeDetails } from '@/types/homeowner';
import type { ValidatedDiscount } from '@/hooks/useDiscountCodes';

interface ServiceReviewStepProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  homeDetails: HomeDetails;
  appliedDiscount?: ValidatedDiscount | null;
  discountAmount: number;
  estimatedDuration: number;
  onProceed: () => void;
  onBack: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

interface ServiceLineItemProps {
  name: string;
  price: number;
  details?: string;
}

function ServiceLineItem({ name, price, details }: ServiceLineItemProps) {
  return (
    <div className="flex justify-between items-start py-2">
      <div className="flex items-start gap-2">
        <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium text-sm">{name}</span>
          {details && (
            <p className="text-xs text-muted-foreground">{details}</p>
          )}
        </div>
      </div>
      <span className="font-medium text-sm">{formatPrice(price)}</span>
    </div>
  );
}

export function ServiceReviewStep({
  servicePrices,
  additionalServices,
  homeDetails,
  appliedDiscount,
  discountAmount,
  estimatedDuration,
  onProceed,
  onBack,
}: ServiceReviewStepProps) {
  const subtotal = servicePrices.grandTotal;
  const finalTotal = subtotal - discountAmount;
  
  // Count services
  const serviceCount = [
    additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0,
    additionalServices.houseWash && servicePrices.houseWash > 0,
    additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0,
    additionalServices.roofCleaning && servicePrices.roofCleaning > 0,
    additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0,
    additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0,
  ].filter(Boolean).length;
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center pb-2">
        <h3 className="text-lg font-semibold text-foreground">Review Your Services</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Confirm everything looks correct before scheduling
        </p>
      </div>
      
      {/* Property Summary */}
      <Card className="bg-muted/30 border-muted">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 text-sm">
            <Home className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Property:</span>
            <span className="font-medium">
              {homeDetails.squareFootage.toLocaleString()} sq ft • {homeDetails.stories} {homeDetails.stories === 1 ? 'story' : 'stories'}
            </span>
          </div>
        </CardContent>
      </Card>
      
      {/* Services List */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
              Selected Services ({serviceCount})
            </h4>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>~{formatDuration(estimatedDuration)}</span>
            </div>
          </div>
          
          <div className="divide-y divide-border/50">
            {/* Window Cleaning */}
            {additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0 && (
              <div className="py-2">
                <div className="flex justify-between items-start">
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-sm">Window Cleaning</span>
                      <p className="text-xs text-muted-foreground">
                        {homeDetails.windowCleaningType === 'both' ? 'Interior & Exterior' : 'Exterior Only'}
                        {homeDetails.condition === 'heavy' ? ' • Deep Clean' : ''}
                      </p>
                    </div>
                  </div>
                  <span className="font-medium text-sm">{formatPrice(servicePrices.windowCleaningTotal)}</span>
                </div>
                
                {/* Window add-ons */}
                <div className="pl-6 mt-1 space-y-0.5">
                  {servicePrices.hardWaterAddon > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>+ Hard water treatment</span>
                      <span>{formatPrice(servicePrices.hardWaterAddon)}</span>
                    </div>
                  )}
                  {servicePrices.frenchPanesAddon > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>+ French panes</span>
                      <span>{formatPrice(servicePrices.frenchPanesAddon)}</span>
                    </div>
                  )}
                  {servicePrices.solarScreensAddon > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>+ Solar screen removal</span>
                      <span>{formatPrice(servicePrices.solarScreensAddon)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* House Wash */}
            {additionalServices.houseWash && servicePrices.houseWash > 0 && (
              <ServiceLineItem 
                name="House Wash" 
                price={servicePrices.houseWash}
                details={`${homeDetails.squareFootage.toLocaleString()} sq ft exterior`}
              />
            )}
            
            {/* Gutter Cleaning */}
            {additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0 && (
              <ServiceLineItem 
                name="Gutter Cleaning" 
                price={servicePrices.gutterCleaning}
              />
            )}
            
            {/* Roof Cleaning */}
            {additionalServices.roofCleaning && servicePrices.roofCleaning > 0 && (
              <ServiceLineItem 
                name="Roof Cleaning" 
                price={servicePrices.roofCleaning}
                details={`${additionalServices.roofType || 'Asphalt'} roof`}
              />
            )}
            
            {/* Driveway */}
            {additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0 && (
              <ServiceLineItem 
                name="Driveway Cleaning" 
                price={servicePrices.drivewayCleaning}
                details={`${additionalServices.drivewayCleaning.sqft.toLocaleString()} sq ft`}
              />
            )}
            
            {/* Pressure Washing */}
            {additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0 && (
              <ServiceLineItem 
                name="Pressure Washing" 
                price={servicePrices.pressureWashing}
                details={[
                  additionalServices.pressureWashing.frontPorch.enabled && 'Front porch',
                  additionalServices.pressureWashing.backPatio.enabled && 'Back patio',
                  additionalServices.pressureWashing.poolDeck.enabled && 'Pool deck',
                  additionalServices.pressureWashing.walkways.enabled && 'Walkways',
                ].filter(Boolean).join(', ')}
              />
            )}
          </div>
          
          <Separator className="my-3" />
          
          {/* Totals */}
          <div className="space-y-1.5">
            {appliedDiscount && (
              <>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-success">
                  <span>Discount ({appliedDiscount.code})</span>
                  <span>-{formatPrice(discountAmount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center pt-1">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-bold price-display text-primary">
                {formatPrice(finalTotal)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Notice */}
      <p className="text-xs text-center text-muted-foreground px-4">
        Prices based on information provided. Final pricing may adjust if on-site conditions differ.
      </p>
      
      {/* Actions */}
      <div className="space-y-2 pt-2">
        <Button 
          onClick={onProceed}
          className="w-full h-11 text-base font-semibold"
          size="lg"
        >
          Proceed to Schedule
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        
        <Button 
          variant="ghost" 
          onClick={onBack}
          className="w-full text-muted-foreground h-9 text-sm"
        >
          Edit Services
        </Button>
      </div>
    </div>
  );
}
