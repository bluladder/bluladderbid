import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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

  const isDateFullyBooked = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return fullyBookedSet.has(dateStr);
  };

  const renderDay = (date: Date) => {
    const dayKey = format(date, 'yyyy-MM-dd');
    const isDisabled = isDateDisabled(date);
    const isFullyBooked = isDateFullyBooked(date);
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const isToday = isSameDay(date, today);
    const isCurrentMonth = isSameMonth(date, currentDate);
    const isWorkDay = workDaysSet.has(getDay(date));

    // Fully booked days are treated as disabled (not clickable)
    const isClickable = !isDisabled && !isFullyBooked;
    // Combine all "unavailable" states for consistent styling
    const isUnavailable = isDisabled || isFullyBooked;

    return (
      <button
        key={dayKey}
        onClick={() => isClickable && onSelectDate(date)}
        disabled={!isClickable}
        aria-disabled={!isClickable}
        aria-label={
          isFullyBooked 
            ? `${format(date, 'EEEE, MMMM d')} - Fully booked` 
            : isDisabled 
              ? `${format(date, 'EEEE, MMMM d')} - Unavailable`
              : format(date, 'EEEE, MMMM d')
        }
        className={cn(
          'relative p-2 min-h-[60px] flex flex-col items-center justify-center rounded-lg transition-all',
          viewMode === 'week' ? 'flex-1' : 'w-full aspect-square',
          
          // Base state - available
          isClickable && 'hover:bg-accent cursor-pointer',
          
          // Selected state (highest priority)
          isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
          isSelected && isLoadingSlots && 'animate-pulse',
          
          // Today indicator (only if not selected)
          isToday && !isSelected && 'ring-2 ring-primary ring-inset',
          
          // Unavailable states - consistent muted styling
          isUnavailable && !isSelected && 'bg-muted/40 cursor-not-allowed',
          
          // Non-work day gets slightly darker muted (weekends)
          !isWorkDay && !isSelected && 'bg-muted/60',
          
          // Non-current month fade (month view only)
          !isCurrentMonth && viewMode === 'month' && !isSelected && 'opacity-40'
        )}
      >
        <span className={cn(
          'text-sm font-medium',
          isSelected && 'text-primary-foreground',
          // Unavailable days get muted text
          isUnavailable && !isSelected && 'text-muted-foreground',
          // Fully booked days get strikethrough for extra clarity
          isFullyBooked && !isSelected && 'line-through decoration-muted-foreground/50'
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
        
        {/* Fully booked label - more prominent indicator */}
        {isFullyBooked && !isDisabled && (
          <span className="text-[10px] font-medium text-destructive/70 mt-0.5">
            Fully Booked
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="icon" 
            onClick={navigatePrevious}
            disabled={!canNavigatePrevious()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={navigateNext}
            disabled={!canNavigateNext()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h3 className="font-semibold text-lg ml-2">
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
            onClick={() => onViewModeChange('week')}
          >
            Week
          </Button>
          <Button
            variant={viewMode === 'month' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewModeChange('month')}
          >
            Month
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
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

      {/* Legend - updated with fully booked indicator */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-primary" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded ring-2 ring-primary" />
          <span>Today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-muted/40 relative">
            <span className="absolute inset-0 flex items-center justify-center text-[8px] text-destructive/70 font-bold">—</span>
          </div>
          <span>Fully Booked</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-muted/60" />
          <span>Weekend</span>
        </div>
      </div>
    </div>
  );
}
