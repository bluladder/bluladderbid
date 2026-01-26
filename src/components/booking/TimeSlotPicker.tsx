import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Clock, User, ChevronLeft, ChevronRight, Star, AlertCircle, MapPin, Sparkles, TrendingUp } from 'lucide-react';
import { format, parseISO, isSameDay, addDays } from 'date-fns';

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

interface RecommendedDay {
  date: string;
  dayOfWeek: string;
  label: string;
  reason: string;
  jobCount: number;
  availableSlots: number;
  efficiencyScore: number;
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
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [availableDates, setAvailableDates] = useState<Date[]>([]);

  const fetchAvailability = async (isRetry = false) => {
    setIsLoading(true);
    setError(null);
    if (!isRetry) {
      setIsThrottled(false);
      setRetryCountdown(0);
    }

    try {
      const { data, error: fnError } = await supabase.functions.invoke('jobber-availability', {
        body: {
          services,
          startDate: format(new Date(), 'yyyy-MM-dd'),
          daysToCheck: 14,
          customerAddress,
        },
      });

      if (fnError) throw fnError;

      if (data.error) {
        // Check if it's a throttle/busy error
        if (data.retryAfter) {
          setIsThrottled(true);
          setRetryCountdown(data.retryAfter);
          setError(data.error);
        } else {
          setError(data.error);
        }
        setSlots([]);
        setRecommendedDays([]);
        return;
      }

      // Success - clear throttle state
      setIsThrottled(false);
      setRetryCountdown(0);

      const fetchedSlots: TimeSlot[] = data.slots || [];
      setSlots(fetchedSlots);
      
      // Set recommended days
      setRecommendedDays(data.recommendedDays || []);

      // Extract unique dates that have availability
      const dates = [...new Set(fetchedSlots.map(s => 
        format(parseISO(s.startTime), 'yyyy-MM-dd')
      ))].map(d => parseISO(d));
      
      setAvailableDates(dates);
      
      // If there's a recommended day with high efficiency, pre-select it
      const bestDay = data.recommendedDays?.find((d: RecommendedDay) => d.efficiencyScore >= 75);
      if (bestDay && !selectedSlot) {
        const bestDate = parseISO(bestDay.date);
        if (dates.some(d => isSameDay(d, bestDate))) {
          setSelectedDate(bestDate);
          return;
        }
      }
      
      // Otherwise select first available date
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

  // Auto-retry countdown for throttled state
  useEffect(() => {
    if (retryCountdown > 0) {
      const timer = setTimeout(() => {
        setRetryCountdown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (isThrottled && retryCountdown === 0) {
      // Auto-retry when countdown reaches 0
      fetchAvailability(true);
    }
  }, [retryCountdown, isThrottled]);

  useEffect(() => {
    if (services.length > 0) {
      fetchAvailability();
    }
  }, [services, customerAddress]);

  // Filter slots for selected date
  const slotsForSelectedDate = slots.filter(slot =>
    isSameDay(parseISO(slot.startTime), selectedDate)
  );

  // Group slots by technician, with recommended slots first
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

  // Sort slots within each technician - recommended first, then by time
  Object.values(slotsByTech).forEach(tech => {
    tech.slots.sort((a, b) => {
      // Recommended slots first
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      // Then by route density score
      const scoreA = a.routeDensityScore || 50;
      const scoreB = b.routeDensityScore || 50;
      if (scoreA !== scoreB) return scoreB - scoreA;
      // Then by time
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
  });

  const navigateDate = (direction: 'prev' | 'next') => {
    const currentIndex = availableDates.findIndex(d => isSameDay(d, selectedDate));
    if (direction === 'prev' && currentIndex > 0) {
      setSelectedDate(availableDates[currentIndex - 1]);
    } else if (direction === 'next' && currentIndex < availableDates.length - 1) {
      setSelectedDate(availableDates[currentIndex + 1]);
    }
  };

  const handleDayRecommendationClick = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (availableDates.some(d => isSameDay(d, date))) {
      setSelectedDate(date);
    }
  };

  // Check if selected date is a recommended day
  const selectedDateRecommendation = recommendedDays.find(rd => 
    isSameDay(parseISO(rd.date), selectedDate)
  );

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
          <Alert variant={isThrottled ? "default" : "destructive"}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error}
              {isThrottled && retryCountdown > 0 && (
                <span className="block mt-2 text-sm">
                  Automatically retrying in {retryCountdown} seconds...
                </span>
              )}
            </AlertDescription>
          </Alert>
          <Button 
            onClick={() => fetchAvailability()} 
            className="mt-4"
            disabled={isThrottled && retryCountdown > 0}
          >
            {isThrottled && retryCountdown > 0 ? `Retrying in ${retryCountdown}s` : 'Try Again'}
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
        {/* Recommended Days Section */}
        {recommendedDays.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>Recommended days for faster, more efficient service</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {recommendedDays.map((day) => {
                const dayDate = parseISO(day.date);
                const isSelected = isSameDay(dayDate, selectedDate);
                const isAvailable = availableDates.some(d => isSameDay(d, dayDate));
                
                return (
                  <button
                    key={day.date}
                    onClick={() => handleDayRecommendationClick(day.date)}
                    disabled={!isAvailable}
                    className={`
                      flex flex-col items-start p-3 rounded-lg border text-left transition-all
                      ${isSelected 
                        ? 'border-primary bg-primary/10 ring-1 ring-primary' 
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }
                      ${!isAvailable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{day.dayOfWeek}</span>
                      <Badge 
                        variant={day.efficiencyScore >= 75 ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {day.label}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1">
                      {format(dayDate, 'MMM d')} • {day.reason}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
            <div className="flex items-center justify-center gap-2">
              <p className="font-semibold text-lg">
                {format(selectedDate, 'EEEE, MMMM d')}
              </p>
              {selectedDateRecommendation && (
                <Badge variant="secondary" className="text-xs">
                  <TrendingUp className="w-3 h-3 mr-1" />
                  {selectedDateRecommendation.label}
                </Badge>
              )}
            </div>
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
          {availableDates.slice(0, 7).map((date) => {
            const dayRec = recommendedDays.find(rd => isSameDay(parseISO(rd.date), date));
            return (
              <Button
                key={date.toISOString()}
                variant={isSameDay(date, selectedDate) ? 'default' : 'outline'}
                size="sm"
                className="flex-shrink-0 relative"
                onClick={() => setSelectedDate(date)}
              >
                <div className="text-center">
                  <div className="text-xs">{format(date, 'EEE')}</div>
                  <div className="font-bold">{format(date, 'd')}</div>
                </div>
                {dayRec && dayRec.efficiencyScore >= 70 && (
                  <Sparkles className="w-3 h-3 absolute -top-1 -right-1 text-yellow-500" />
                )}
              </Button>
            );
          })}
        </div>

        {/* Time Slots by Technician */}
        <div className="space-y-4">
          {Object.entries(slotsByTech).map(([techId, { name, slots: techSlots }]) => (
            <div key={techId} className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="w-4 h-4" />
                <span>{name}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {techSlots.map((slot, idx) => {
                  const isSelected = selectedSlot?.startTime === slot.startTime && 
                                     selectedSlot?.technicianId === slot.technicianId;
                  const hasLabel = slot.routeDensityLabel && slot.routeDensityLabel.length > 0;
                  
                  return (
                    <Button
                      key={idx}
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      className={`relative flex flex-col items-center py-2 h-auto ${hasLabel ? 'border-primary/50' : ''}`}
                      onClick={() => onSelectSlot(slot)}
                    >
                      <div className="flex items-center">
                        <Clock className="w-3 h-3 mr-1" />
                        {format(parseISO(slot.startTime), 'h:mm a')}
                      </div>
                      {hasLabel && (
                        <span className="text-[10px] text-primary mt-0.5 flex items-center">
                          <MapPin className="w-2.5 h-2.5 mr-0.5" />
                          {slot.routeDensityLabel}
                        </span>
                      )}
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
