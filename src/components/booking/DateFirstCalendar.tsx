import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  addDays, 
  addMonths, 
  addWeeks,
  subMonths,
  subWeeks,
  isSameMonth, 
  isSameDay, 
  isBefore,
  isAfter,
  startOfDay,
  getDay
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useSwipe } from '@/hooks/useSwipe';
import {
  buildDateStatusMap,
  type CalendarDateStatus,
  type DateStatusInfo,
} from '@/lib/calendar/dateStatus';

export type CalendarViewMode = 'week' | 'month';

interface DateFirstCalendarProps {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  workDays?: number[]; // 0=Sun, 1=Mon, etc. Default: [1,2,3,4,5] (Mon-Fri)
  fullyBookedDays?: string[]; // Array of date strings (YYYY-MM-DD) that are fully booked
  isLoadingSlots?: boolean;
  /**
   * Ranked customer-bookable slot options returned by the availability
   * endpoint. Used ONLY to classify each visible date as Open / Limited.
   * No pricing, availability, or booking logic is performed here.
   */
  availableSlots?: ReadonlyArray<{ startTime: string }>;
  /** Whether monthly availability is still being loaded from the server. */
  isLoadingAvailability?: boolean;
  /** Fail-closed flag: availability could not be verified. */
  availabilityUnavailable?: boolean;
  /** Analytics callback for calendar interactions (no PII). */
  onCalendarEvent?: (event:
    | { type: 'calendar_month_viewed'; month: string }
    | { type: 'open_date_selected'; date: string; count: number }
    | { type: 'limited_date_selected'; date: string; count: number }
    | { type: 'full_date_clicked'; date: string }
  ) => void;
}

