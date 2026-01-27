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
}> = [
  {
    value: 'AM',
    label: 'Morning',
    description: 'Before noon',
    icon: Sun,
  },
  {
    value: 'PM',
    label: 'Afternoon',
    description: 'After noon',
    icon: Moon,
  },
  {
    value: 'none',
    label: 'No Preference',
    description: 'Any time works',
    icon: Clock,
  },
];

export function TimePreferenceSelector({
  value,
  onChange,
  isLoading = false,
}: TimePreferenceSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          When would you prefer your appointment?
        </CardTitle>
        <CardDescription>
          We'll find the best times that fit your schedule
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {preferences.map((pref) => {
            const Icon = pref.icon;
            const isSelected = value === pref.value;
            
            return (
              <Button
                key={pref.value}
                variant={isSelected ? 'default' : 'outline'}
                className={cn(
                  'h-auto py-4 flex flex-col items-center gap-2',
                  isSelected && 'ring-2 ring-primary ring-offset-2'
                )}
                onClick={() => onChange(pref.value)}
                disabled={isLoading}
              >
                <Icon className={cn(
                  'w-6 h-6',
                  isSelected ? 'text-primary-foreground' : 'text-primary'
                )} />
                <div className="text-center">
                  <div className="font-medium">{pref.label}</div>
                  <div className={cn(
                    'text-xs',
                    isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                  )}>
                    {pref.description}
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
