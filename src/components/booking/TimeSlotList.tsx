import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, User, MapPin, Star, TrendingUp } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { TimeSlot } from './TimeSlotPicker';

interface TimeSlotListProps {
  slots: TimeSlot[];
  selectedSlot: TimeSlot | null;
  onSelectSlot: (slot: TimeSlot) => void;
  selectedDate: Date;
}

export function TimeSlotList({
  slots,
  selectedSlot,
  onSelectSlot,
  selectedDate,
}: TimeSlotListProps) {
  // Group slots by technician
  const slotsByTech = slots.reduce((acc, slot) => {
    if (!acc[slot.technicianId]) {
      acc[slot.technicianId] = {
        name: slot.technicianName,
        slots: [],
      };
    }
    acc[slot.technicianId].slots.push(slot);
    return acc;
  }, {} as Record<string, { name: string; slots: TimeSlot[] }>);

  // Sort slots within each technician - route density first, then by time
  Object.values(slotsByTech).forEach(tech => {
    tech.slots.sort((a, b) => {
      // Recommended slots first
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      // Then by route density score (higher = better)
      const scoreA = a.routeDensityScore || 50;
      const scoreB = b.routeDensityScore || 50;
      if (scoreA !== scoreB) return scoreB - scoreA;
      // Then by time
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
  });

  if (slots.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No available times for {format(selectedDate, 'EEEE, MMMM d')}</p>
        <p className="text-sm mt-1">Please select a different day</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">
          Available times for {format(selectedDate, 'EEEE, MMMM d')}
        </h4>
        <Badge variant="secondary">
          {slots.length} slot{slots.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {Object.entries(slotsByTech).map(([techId, { name, slots: techSlots }]) => (
        <div key={techId} className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="w-4 h-4" />
            <span>{name}</span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {techSlots.map((slot, idx) => {
              const isSelected = 
                selectedSlot?.startTime === slot.startTime &&
                selectedSlot?.technicianId === slot.technicianId;
              const hasLabel = slot.routeDensityLabel && slot.routeDensityLabel.length > 0;
              const isTopSlot = idx < 2 && (slot.routeDensityScore || 0) >= 70;

              return (
                <Button
                  key={`${slot.technicianId}-${slot.startTime}-${idx}`}
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'relative flex flex-col items-center py-2 h-auto',
                    hasLabel && !isSelected && 'border-primary/50',
                    isTopSlot && !isSelected && 'ring-1 ring-primary/30'
                  )}
                  onClick={() => onSelectSlot(slot)}
                >
                  <div className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {format(parseISO(slot.startTime), 'h:mm a')}
                  </div>
                  
                  {hasLabel && (
                    <span className={cn(
                      'text-[10px] mt-0.5 flex items-center',
                      isSelected ? 'text-primary-foreground/80' : 'text-primary'
                    )}>
                      <MapPin className="w-2.5 h-2.5 mr-0.5" />
                      {slot.routeDensityLabel}
                    </span>
                  )}
                  
                  {slot.isRecommended && (
                    <Star className="w-3 h-3 absolute -top-1 -right-1 text-yellow-500 fill-yellow-500" />
                  )}
                  
                  {isTopSlot && !slot.isRecommended && (
                    <TrendingUp className="w-3 h-3 absolute -top-1 -right-1 text-primary" />
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
