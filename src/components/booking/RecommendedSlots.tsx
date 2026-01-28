import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, Star, TrendingUp, Calendar, MapPin, User, Sparkles } from 'lucide-react';
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

const whyLabels: Record<string, { label: string; icon: typeof Star; color: string }> = {
  soonest_available: {
    label: 'Soonest Available',
    icon: Clock,
    color: 'text-green-600',
  },
  minimizes_gaps: {
    label: 'Best for Route',
    icon: TrendingUp,
    color: 'text-blue-600',
  },
  alternative: {
    label: 'Alternative',
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="w-4 h-4 text-primary" />
          Recommended Times
        </CardTitle>
        <CardDescription className="text-xs">
          Best options based on our schedule
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {slots.map((slot, index) => {
          const isSelected = selectedSlot?.startTime === slot.startTime && 
                            selectedSlot?.technicianId === slot.technicianId;
          const whyInfo = whyLabels[slot.whyLabel || 'alternative'];
          const WhyIcon = whyInfo.icon;
          const slotDate = parseISO(slot.startTime);
          const durationHrs = Math.round(slot.durationMinutes / 60 * 10) / 10;
          
          return (
            <button
              key={`${slot.technicianId}-${slot.startTime}`}
              onClick={() => onSelectSlot(slot)}
              className={cn(
                'w-full p-3 rounded-lg border-2 text-left transition-all',
                'hover:border-primary hover:bg-accent/50',
                isSelected 
                  ? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-1' 
                  : 'border-border bg-card',
                index === 0 && !isSelected && 'border-primary/40 bg-primary/5'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Date, Time & Duration - single line */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base">
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
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <Star className="w-3.5 h-3.5 text-primary-foreground fill-current" />
                    </div>
                  ) : index === 0 ? (
                    <Badge variant="default" className="text-xs px-2 py-0.5">
                      <WhyIcon className="w-3 h-3 mr-1" />
                      Best
                    </Badge>
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-muted-foreground/30" />
                  )}
                </div>
              </div>
            </button>
          );
        })}
        
        {/* Pick a day instead link - more compact */}
        <Button 
          variant="ghost" 
          className="w-full text-xs text-muted-foreground hover:text-foreground h-9 mt-2"
          onClick={onPickDayInstead}
        >
          <Calendar className="w-3.5 h-3.5 mr-1.5" />
          Pick a specific day instead
        </Button>
      </CardContent>
    </Card>
  );
}
