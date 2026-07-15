import { Sparkles, TrendingUp } from 'lucide-react';
import type { ServicePrices, AdditionalServices } from '@/types/homeowner';

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

interface LiveQuoteBarProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  discountAmount?: number;
  bundleSavings?: number;
}

/**
 * Sticky live quote summary — always shows current services and current total.
 * Celebrates bundle savings when present; otherwise gently encourages adding
 * another service (never invents a discount).
 */
export function LiveQuoteBar({
  servicePrices,
  additionalServices,
  discountAmount = 0,
  bundleSavings = 0,
}: LiveQuoteBarProps) {
  const total = Math.max(0, servicePrices.grandTotal - discountAmount);

  const selectedCount = [
    additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0,
    additionalServices.houseWash && servicePrices.houseWash > 0,
    additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0,
    additionalServices.roofCleaning && servicePrices.roofCleaning > 0,
    additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0,
    additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0,
    additionalServices.solarPanelCleaning.enabled && servicePrices.solarPanelCleaning > 0,
    additionalServices.screenRepair.enabled && servicePrices.screenRepair > 0,
  ].filter(Boolean).length;

  return (
    <div className="sticky top-2 z-10 rounded-xl border border-primary/25 bg-background/95 backdrop-blur shadow-sm px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Your quote
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {selectedCount} service{selectedCount === 1 ? '' : 's'} selected
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
          <p className="text-lg font-bold text-primary price-display leading-none">
            {formatPrice(total)}
          </p>
        </div>
      </div>

      {bundleSavings > 0 ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-success font-medium">
          <Sparkles className="w-3.5 h-3.5" />
          Great choice — you&apos;ve unlocked {formatPrice(bundleSavings)} in bundle savings.
        </div>
      ) : selectedCount < 3 ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <TrendingUp className="w-3.5 h-3.5 text-primary/70" />
          Add another service below — one visit, one crew.
        </div>
      ) : null}
    </div>
  );
}