export function DateFirstCalendar({
  viewMode,
  onViewModeChange,
  selectedDate,
  onSelectDate,
  minDate = new Date(),
  maxDate,
  workDays = [1, 2, 3, 4, 5],
  fullyBookedDays = [],
  isLoadingSlots = false,
  availableSlots = [],
  isLoadingAvailability = false,
  availabilityUnavailable = false,
  onCalendarEvent,
}: DateFirstCalendarProps) {
  const [currentDate, setCurrentDate] = useState(selectedDate || new Date());

  const workDaysSet = useMemo(() => new Set(workDays), [workDays]);
  const fullyBookedSet = useMemo(() => new Set(fullyBookedDays), [fullyBookedDays]);

  const navigatePrevious = () => {
    if (viewMode === 'month') {
      setCurrentDate(prev => subMonths(prev, 1));
    } else {
      setCurrentDate(prev => subWeeks(prev, 1));
    }
  };

  const navigateNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(prev => addMonths(prev, 1));
    } else {
      setCurrentDate(prev => addWeeks(prev, 1));
    }
  };

  const getDaysToRender = () => {
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const calendarStart = startOfWeek(monthStart);
      const calendarEnd = endOfWeek(monthEnd);

      const days: Date[] = [];
      let day = calendarStart;
      while (day <= calendarEnd) {
        days.push(day);
        day = addDays(day, 1);
      }
      return days;
    } else {
      // Week view
      const weekStart = startOfWeek(currentDate);
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        days.push(addDays(weekStart, i));
      }
      return days;
    }
  };

  const days = getDaysToRender();
  const today = startOfDay(new Date());

  const isDateDisabled = (date: Date) => {
    // Disabled if before today
    if (isBefore(date, today)) return true;
    
    // Disabled if before minDate
    if (minDate && isBefore(date, startOfDay(minDate))) return true;
    
    // Disabled if after maxDate
    if (maxDate && isAfter(date, startOfDay(maxDate))) return true;
    
    // Disabled if not a work day
    if (!workDaysSet.has(getDay(date))) return true;
    
    return false;
  };

  // Classify every visible date once per render pass using the server-derived
  // slot list. This never runs any availability math itself.
  const dateStatusMap = useMemo(() => {
    if (availabilityUnavailable) return {} as Record<string, DateStatusInfo>;
    return buildDateStatusMap({
      dates: days,
      slots: availableSlots,
      fullyBookedDays,
      isBookableBusinessDay: (d) => !isDateDisabled(d),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, availableSlots, fullyBookedDays, availabilityUnavailable, workDays, minDate?.toString(), maxDate?.toString()]);

  // Emit analytics when the visible month changes (month view only).
  useEffect(() => {
    if (!onCalendarEvent) return;
    if (viewMode !== 'month') return;
    onCalendarEvent({ type: 'calendar_month_viewed', month: format(currentDate, 'yyyy-MM') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format(currentDate, 'yyyy-MM'), viewMode]);

  const renderDay = (date: Date) => {
    const dayKey = format(date, 'yyyy-MM-dd');
    const isDisabled = isDateDisabled(date);
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const isToday = isSameDay(date, today);
    const isCurrentMonth = isSameMonth(date, currentDate);
    const isWorkDay = workDaysSet.has(getDay(date));

    // Fail-closed while loading OR when availability could not be verified:
    // do NOT paint everything as open. We still let the user tap a work-day
    // date to trigger a per-day load (existing behavior).
    const info: DateStatusInfo = availabilityUnavailable
      ? { status: isDisabled ? 'unavailable' : 'unknown' }
      : (dateStatusMap[dayKey] ?? { status: isDisabled ? 'unavailable' : 'unknown' });

    const status: CalendarDateStatus = info.status;
    const count = info.count;

    const isFullyBooked = status === 'full';
    // Fully-booked and unavailable dates are not selectable, but we let a Full
    // click reach our handler so we can log analytics + show messaging without
    // ever calling onSelectDate. The native `disabled` attribute is reserved
    // for truly Unavailable dates.
    const isClickable = !isDisabled && !isFullyBooked;
    const isUnavailable = isDisabled;

    const handleClick = () => {
      if (isFullyBooked) {
        onCalendarEvent?.({ type: 'full_date_clicked', date: dayKey });
        return;
      }
      if (!isClickable) return;
      if (status === 'open' && count !== undefined) {
        onCalendarEvent?.({ type: 'open_date_selected', date: dayKey, count });
      } else if (status === 'limited' && count !== undefined) {
        onCalendarEvent?.({ type: 'limited_date_selected', date: dayKey, count });
      }
      onSelectDate(date);
    };

    return (
      <button
        key={dayKey}
        onClick={handleClick}
        disabled={isUnavailable}
        aria-disabled={!isClickable}
        data-status={status}
        data-testid={`calendar-day-${dayKey}`}
        aria-label={
          isFullyBooked
            ? `${format(date, 'EEEE, MMMM d')} — Full, no times available`
            : isDisabled
              ? `${format(date, 'EEEE, MMMM d')} — Unavailable`
              : status === 'open'
                ? `${format(date, 'EEEE, MMMM d')} — Open${count ? `, ${count} times available` : ''}`
                : status === 'limited'
                  ? `${format(date, 'EEEE, MMMM d')} — Limited${count ? `, ${count} times left` : ''}`
                  : format(date, 'EEEE, MMMM d')
        }
        className={cn(
          'relative p-2 min-h-[58px] sm:min-h-[60px] flex flex-col items-center justify-center rounded-lg border transition-all touch-manipulation select-none active:scale-[0.97]',
          viewMode === 'week' ? 'flex-1' : 'w-full aspect-square',

          // Default border is muted; status overrides below.
          'border-transparent',
          isClickable && 'cursor-pointer',

          // Status treatments (color + border + background). We combine color
          // with badges/text below so status is legible without color alone.
          !isSelected && status === 'open' && 'bg-success/10 border-success/30 hover:bg-success/15',
          !isSelected && status === 'limited' && 'bg-warning/10 border-warning/40 hover:bg-warning/15',
          !isSelected && status === 'full' && 'bg-muted border-border cursor-not-allowed',
          !isSelected && status === 'unknown' && isClickable && 'bg-background border-border hover:bg-accent',

          // Selected state (highest priority)
          isSelected && 'bg-primary text-primary-foreground border-primary hover:bg-primary/90 shadow-sm',
          isSelected && isLoadingSlots && 'animate-pulse',

          // Today indicator (only if not selected)
          isToday && !isSelected && 'ring-2 ring-primary ring-inset',

          // Disabled dates (past / weekends off / out-of-range).
          isUnavailable && !isSelected && 'bg-muted/30 border-dashed border-border cursor-not-allowed opacity-60',

          // Non-current month fade (month view only)
          !isCurrentMonth && viewMode === 'month' && !isSelected && 'opacity-40'
        )}
      >
        <span className={cn(
          'text-sm font-medium',
          isSelected && 'text-primary-foreground',
          isUnavailable && !isSelected && 'text-muted-foreground',
          isFullyBooked && !isSelected && 'text-muted-foreground line-through decoration-muted-foreground/60'
        )}>
          {format(date, 'd')}
        </span>
        
        {viewMode === 'week' && (
          <span className={cn(
            'text-xs',
            isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
          )}>
            {format(date, 'EEE')}
          </span>
        )}
        
        {/* Status label — text is present so the calendar is legible without color. */}
        {!isSelected && !isUnavailable && status === 'open' && (
          <span className="text-[10px] font-semibold text-success mt-0.5 leading-none">
            {count && count > 0 ? `${count} open` : 'Open'}
          </span>
        )}
        {!isSelected && !isUnavailable && status === 'limited' && (
          <span className="text-[10px] font-semibold text-warning mt-0.5 leading-none">
            {count ? `${count} left` : 'Limited'}
          </span>
        )}
        {!isSelected && !isUnavailable && status === 'full' && (
          <span className="text-[10px] font-semibold text-muted-foreground mt-0.5 leading-none">
            Full
          </span>
        )}

        {isSelected && isLoadingSlots && (
          <span className="text-xs mt-1 text-primary-foreground/80">
            Loading...
          </span>
        )}
      </button>
    );
  };

  // Check navigation bounds
  const canNavigatePrevious = () => {
    if (viewMode === 'month') {
      const prevMonth = subMonths(currentDate, 1);
      return !isBefore(endOfMonth(prevMonth), startOfDay(minDate));
    } else {
      const prevWeek = subWeeks(currentDate, 1);
      return !isBefore(endOfWeek(prevWeek), startOfDay(minDate));
    }
  };

  const canNavigateNext = () => {
    if (!maxDate) return true;
    if (viewMode === 'month') {
      const nextMonth = addMonths(currentDate, 1);
      return !isAfter(startOfMonth(nextMonth), startOfDay(maxDate));
    } else {
      const nextWeek = addWeeks(currentDate, 1);
      return !isAfter(startOfWeek(nextWeek), startOfDay(maxDate));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with navigation and view toggle */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="icon"
            className="h-11 w-11 sm:h-10 sm:w-10 touch-manipulation"
            onClick={navigatePrevious}
            disabled={!canNavigatePrevious()}
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5 sm:h-4 sm:w-4" />
          </Button>
          <Button 
            variant="outline" 
            size="icon"
            className="h-11 w-11 sm:h-10 sm:w-10 touch-manipulation"
            onClick={navigateNext}
            disabled={!canNavigateNext()}
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5 sm:h-4 sm:w-4" />
          </Button>
          <h3 className="font-semibold text-base sm:text-lg ml-1 sm:ml-2">
            {viewMode === 'month' 
              ? format(currentDate, 'MMMM yyyy')
              : `Week of ${format(startOfWeek(currentDate), 'MMM d')}`
            }
          </h3>
        </div>

        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          <Button
            variant={viewMode === 'week' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 px-4 touch-manipulation"
            onClick={() => onViewModeChange('week')}
          >
            Week
          </Button>
          <Button
            variant={viewMode === 'month' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 px-4 touch-manipulation"
            onClick={() => onViewModeChange('month')}
          >
            Month
          </Button>
        </div>
      </div>

      {/* Fail-closed banner: availability unverifiable. */}
      {availabilityUnavailable && (
        <div
          role="status"
          data-testid="calendar-availability-unavailable"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-foreground">
            We couldn’t verify appointment availability just now. Please try again in a moment.
          </p>
        </div>
      )}

      {/* Calendar grid */}
      <div
        className={cn('grid grid-cols-7 gap-1', isLoadingAvailability && !availabilityUnavailable && 'animate-pulse')}
        data-testid="calendar-grid"
        data-loading={isLoadingAvailability ? 'true' : 'false'}
        aria-busy={isLoadingAvailability ? 'true' : 'false'}
        {...useSwipe({
          onSwipeLeft: () => canNavigateNext() && navigateNext(),
          onSwipeRight: () => canNavigatePrevious() && navigatePrevious(),
        })}
      >
        {/* Day headers */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}
        
        {/* Days */}
        {days.map(renderDay)}
      </div>

      {/* Swipe hint (mobile only) */}
      <p className="text-[11px] text-muted-foreground text-center sm:hidden -mt-1">
        Swipe left or right to change {viewMode === 'month' ? 'months' : 'weeks'}
      </p>

      {/* Legend — availability statuses. Do not rely on color alone. */}
      <div
        className="flex items-center gap-x-4 gap-y-2 text-xs text-muted-foreground pt-2 border-t flex-wrap"
        aria-label="Calendar legend"
        data-testid="calendar-legend"
      >
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-success/10 border border-success/40" aria-hidden="true" />
          <span>Open</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-warning/10 border border-warning/50" aria-hidden="true" />
          <span>Limited</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-muted border border-border" aria-hidden="true" />
          <span>Full</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-muted/30 border border-dashed border-border" aria-hidden="true" />
          <span>Unavailable</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-primary" aria-hidden="true" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded ring-2 ring-primary" aria-hidden="true" />
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
