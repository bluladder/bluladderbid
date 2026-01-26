import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Clock, User, ChevronLeft, ChevronRight, Star, AlertCircle } from 'lucide-react';
import { format, parseISO, isSameDay, addDays } from 'date-fns';

export interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isRecommended?: boolean;
}

interface ServiceForAvailability {
  service: string;
  price: number;
}

interface TimeSlotPickerProps {
  services: ServiceForAvailability[];
  onSelectSlot: (slot: TimeSlot) => void;
  selectedSlot: TimeSlot | null;
}

export function TimeSlotPicker({ services, onSelectSlot, selectedSlot }: TimeSlotPickerProps) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [availableDates, setAvailableDates] = useState<Date[]>([]);

  const fetchAvailability = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('jobber-availability', {
        body: {
          services,
          startDate: format(new Date(), 'yyyy-MM-dd'),
          daysToCheck: 14,
        },
      });

      if (fnError) throw fnError;

      if (data.error) {
        setError(data.error);
        setSlots([]);
        return;
      }

      const fetchedSlots: TimeSlot[] = data.slots || [];
      setSlots(fetchedSlots);

      // Extract unique dates that have availability
      const dates = [...new Set(fetchedSlots.map(s => 
        format(parseISO(s.startTime), 'yyyy-MM-dd')
      ))].map(d => parseISO(d));
      
      setAvailableDates(dates);
      
      // Select first available date
      if (dates.length > 0 && !selectedSlot) {
        setSelectedDate(dates[0]);
      }
    } catch (err) {
      console.error('Failed to fetch availability:', err);
      setError('Unable to load available times. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (services.length > 0) {
      fetchAvailability();
    }
  }, [services]);

  // Filter slots for selected date
  const slotsForSelectedDate = slots.filter(slot =>
    isSameDay(parseISO(slot.startTime), selectedDate)
  );

  // Group slots by technician
  const slotsByTech = slotsForSelectedDate.reduce((acc, slot) => {
    if (!acc[slot.technicianId]) {
      acc[slot.technicianId] = {
        name: slot.technicianName,
        slots: [],
      };
    }
    acc[slot.technicianId].slots.push(slot);
    return acc;
  }, {} as Record<string, { name: string; slots: TimeSlot[] }>);

  const navigateDate = (direction: 'prev' | 'next') => {
    const currentIndex = availableDates.findIndex(d => isSameDay(d, selectedDate));
    if (direction === 'prev' && currentIndex > 0) {
      setSelectedDate(availableDates[currentIndex - 1]);
    } else if (direction === 'next' && currentIndex < availableDates.length - 1) {
      setSelectedDate(availableDates[currentIndex + 1]);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Finding Available Times...
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <div className="grid grid-cols-3 gap-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Pick a Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={fetchAvailability} className="mt-4">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (availableDates.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Pick a Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No available times in the next 2 weeks. Please call us to schedule.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Pick a Time
        </CardTitle>
        <CardDescription>
          Select your preferred appointment time
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Date Navigation */}
        <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateDate('prev')}
            disabled={availableDates.findIndex(d => isSameDay(d, selectedDate)) === 0}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          
          <div className="text-center">
            <p className="font-semibold text-lg">
              {format(selectedDate, 'EEEE, MMMM d')}
            </p>
            <p className="text-sm text-muted-foreground">
              {slotsForSelectedDate.length} time{slotsForSelectedDate.length !== 1 ? 's' : ''} available
            </p>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateDate('next')}
            disabled={availableDates.findIndex(d => isSameDay(d, selectedDate)) === availableDates.length - 1}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Date Quick Select */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {availableDates.slice(0, 7).map((date) => (
            <Button
              key={date.toISOString()}
              variant={isSameDay(date, selectedDate) ? 'default' : 'outline'}
              size="sm"
              className="flex-shrink-0"
              onClick={() => setSelectedDate(date)}
            >
              <div className="text-center">
                <div className="text-xs">{format(date, 'EEE')}</div>
                <div className="font-bold">{format(date, 'd')}</div>
              </div>
            </Button>
          ))}
        </div>

        {/* Time Slots by Technician */}
        <div className="space-y-4">
          {Object.entries(slotsByTech).map(([techId, { name, slots: techSlots }]) => (
            <div key={techId} className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="w-4 h-4" />
                <span>{name}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {techSlots.map((slot, idx) => {
                  const isSelected = selectedSlot?.startTime === slot.startTime && 
                                     selectedSlot?.technicianId === slot.technicianId;
                  return (
                    <Button
                      key={idx}
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      className="relative"
                      onClick={() => onSelectSlot(slot)}
                    >
                      <Clock className="w-3 h-3 mr-1" />
                      {format(parseISO(slot.startTime), 'h:mm a')}
                      {slot.isRecommended && (
                        <Star className="w-3 h-3 absolute -top-1 -right-1 text-yellow-500 fill-yellow-500" />
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Selected Slot Summary */}
        {selectedSlot && (
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
            <div className="flex items-center gap-2 text-primary font-medium">
              <Clock className="w-4 h-4" />
              Selected: {format(parseISO(selectedSlot.startTime), 'EEEE, MMMM d')} at {format(parseISO(selectedSlot.startTime), 'h:mm a')}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              With {selectedSlot.technicianName} • ~{Math.round(selectedSlot.durationMinutes / 60 * 10) / 10} hours
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
