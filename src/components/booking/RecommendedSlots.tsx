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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Recommended Times
        </CardTitle>
        <CardDescription>
          These times work best with our schedule
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {slots.map((slot, index) => {
          const isSelected = selectedSlot?.startTime === slot.startTime && 
                            selectedSlot?.technicianId === slot.technicianId;
          const whyInfo = whyLabels[slot.whyLabel || 'alternative'];
          const WhyIcon = whyInfo.icon;
          const slotDate = parseISO(slot.startTime);
          
          return (
            <button
              key={`${slot.technicianId}-${slot.startTime}`}
              onClick={() => onSelectSlot(slot)}
              className={cn(
                'w-full p-4 rounded-lg border-2 text-left transition-all',
                'hover:border-primary hover:bg-accent/50',
                isSelected 
                  ? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-2' 
                  : 'border-border bg-card',
                index === 0 && !isSelected && 'border-primary/50 bg-primary/5'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  {/* Date and Time */}
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">
                      {slot.displayTime || format(slotDate, 'h:mm a')}
                    </span>
                    <span className="text-muted-foreground">
                      {format(slotDate, 'EEEE, MMM d')}
                    </span>
                  </div>
                  
                  {/* Technician */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="w-3 h-3" />
                    <span>{slot.technicianName}</span>
                    <span>•</span>
                    <span>~{Math.round(slot.durationMinutes / 60 * 10) / 10}hr</span>
                  </div>
                  
                  {/* Route label if present */}
                  {slot.routeDensityLabel && (
                    <div className="flex items-center gap-1 text-xs text-primary">
                      <MapPin className="w-3 h-3" />
                      <span>{slot.routeDensityLabel}</span>
                    </div>
                  )}
                </div>
                
                {/* Why badge */}
                <div className="flex flex-col items-end gap-2">
                  <Badge 
                    variant={index === 0 ? 'default' : 'secondary'}
                    className="flex items-center gap-1"
                  >
                    <WhyIcon className="w-3 h-3" />
                    {whyInfo.label}
                  </Badge>
                  
                  {isSelected && (
                    <div className="flex items-center gap-1 text-primary text-sm font-medium">
                      <Star className="w-4 h-4 fill-current" />
                      Selected
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        
        {/* Pick a day instead link */}
        <div className="pt-4 border-t">
          <Button 
            variant="ghost" 
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={onPickDayInstead}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Pick a specific day instead
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
