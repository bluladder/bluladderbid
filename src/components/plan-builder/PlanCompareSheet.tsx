import { Check, X, Star, Zap, Calendar, Clock } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PlanTier } from './TierSelector';

interface PlanCompareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTier: (tier: PlanTier) => void;
  tierPrices: Record<PlanTier, { monthly: number; annual: number; savings: number }>;
  hasHomeDetails: boolean;
}

const COMPARISON_DATA = [
  {
    label: 'Exterior Windows',
    good: '2x/yr',
    better: '3x/yr',
    best: '4x/yr',
  },
  {
    label: 'Interior Windows',
    good: null,
    better: '1x/yr',
    best: '2x/yr',
  },
  {
    label: 'Gutter Cleaning',
    good: '1x/yr',
    better: '2x/yr',
    best: '2x/yr',
  },
  {
    label: 'House Wash',
    good: null,
    better: '1x/yr',
    best: '1x/yr',
  },
  {
    label: 'Roof Cleaning',
    good: null,
    better: null,
    best: '1x/yr',
  },
  {
    label: 'Priority Scheduling',
    good: null,
    better: 'Available',
    best: 'Priority',
  },
];

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function PlanCompareSheet({
  open,
  onOpenChange,
  onSelectTier,
  tierPrices,
  hasHomeDetails,
}: PlanCompareSheetProps) {
  const handleSelect = (tier: PlanTier) => {
    onSelectTier(tier);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
        <SheetHeader className="text-center pb-4">
          <SheetTitle className="text-xl font-bold">Compare Plans</SheetTitle>
          <SheetDescription>
            See what's included in each plan at a glance
          </SheetDescription>
        </SheetHeader>

        <div className="overflow-auto max-h-[calc(85vh-140px)] pb-6">
          {/* Plan Headers */}
          <div className="grid grid-cols-3 gap-3 mb-4 sticky top-0 bg-background py-2 z-10">
            {(['good', 'better', 'best'] as const).map(tier => (
              <div
                key={tier}
                className={`text-center p-3 rounded-xl ${
                  tier === 'better'
                    ? 'bg-primary/10 ring-2 ring-primary/30'
                    : 'bg-muted/50'
                }`}
              >
                <div className="flex flex-col items-center gap-1">
                  {tier === 'better' && (
                    <Badge className="bg-primary text-primary-foreground text-[10px] mb-1">
                      <Star className="w-2.5 h-2.5 mr-0.5" />
                      Recommended
                    </Badge>
                  )}
                  <span className={`font-bold capitalize ${
                    tier === 'better' ? 'text-primary' : 'text-foreground'
                  }`}>
                    {tier}
                  </span>
                  {hasHomeDetails && (
                    <span className={`text-lg font-bold ${
                      tier === 'better' ? 'text-primary' : 'text-foreground'
                    }`}>
                      {formatPrice(tierPrices[tier].monthly)}/mo
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Comparison Rows */}
          <div className="space-y-2">
            {COMPARISON_DATA.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-3 gap-3 py-3 border-b border-border/50 items-center"
              >
                {(['good', 'better', 'best'] as const).map(tier => {
                  const value = row[tier];
                  const isFirst = tier === 'good';
                  
                  return (
                    <div
                      key={tier}
                      className={`text-center ${tier === 'better' ? 'font-medium' : ''}`}
                    >
                      {isFirst && (
                        <p className="text-xs text-muted-foreground mb-1 font-medium">
                          {row.label}
                        </p>
                      )}
                      {value ? (
                        <span className={`text-sm ${
                          tier === 'better' ? 'text-primary' : 'text-foreground'
                        }`}>
                          {value}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Benefits Summary */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>All plans include flexible scheduling</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>48-hour reschedule policy on all plans</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Zap className="w-4 h-4" />
              <span>Better & Best include priority booking windows</span>
            </div>
          </div>

          {/* Select Buttons */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => handleSelect('good')}
              className="w-full"
            >
              Select Good
            </Button>
            <Button
              onClick={() => handleSelect('better')}
              className="w-full"
            >
              Select Better
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSelect('best')}
              className="w-full"
            >
              Select Best
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
