import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, Calendar, User, Sparkles, Check } from 'lucide-react';
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
    <div className="space-y-3">
      {/* Header - compact */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Best Times for You</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {displaySlots.length} option{displaySlots.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Recommended slots */}
      <div className="space-y-1.5">
        {displaySlots.map((slot, index) => {
          const isSelected = selectedSlot?.startTime === slot.startTime && 
                            selectedSlot?.technicianId === slot.technicianId;
          const slotDate = parseISO(slot.startTime);
          const durationHrs = Math.round(slot.durationMinutes / 60 * 10) / 10;
          const isTopPick = index === 0;
          
          return (
            <button
              key={`${slot.technicianId}-${slot.startTime}`}
              onClick={() => onSelectSlot(slot)}
              className={cn(
                'w-full p-3 rounded-lg text-left',
                'border',
                isSelected 
                  ? 'border-primary bg-primary/10 ring-1 ring-primary' 
                  : isTopPick
                    ? 'border-primary/60 bg-primary/5 hover:bg-primary/10'
                    : 'border-border bg-card hover:bg-accent/50'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {/* Top pick label inline */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      "font-semibold",
                      isTopPick || isSelected ? "text-base" : "text-sm"
                    )}>
                      {slot.displayTime || format(slotDate, 'h:mm a')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(slotDate, 'EEE, MMM d')}
                    </span>
                    {isTopPick && !isSelected && (
                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        Top Pick
                      </span>
                    )}
                  </div>
                  
                  {/* Technician + duration */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <User className="w-3 h-3" />
                    <span>{slot.technicianName}</span>
                    <span>•</span>
                    <span>{durationHrs}hr</span>
                    {slot.routeDensityLabel && (
                      <>
                        <span>•</span>
                        <span className="text-primary">{slot.routeDensityLabel}</span>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Selection indicator */}
                <div className="flex-shrink-0">
                  {isSelected ? (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  ) : (
                    <div className={cn(
                      "w-5 h-5 rounded-full border",
                      isTopPick ? "border-primary/50" : "border-muted-foreground/30"
                    )} />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
        
      {/* Secondary action - subtle separator */}
      <div className="pt-2 border-t border-border/50 text-center">
        <Button 
          variant="ghost" 
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground h-8"
          onClick={onPickDayInstead}
        >
          <Calendar className="w-3.5 h-3.5 mr-1.5" />
          Browse all dates
        </Button>
      </div>
    </div>
  );
}
