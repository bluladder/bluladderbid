import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sun, Moon, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimePreference } from '@/hooks/useSmartAvailability';

interface TimePreferenceSelectorProps {
  value: TimePreference | null;
  onChange: (preference: TimePreference) => void;
  isLoading?: boolean;
}

const preferences: Array<{
  value: TimePreference;
  label: string;
  description: string;
  icon: typeof Sun;
  timeRange: string;
}> = [
  {
    value: 'AM',
    label: 'Morning',
    description: 'Before noon',
    icon: Sun,
    timeRange: '8am–12pm',
  },
  {
    value: 'PM',
    label: 'Afternoon',
    description: 'After noon',
    icon: Moon,
    timeRange: '12pm–5pm',
  },
  {
    value: 'none',
    label: 'No Preference',
    description: 'Any time works',
    icon: Clock,
    timeRange: 'All day',
  },
];

export function TimePreferenceSelector({
  value,
  onChange,
  isLoading = false,
}: TimePreferenceSelectorProps) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Time Preference
        </CardTitle>
        <CardDescription className="text-xs">
          We'll only show times matching your preference
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-2">
          {preferences.map((pref) => {
            const Icon = pref.icon;
            const isSelected = value === pref.value;
            
            return (
              <Button
                key={pref.value}
                variant={isSelected ? 'default' : 'outline'}
                className={cn(
                  'h-auto py-2.5 px-2 flex flex-col items-center gap-1',
                  isSelected && 'ring-1 ring-primary ring-offset-1',
                  !isSelected && 'border-border/50'
                )}
                onClick={() => onChange(pref.value)}
                disabled={isLoading}
              >
                <Icon className={cn(
                  'w-4 h-4',
                  isSelected ? 'text-primary-foreground' : 'text-primary'
                )} />
                <span className={cn(
                  'text-xs font-medium',
                  isSelected ? 'text-primary-foreground' : 'text-foreground'
                )}>
                  {pref.label}
                </span>
                <span className={cn(
                  'text-[10px]',
                  isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                )}>
                  {pref.timeRange}
                </span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
