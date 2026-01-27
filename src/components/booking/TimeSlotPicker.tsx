import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Clock, AlertCircle, MapPin, Info } from 'lucide-react';
import { format, parseISO, isSameDay, addDays } from 'date-fns';
import { DateFirstCalendar, type CalendarViewMode } from './DateFirstCalendar';
import { TimeSlotList } from './TimeSlotList';
import { useBookingSettings } from '@/components/admin/BookingSettings';
import { useDateSlots } from '@/hooks/useDateSlots';

export interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isRecommended?: boolean;
  routeDensityScore?: number;
  routeDensityLabel?: string;
  nearbyJobCount?: number;
}

interface ServiceForAvailability {
  service: string;
  price: number;
}

interface TimeSlotPickerProps {
  services: ServiceForAvailability[];
  onSelectSlot: (slot: TimeSlot) => void;
  selectedSlot: TimeSlot | null;
  customerAddress?: string;
}

export function TimeSlotPicker({ services, onSelectSlot, selectedSlot, customerAddress }: TimeSlotPickerProps) {
  // Calendar state
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Fetch admin booking settings
  const { data: bookingSettings } = useBookingSettings();
  const horizonDays = bookingSettings?.bookingHorizonDays || 365; // Default to 1 year for date-first
  const routeDensityWeight = bookingSettings?.routeDensityWeight || 'medium';

  // Use the new date-based slot fetching hook
  const {
    slots,
    isLoading,
    error,
    isThrottled,
    retryCountdown,
    requiresAdminAction,
    fetchSlotsForDate,
    lastFetchedDate,
  } = useDateSlots({
    services,
    customerAddress,
    routeDensityWeight,
    daysToFetch: 3, // Fetch 3 days at a time for better UX while staying under provider limits
  });

  // Handle date selection - fetch slots for that date
  const handleDateSelect = async (date: Date) => {
    setSelectedDate(date);
    
    // Fetch slots for the newly selected date
    await fetchSlotsForDate(date);
  };

  // Filter slots for selected date (in case we fetched a range)
  const slotsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return slots.filter(slot => isSameDay(parseISO(slot.startTime), selectedDate));
  }, [slots, selectedDate]);

  // Check if error is an admin-action-required error
  const isAdminActionRequired = requiresAdminAction || error?.includes('admin') || error?.includes('reconnect');
  const userFriendlyError = isAdminActionRequired 
    ? "Our scheduling system is temporarily offline. Please call us to book your appointment or try again later."
    : error;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Select a Date & Time
        </CardTitle>
        <CardDescription>
          Choose a date first, then select from available times
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Instructional hint */}
        {!selectedDate && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Select a date from the calendar below to see available appointment times.
            </AlertDescription>
          </Alert>
        )}

        {/* Calendar View - always show */}
        <DateFirstCalendar
          viewMode={calendarView}
          onViewModeChange={setCalendarView}
          selectedDate={selectedDate}
          onSelectDate={handleDateSelect}
          minDate={new Date()}
          maxDate={addDays(new Date(), horizonDays)}
          isLoadingSlots={isLoading}
        />

        {/* Error state */}
        {error && selectedDate && (
          <Alert variant={isThrottled ? "default" : "destructive"}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {userFriendlyError}
              {isThrottled && retryCountdown > 0 && (
                <span className="block mt-2 text-sm">
                  Ready to retry in {retryCountdown} seconds...
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Retry button */}
        {error && selectedDate && !isAdminActionRequired && (
          <Button
            onClick={() => fetchSlotsForDate(selectedDate)}
            disabled={isThrottled && retryCountdown > 0}
            variant="outline"
          >
            {isThrottled && retryCountdown > 0 ? `Retry in ${retryCountdown}s` : 'Try Again'}
          </Button>
        )}

        {/* Time Slots for Selected Date */}
        {selectedDate && !error && !isLoading && (
          <div className="border-t pt-6">
            <TimeSlotList
              slots={slotsForSelectedDate}
              selectedSlot={selectedSlot}
              onSelectSlot={onSelectSlot}
              selectedDate={selectedDate}
            />
          </div>
        )}

        {/* Loading indicator for slots */}
        {selectedDate && isLoading && (
          <div className="border-t pt-6">
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Clock className="w-5 h-5 mr-2 animate-pulse" />
              <span>Loading available times for {format(selectedDate, 'EEEE, MMMM d')}...</span>
            </div>
          </div>
        )}

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
            {selectedSlot.routeDensityLabel && (
              <p className="text-xs text-primary mt-1 flex items-center">
                <MapPin className="w-3 h-3 mr-1" />
                {selectedSlot.routeDensityLabel}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
