import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Clock, AlertCircle, ArrowLeft } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { TimePreferenceSelector } from './TimePreferenceSelector';
import { RecommendedSlots } from './RecommendedSlots';
import { DateFirstCalendar, type CalendarViewMode } from './DateFirstCalendar';
import { TimeSlotList } from './TimeSlotList';
import { useSmartAvailability, type TimePreference, type RecommendedSlot } from '@/hooks/useSmartAvailability';
import { useBookingSettings } from '@/components/admin/BookingSettings';

export interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  displayTime?: string;
  durationMinutes: number;
  isRecommended?: boolean;
  routeDensityScore?: number;
  routeDensityLabel?: string;
  nearbyJobCount?: number;
  whyLabel?: string;
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

type ViewMode = 'preference' | 'recommendations' | 'dayPicker' | 'daySlots';

export function TimeSlotPicker({ services, onSelectSlot, selectedSlot, customerAddress }: TimeSlotPickerProps) {
  // Default directly to recommendations view with 'none' preference
  const [viewMode, setViewMode] = useState<ViewMode>('recommendations');
  const [preference, setPreference] = useState<TimePreference>('none');
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);
  
  // Fetch admin booking settings
  const { data: bookingSettings } = useBookingSettings();
  const horizonDays = bookingSettings?.bookingHorizonDays || 365;

  // Smart availability hook
  const {
    recommendations,
    isLoadingRecommendations,
    fetchRecommendations,
    daySlots,
    isLoadingDaySlots,
    fetchDaySlots,
    fullyBookedDays,
    error,
    requiresAdminAction,
    clearSlots,
  } = useSmartAvailability({
    services,
    customerAddress,
  });

  // Auto-fetch recommendations on mount
  useMemo(() => {
    if (!hasLoadedInitial && services.length > 0) {
      setHasLoadedInitial(true);
      fetchRecommendations('none');
    }
  }, [services, hasLoadedInitial, fetchRecommendations]);

  // Handle preference change (from the filter)
  const handlePreferenceChange = (pref: TimePreference) => {
    setPreference(pref);
    fetchRecommendations(pref);
  };

  // Handle recommendation selection
  const handleSelectRecommendation = (slot: RecommendedSlot) => {
    onSelectSlot(slot as TimeSlot);
  };

  // Handle "pick a day instead"
  const handlePickDayInstead = () => {
    setViewMode('dayPicker');
    clearSlots();
  };

  // Handle date selection from calendar
  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    setViewMode('daySlots');
    fetchDaySlots(date);
  };

  // Handle back navigation
  const handleBack = () => {
    if (viewMode === 'recommendations') {
      setViewMode('preference');
      setPreference(null);
      clearSlots();
    } else if (viewMode === 'dayPicker') {
      setViewMode('recommendations');
    } else if (viewMode === 'daySlots') {
      setViewMode('dayPicker');
      setSelectedDate(null);
    }
  };

  // Convert day slots to TimeSlot format for TimeSlotList
  const formattedDaySlots: TimeSlot[] = useMemo(() => {
    return daySlots.map(slot => ({
      technicianId: slot.technicianId,
      technicianName: slot.technicianName,
      startTime: slot.startTime,
      endTime: slot.endTime,
      displayTime: slot.displayTime,
      durationMinutes: slot.durationMinutes,
      routeDensityScore: slot.routeDensityScore,
      routeDensityLabel: slot.routeDensityLabel,
    }));
  }, [daySlots]);

  // Check if error is admin-action-required
  const isAdminActionRequired = requiresAdminAction || error?.includes('admin') || error?.includes('reconnect');
  const userFriendlyError = isAdminActionRequired 
    ? "Our scheduling system is temporarily offline. Please call us to book your appointment or try again later."
    : error;

  return (
    <div className="space-y-4">
      {/* Back button for nested views */}
      {viewMode !== 'preference' && (
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-2">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      )}

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{userFriendlyError}</AlertDescription>
        </Alert>
      )}

      {/* Removed old preference step - now defaults to recommendations */}

      {/* Step 2: Recommendations (default view) */}
      {viewMode === 'recommendations' && (
        <>
          {/* Quick preference filter */}
          <TimePreferenceSelector
            value={preference}
            onChange={handlePreferenceChange}
            isLoading={isLoadingRecommendations}
          />
          
          <RecommendedSlots
            slots={recommendations}
            isLoading={isLoadingRecommendations}
            selectedSlot={selectedSlot as RecommendedSlot | null}
            onSelectSlot={handleSelectRecommendation}
            onPickDayInstead={handlePickDayInstead}
          />
        </>
      )}

      {/* Step 3: Day Picker (alternative - clearly labeled as manual override) */}
      {viewMode === 'dayPicker' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Pick a Specific Date
            </CardTitle>
            <CardDescription>
              Browse the calendar to find available times on a specific day.
              <span className="block mt-1 text-xs text-muted-foreground/80">
                Days marked as "Fully Booked" have no remaining availability.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DateFirstCalendar
              viewMode={calendarView}
              onViewModeChange={setCalendarView}
              selectedDate={selectedDate}
              onSelectDate={handleDateSelect}
              minDate={new Date()}
              maxDate={addDays(new Date(), horizonDays)}
              fullyBookedDays={fullyBookedDays}
              isLoadingSlots={false}
            />
          </CardContent>
        </Card>
      )}

      {/* Step 4: Day Slots (after date selection) */}
      {viewMode === 'daySlots' && selectedDate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Available Times
            </CardTitle>
            <CardDescription>
              {format(selectedDate, 'EEEE, MMMM d')} — Select a time to continue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingDaySlots ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Clock className="w-5 h-5 mr-2 animate-pulse" />
                <span>Loading available times...</span>
              </div>
            ) : formattedDaySlots.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-3">
                  This day is fully booked. Try the next available day or choose a recommended time.
                </p>
                <Button variant="outline" onClick={handleBack}>
                  <Calendar className="w-4 h-4 mr-2" />
                  Pick Another Day
                </Button>
              </div>
            ) : (
              <TimeSlotList
                slots={formattedDaySlots}
                selectedSlot={selectedSlot}
                onSelectSlot={onSelectSlot}
                selectedDate={selectedDate}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Removed duplicate selected slot summary - info is shown in the slot cards */}
    </div>
  );
}
