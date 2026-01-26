import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
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
  startOfDay
} from 'date-fns';
import { cn } from '@/lib/utils';

export type CalendarViewMode = 'week' | 'month';

interface DayAvailability {
  date: Date;
  hasSlots: boolean;
  slotCount: number;
  isRecommended: boolean;
  recommendedLabel?: string;
  efficiencyScore?: number;
}

interface CalendarViewProps {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  availableDays: DayAvailability[];
  minDate?: Date;
  maxDate?: Date;
}

export function CalendarView({
  viewMode,
  onViewModeChange,
  selectedDate,
  onSelectDate,
  availableDays,
  minDate = new Date(),
  maxDate,
}: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const availabilityMap = useMemo(() => {
    const map = new Map<string, DayAvailability>();
    availableDays.forEach(day => {
      map.set(format(day.date, 'yyyy-MM-dd'), day);
    });
    return map;
  }, [availableDays]);

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
    const dayKey = format(date, 'yyyy-MM-dd');
    const availability = availabilityMap.get(dayKey);
    
    // Disabled if before today
    if (isBefore(date, today)) return true;
    
    // Disabled if before minDate
    if (minDate && isBefore(date, startOfDay(minDate))) return true;
    
    // Disabled if after maxDate
    if (maxDate && isAfter(date, startOfDay(maxDate))) return true;
    
    // Disabled if no slots available
    if (!availability || !availability.hasSlots) return true;
    
    return false;
  };

  const renderDay = (date: Date) => {
    const dayKey = format(date, 'yyyy-MM-dd');
    const availability = availabilityMap.get(dayKey);
    const isDisabled = isDateDisabled(date);
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const isToday = isSameDay(date, today);
    const isCurrentMonth = isSameMonth(date, currentDate);

    return (
      <button
        key={dayKey}
        onClick={() => !isDisabled && onSelectDate(date)}
        disabled={isDisabled}
        className={cn(
          'relative p-2 min-h-[60px] flex flex-col items-center justify-start rounded-lg transition-all',
          viewMode === 'week' ? 'flex-1' : 'w-full aspect-square',
          isDisabled && 'opacity-40 cursor-not-allowed',
          !isDisabled && 'hover:bg-accent cursor-pointer',
          isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
          isToday && !isSelected && 'ring-2 ring-primary ring-inset',
          !isCurrentMonth && viewMode === 'month' && 'opacity-30'
        )}
      >
        <span className={cn(
          'text-sm font-medium',
          isSelected && 'text-primary-foreground'
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
        
        {availability && availability.hasSlots && !isDisabled && (
          <>
            <span className={cn(
              'text-xs mt-1',
              isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
            )}>
              {availability.slotCount} slot{availability.slotCount !== 1 ? 's' : ''}
            </span>
            
            {availability.isRecommended && (
              <Sparkles className={cn(
                'w-3 h-3 absolute top-1 right-1',
                isSelected ? 'text-primary-foreground' : 'text-yellow-500'
              )} />
            )}
          </>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header with navigation and view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={navigatePrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={navigateNext}>
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
      <div className={cn(
        'grid gap-1',
        viewMode === 'month' ? 'grid-cols-7' : 'grid-cols-7'
      )}>
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

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-primary" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded ring-2 ring-primary" />
          <span>Today</span>
        </div>
        <div className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-yellow-500" />
          <span>Recommended</span>
        </div>
      </div>
    </div>
  );
}
