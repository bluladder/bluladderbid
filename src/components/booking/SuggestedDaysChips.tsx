import { Badge } from '@/components/ui/badge';
import { Sparkles, Zap, Route } from 'lucide-react';
import { format, parseISO, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';

export interface RecommendedDay {
  date: string;
  dayOfWeek: string;
  label: string;
  reason: string;
  jobCount: number;
  availableSlots: number;
  efficiencyScore: number;
}

interface SuggestedDaysChipsProps {
  recommendedDays: RecommendedDay[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  availableDates: Date[];
}

const getLabelIcon = (label: string) => {
  if (label.toLowerCase().includes('fastest') || label.toLowerCase().includes('earliest')) {
    return <Zap className="w-3 h-3" />;
  }
  if (label.toLowerCase().includes('best') || label.toLowerCase().includes('efficient')) {
    return <Route className="w-3 h-3" />;
  }
  return <Sparkles className="w-3 h-3" />;
};

export function SuggestedDaysChips({
  recommendedDays,
  selectedDate,
  onSelectDate,
  availableDates,
}: SuggestedDaysChipsProps) {
  if (!recommendedDays || recommendedDays.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Sparkles className="w-4 h-4 text-primary" />
        <span>Recommended days for faster, more efficient service</span>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {recommendedDays.slice(0, 3).map((day) => {
          const dayDate = parseISO(day.date);
          const isSelected = selectedDate && isSameDay(dayDate, selectedDate);
          const isAvailable = availableDates.some(d => isSameDay(d, dayDate));

          return (
            <button
              key={day.date}
              onClick={() => isAvailable && onSelectDate(dayDate)}
              disabled={!isAvailable}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all',
                isSelected
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50',
                !isAvailable && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{day.dayOfWeek}</span>
                  <Badge
                    variant={day.efficiencyScore >= 75 ? 'default' : 'secondary'}
                    className="text-xs flex items-center gap-1"
                  >
                    {getLabelIcon(day.label)}
                    {day.label}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {format(dayDate, 'MMM d')} • {day.reason}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
