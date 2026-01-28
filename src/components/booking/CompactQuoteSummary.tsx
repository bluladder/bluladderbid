import { useState } from 'react';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ServicePrices, AdditionalServices } from '@/types/homeowner';
import type { ValidatedDiscount } from '@/hooks/useDiscountCodes';

interface CompactQuoteSummaryProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  appliedDiscount?: ValidatedDiscount | null;
  discountAmount?: number;
  /** When true, shows as a minimal inline bar. When false, shows expandable detail. */
  minimal?: boolean;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function CompactQuoteSummary({
  servicePrices,
  additionalServices,
  appliedDiscount,
  discountAmount = 0,
  minimal = false,
}: CompactQuoteSummaryProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const subtotal = servicePrices.grandTotal;
  const finalTotal = subtotal - discountAmount;
  
  // Count services for summary
  const serviceCount = [
    additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0,
    additionalServices.houseWash && servicePrices.houseWash > 0,
    additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0,
    additionalServices.roofCleaning && servicePrices.roofCleaning > 0,
    additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0,
    additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0,
  ].filter(Boolean).length;

  // Minimal mode: just a compact bar
  if (minimal) {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-muted/50 border border-border">
        <span className="text-sm text-muted-foreground">
          {serviceCount} service{serviceCount !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          {appliedDiscount && discountAmount > 0 && (
            <span className="text-xs text-green-600 font-medium">
              -{formatPrice(discountAmount)}
            </span>
          )}
          <span className="font-bold text-foreground">
            {formatPrice(finalTotal)}
          </span>
        </div>
      </div>
    );
  }

  // Collapsible mode with details
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted/50 border border-border hover:bg-muted/70 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Your Quote
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {serviceCount} service{serviceCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {appliedDiscount && discountAmount > 0 && (
              <>
                <span className="line-through text-muted-foreground text-sm">
                  {formatPrice(subtotal)}
                </span>
              </>
            )}
            <span className="text-lg font-bold text-foreground">
              {formatPrice(finalTotal)}
            </span>
            {isOpen ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="mt-2 px-4 py-3 rounded-lg border border-border bg-card space-y-2 text-sm">
          {additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0 && (
            <div className="flex justify-between">
              <span className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-success" />
                Window Cleaning
              </span>
              <span className="font-medium">{formatPrice(servicePrices.windowCleaningTotal)}</span>
            </div>
          )}
          {additionalServices.houseWash && servicePrices.houseWash > 0 && (
            <div className="flex justify-between">
              <span className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-success" />
                House Wash
              </span>
              <span className="font-medium">{formatPrice(servicePrices.houseWash)}</span>
            </div>
          )}
          {additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0 && (
            <div className="flex justify-between">
              <span className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-success" />
                Gutter Cleaning
              </span>
              <span className="font-medium">{formatPrice(servicePrices.gutterCleaning)}</span>
            </div>
          )}
          {additionalServices.roofCleaning && servicePrices.roofCleaning > 0 && (
            <div className="flex justify-between">
              <span className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-success" />
                Roof Cleaning
              </span>
              <span className="font-medium">{formatPrice(servicePrices.roofCleaning)}</span>
            </div>
          )}
          {additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0 && (
            <div className="flex justify-between">
              <span className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-success" />
                Driveway Cleaning
              </span>
              <span className="font-medium">{formatPrice(servicePrices.drivewayCleaning)}</span>
            </div>
          )}
          {additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0 && (
            <div className="flex justify-between">
              <span className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-success" />
                Pressure Washing
              </span>
              <span className="font-medium">{formatPrice(servicePrices.pressureWashing)}</span>
            </div>
          )}
          
          {appliedDiscount && discountAmount > 0 && (
            <div className="flex justify-between pt-2 border-t border-border text-green-600">
              <span>Discount ({appliedDiscount.code})</span>
              <span className="font-medium">-{formatPrice(discountAmount)}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
