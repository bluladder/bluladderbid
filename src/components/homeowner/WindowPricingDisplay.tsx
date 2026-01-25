import { Sparkles } from 'lucide-react';
import type { ServicePrices } from '@/types/homeowner';

interface WindowPricingDisplayProps {
  servicePrices: ServicePrices;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function WindowPricingDisplay({ servicePrices }: WindowPricingDisplayProps) {
  if (servicePrices.windowCleaningTotal === 0) return null;
  
  return (
    <div className="card-gradient p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="font-semibold">Window Cleaning Quote</span>
        </div>
        <span className="price-display text-2xl text-primary">
          {formatPrice(servicePrices.windowCleaningTotal)}
        </span>
      </div>
      
      <div className="space-y-1 text-sm text-muted-foreground">
        {servicePrices.exteriorWindows > 0 && (
          <div className="flex justify-between">
            <span>Exterior windows</span>
            <span>{formatPrice(servicePrices.exteriorWindows)}</span>
          </div>
        )}
        {servicePrices.interiorWindows > 0 && (
          <div className="flex justify-between">
            <span>Interior windows</span>
            <span>{formatPrice(servicePrices.interiorWindows)}</span>
          </div>
        )}
        {servicePrices.hardWaterAddon > 0 && (
          <div className="flex justify-between">
            <span>Hard water treatment</span>
            <span>+{formatPrice(servicePrices.hardWaterAddon)}</span>
          </div>
        )}
        {servicePrices.frenchPanesAddon > 0 && (
          <div className="flex justify-between">
            <span>French panes</span>
            <span>+{formatPrice(servicePrices.frenchPanesAddon)}</span>
          </div>
        )}
        {servicePrices.solarScreensAddon > 0 && (
          <div className="flex justify-between">
            <span>Solar screen removal</span>
            <span>+{formatPrice(servicePrices.solarScreensAddon)}</span>
          </div>
        )}
        {servicePrices.ladderWorkAddon > 0 && (
          <div className="flex justify-between">
            <span>Interior ladder work</span>
            <span>+{formatPrice(servicePrices.ladderWorkAddon)}</span>
          </div>
        )}
        {servicePrices.sunroomAddon > 0 && (
          <div className="flex justify-between">
            <span>Sunroom</span>
            <span>+{formatPrice(servicePrices.sunroomAddon)}</span>
          </div>
        )}
      </div>
      
      <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
        This is your per-visit price. Choose a package below to see annual pricing.
      </p>
    </div>
  );
}
