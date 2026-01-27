import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Clock, AlertCircle, MapPin } from 'lucide-react';
import { format, parseISO, isSameDay, addDays } from 'date-fns';
import { CalendarView, type CalendarViewMode } from './CalendarView';
import { SuggestedDaysChips, type RecommendedDay } from './SuggestedDaysChips';
import { TimeSlotList } from './TimeSlotList';
import { useBookingSettings } from '@/components/admin/BookingSettings';

type AvailabilityErrorPayload = {
  error?: string;
  retryAfter?: number;
  requiresAdminAction?: boolean;
  code?: string;
};

async function extractAvailabilityErrorPayload(err: unknown): Promise<AvailabilityErrorPayload | null> {
  const anyErr = err as any;

  // Supabase FunctionsHttpError has `context: Response`
  const context = anyErr?.context as Response | undefined;
  if (context && typeof context.clone === 'function') {
    try {
      const text = await context.clone().text();
      const maybeJson = JSON.parse(text) as AvailabilityErrorPayload;
      if (maybeJson && (maybeJson.error || maybeJson.retryAfter)) return maybeJson;
    } catch {
      // fall through
    }
  }

  // Fallback: try to parse trailing JSON from message
  const msg = anyErr?.message ? String(anyErr.message) : String(err);
  const jsonMatch = msg.match(/(\{[\s\S]*\})\s*$/);
  if (jsonMatch) {
    try {
      const maybeJson = JSON.parse(jsonMatch[1]) as AvailabilityErrorPayload;
      if (maybeJson && (maybeJson.error || maybeJson.retryAfter)) return maybeJson;
    } catch {
      // ignore
    }
  }

  return null;
}

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
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [recommendedDays, setRecommendedDays] = useState<RecommendedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isThrottled, setIsThrottled] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  
  // Calendar state
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Fetch admin booking settings
  const { data: bookingSettings } = useBookingSettings();
  const horizonDays = bookingSettings?.bookingHorizonDays || 21;
  const showSuggestedDays = bookingSettings?.showSuggestedDays !== false;
  const routeDensityWeight = bookingSettings?.routeDensityWeight || 'medium';

  // Prevent re-fetch spam due to new array identities
  const servicesKey = useMemo(
    () => services.map(s => `${s.service}:${s.price}`).join('|'),
    [services]
  );

  // Stable access to latest services without re-creating callbacks on every render
  const servicesRef = useRef(services);
  useEffect(() => {
    servicesRef.current = services;
  }, [services]);

  const fetchAvailability = useCallback(async (isRetry = false) => {
    setIsLoading(true);
    setError(null);
    if (!isRetry) {
      setIsThrottled(false);
      setRetryCountdown(0);
    }

    try {
      const { data, error: fnError } = await supabase.functions.invoke('jobber-availability', {
        body: {
          services: servicesRef.current,
          startDate: format(new Date(), 'yyyy-MM-dd'),
          daysToCheck: horizonDays,
          customerAddress,
          routeDensityWeight,
        },
      });

      // If we got a Functions error, try to extract the JSON payload and show it instead
      if (fnError) {
        const payload = await extractAvailabilityErrorPayload(fnError);
        if (payload?.error) {
          setError(payload.error);
          if (payload.retryAfter) {
            setIsThrottled(true);
            setRetryCountdown(payload.retryAfter);
          }
          if (payload.requiresAdminAction) {
            console.error('Jobber connection requires admin action:', payload.error);
          }
          setSlots([]);
          setRecommendedDays([]);
          return;
        }
        throw fnError;
      }

      // Check data.error FIRST - supabase-js returns the response body in data even on 503
      if (data?.error) {
        setError(data.error);
        if (data.retryAfter) {
          setIsThrottled(true);
          setRetryCountdown(data.retryAfter);
        }
        if (data.requiresAdminAction) {
          // Show a more prominent message for admin-action-required errors
          console.error('Jobber connection requires admin action:', data.error);
        }
        setSlots([]);
        setRecommendedDays([]);
        return;
      }

      setIsThrottled(false);
      setRetryCountdown(0);

      const fetchedSlots: TimeSlot[] = data.slots || [];
      setSlots(fetchedSlots);
      setRecommendedDays(data.recommendedDays || []);

      // Auto-select a date if none selected
      if (fetchedSlots.length > 0) {
        setSelectedDate((prev) => {
          if (prev) return prev;

          // Prefer recommended day with high efficiency
          const bestDay = data.recommendedDays?.find((d: RecommendedDay) => d.efficiencyScore >= 75);
          if (bestDay) {
            const bestDate = parseISO(bestDay.date);
            if (fetchedSlots.some(s => isSameDay(parseISO(s.startTime), bestDate))) {
              return bestDate;
            }
          }

          // Otherwise select first available date
          return parseISO(fetchedSlots[0].startTime);
        });
      }
    } catch (err) {
      console.error('Failed to fetch availability:', err);
      const payload = await extractAvailabilityErrorPayload(err);
      if (payload?.error) {
        setError(payload.error);
        if (payload.retryAfter) {
          setIsThrottled(true);
          setRetryCountdown(payload.retryAfter);
        }
        setSlots([]);
        setRecommendedDays([]);
        return;
      }
      setError('Unable to load available times. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [customerAddress, horizonDays, routeDensityWeight]);

  // Countdown (no auto-retry)
  useEffect(() => {
    if (retryCountdown > 0) {
      const timer = setTimeout(() => {
        setRetryCountdown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [retryCountdown]);

  // Auto-retry when throttle cooldown finishes
  useEffect(() => {
    if (isThrottled && retryCountdown === 0 && error) {
      fetchAvailability(true);
    }
  }, [isThrottled, retryCountdown, error, fetchAvailability]);

  useEffect(() => {
    if (services.length > 0) {
      fetchAvailability();
    }
  }, [servicesKey, customerAddress, horizonDays, routeDensityWeight, fetchAvailability, services.length]);

  // Compute available dates and their availability info
  const { availableDates, dayAvailabilityMap } = useMemo(() => {
    const dateSlotCounts = new Map<string, number>();
    slots.forEach(slot => {
      const dateKey = format(parseISO(slot.startTime), 'yyyy-MM-dd');
      dateSlotCounts.set(dateKey, (dateSlotCounts.get(dateKey) || 0) + 1);
    });

    const recommendedMap = new Map<string, RecommendedDay>();
    recommendedDays.forEach(rd => {
      recommendedMap.set(rd.date, rd);
    });

    const dates: Date[] = [];
    const dayMap: Array<{
      date: Date;
      hasSlots: boolean;
      slotCount: number;
      isRecommended: boolean;
      recommendedLabel?: string;
      efficiencyScore?: number;
    }> = [];

    // Build availability for the entire horizon
    for (let i = 0; i < horizonDays; i++) {
      const date = addDays(new Date(), i);
      const dateKey = format(date, 'yyyy-MM-dd');
      const slotCount = dateSlotCounts.get(dateKey) || 0;
      const recommended = recommendedMap.get(dateKey);

      if (slotCount > 0) {
        dates.push(date);
      }

      dayMap.push({
        date,
        hasSlots: slotCount > 0,
        slotCount,
        isRecommended: !!recommended,
        recommendedLabel: recommended?.label,
        efficiencyScore: recommended?.efficiencyScore,
      });
    }

    return { availableDates: dates, dayAvailabilityMap: dayMap };
  }, [slots, recommendedDays, horizonDays]);

  // Filter slots for selected date
  const slotsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return slots.filter(slot => isSameDay(parseISO(slot.startTime), selectedDate));
  }, [slots, selectedDate]);

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    // Clear selected slot when changing date
    if (selectedSlot && !isSameDay(parseISO(selectedSlot.startTime), date)) {
      // Don't clear - let parent handle this
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
          <div className="grid grid-cols-7 gap-2">
            {[...Array(14)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Check if error is an admin-action-required error (don't show technical details to customers)
  const isAdminActionRequired = error?.includes('admin') || error?.includes('reconnect');
  const userFriendlyError = isAdminActionRequired 
    ? "Our scheduling system is temporarily offline. Please call us to book your appointment or try again later."
    : error;

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Select a Date & Time
          </CardTitle>
        </CardHeader>
        <CardContent>
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
          {!isAdminActionRequired && (
            <Button
              onClick={() => fetchAvailability()}
              className="mt-4"
              disabled={isThrottled && retryCountdown > 0}
            >
              {isThrottled && retryCountdown > 0 ? `Retry in ${retryCountdown}s` : 'Try Again'}
            </Button>
          )}
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
            Select a Date & Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No available times in the next {horizonDays} days. Please call us to schedule.
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
          Select a Date & Time
        </CardTitle>
        <CardDescription>
          Choose your preferred appointment from the next {horizonDays} days
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Suggested Days Chips */}
        {showSuggestedDays && recommendedDays.length > 0 && (
          <SuggestedDaysChips
            recommendedDays={recommendedDays}
            selectedDate={selectedDate}
            onSelectDate={handleDateSelect}
            availableDates={availableDates}
          />
        )}

        {/* Calendar View */}
        <CalendarView
          viewMode={calendarView}
          onViewModeChange={setCalendarView}
          selectedDate={selectedDate}
          onSelectDate={handleDateSelect}
          availableDays={dayAvailabilityMap}
          minDate={new Date()}
          maxDate={addDays(new Date(), horizonDays)}
        />

        {/* Time Slots for Selected Date */}
        {selectedDate && (
          <div className="border-t pt-6">
            <TimeSlotList
              slots={slotsForSelectedDate}
              selectedSlot={selectedSlot}
              onSelectSlot={onSelectSlot}
              selectedDate={selectedDate}
            />
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
