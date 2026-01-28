import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Clock, Star, TrendingUp, Calendar, MapPin, User, Sparkles, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { RecommendedSlot } from '@/hooks/useSmartAvailability';

interface RecommendedSlotsProps {
  slots: RecommendedSlot[];
  isLoading: boolean;
  selectedSlot: RecommendedSlot | null;
  onSelectSlot: (slot: RecommendedSlot) => void;
  onPickDayInstead: () => void;
}

// Maximum number of recommended slots to show
const MAX_RECOMMENDED_SLOTS = 3;

const whyLabels: Record<string, { label: string; icon: typeof Star; color: string }> = {
  soonest_available: {
    label: 'Soonest',
    icon: Clock,
    color: 'text-green-600',
  },
  minimizes_gaps: {
    label: 'Best Fit',
    icon: TrendingUp,
    color: 'text-blue-600',
  },
  alternative: {
    label: 'Option',
    icon: Calendar,
    color: 'text-muted-foreground',
  },
};

export function RecommendedSlots({
  slots,
  isLoading,
  selectedSlot,
  onSelectSlot,
  onPickDayInstead,
}: RecommendedSlotsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary animate-pulse" />
            Finding the best times for you...
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (slots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Availability Found</CardTitle>
          <CardDescription>
            We couldn't find any available times in the next 30 days. 
            Please try a different preference or contact us directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onPickDayInstead}>
            <Calendar className="w-4 h-4 mr-2" />
            Browse Calendar
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Limit to max 3 recommended slots
  const displaySlots = slots.slice(0, MAX_RECOMMENDED_SLOTS);

  return (
    <div className="space-y-4">
      {/* Header with confidence messaging */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Best Times for You</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          We've selected {displaySlots.length} optimal time{displaySlots.length !== 1 ? 's' : ''} based on our schedule
        </p>
      </div>

      {/* Recommended slots - primary cards */}
      <div className="space-y-2">
        {displaySlots.map((slot, index) => {
          const isSelected = selectedSlot?.startTime === slot.startTime && 
                            selectedSlot?.technicianId === slot.technicianId;
          const whyInfo = whyLabels[slot.whyLabel || 'alternative'];
          const WhyIcon = whyInfo.icon;
          const slotDate = parseISO(slot.startTime);
          const durationHrs = Math.round(slot.durationMinutes / 60 * 10) / 10;
          const isTopPick = index === 0;
          
          return (
            <button
              key={`${slot.technicianId}-${slot.startTime}`}
              onClick={() => onSelectSlot(slot)}
              className={cn(
                'w-full p-4 rounded-xl text-left transition-all',
                'border-2',
                isSelected 
                  ? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-2 shadow-md' 
                  : isTopPick
                    ? 'border-primary bg-primary/5 hover:bg-primary/10 shadow-sm'
                    : 'border-border bg-card hover:border-muted-foreground/50 hover:bg-accent/30'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Top pick indicator */}
                  {isTopPick && !isSelected && (
                    <div className="flex items-center gap-1.5 text-primary text-xs font-medium mb-1.5">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>Top Pick</span>
                    </div>
                  )}
                  
                  {/* Date, Time & Duration */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      "font-bold",
                      isTopPick || isSelected ? "text-lg" : "text-base"
                    )}>
                      {slot.displayTime || format(slotDate, 'h:mm a')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {format(slotDate, 'EEE, MMM d')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      • {durationHrs}hr
                    </span>
                  </div>
                  
                  {/* Technician - compact */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                    <User className="w-3 h-3" />
                    <span>{slot.technicianName}</span>
                    {slot.routeDensityLabel && (
                      <>
                        <span>•</span>
                        <MapPin className="w-3 h-3 text-primary" />
                        <span className="text-primary">{slot.routeDensityLabel}</span>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Selection state */}
                <div className="flex-shrink-0">
                  {isSelected ? (
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-sm">
                      <Check className="w-4 h-4 text-primary-foreground" />
                    </div>
                  ) : (
                    <div className={cn(
                      "w-7 h-7 rounded-full border-2 flex items-center justify-center",
                      isTopPick ? "border-primary/50" : "border-muted-foreground/30"
                    )} />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
        
      {/* Secondary action - clearly separated */}
      <Separator className="my-4" />
      
      <div className="text-center">
        <p className="text-xs text-muted-foreground mb-2">
          Need a specific date?
        </p>
        <Button 
          variant="outline" 
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={onPickDayInstead}
        >
          <Calendar className="w-4 h-4 mr-2" />
          Browse All Dates
        </Button>
      </div>
    </div>
  );
}
