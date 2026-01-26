import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Clock, Save, Loader2 } from 'lucide-react';

interface BusinessHours {
  startHour: number;
  endHour: number;
  workDays: number[];
}

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  startHour: 9,
  endHour: 17,
  workDays: [1, 2, 3, 4, 5, 6], // Monday through Saturday
};

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: formatHour(i),
}));

function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

export function BusinessHoursSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS);

  const { data: savedHours, isLoading } = useQuery({
    queryKey: ['business-hours'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_config')
        .select('config_value')
        .eq('config_key', 'business_hours')
        .maybeSingle();

      if (error) throw error;
      if (!data?.config_value) return null;
      const val = data.config_value as Record<string, unknown>;
      return {
        startHour: val.startHour as number,
        endHour: val.endHour as number,
        workDays: val.workDays as number[],
      };
    },
  });

  useEffect(() => {
    if (savedHours) {
      setHours(savedHours);
    }
  }, [savedHours]);

  const saveMutation = useMutation({
    mutationFn: async (newHours: BusinessHours) => {
      // Check if config exists
      const { data: existing } = await supabase
        .from('pricing_config')
        .select('id')
        .eq('config_key', 'business_hours')
        .maybeSingle();

      const configValue = {
        startHour: newHours.startHour,
        endHour: newHours.endHour,
        workDays: newHours.workDays,
      };

      if (existing) {
        const { error } = await supabase
          .from('pricing_config')
          .update({ 
            config_value: configValue,
            updated_at: new Date().toISOString(),
          })
          .eq('config_key', 'business_hours');
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pricing_config')
          .insert([{
            config_key: 'business_hours',
            config_value: configValue,
            description: 'Business hours for scheduling appointments',
          }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-hours'] });
      toast({
        title: 'Business hours saved',
        description: 'Your scheduling availability has been updated.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to save',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const handleWorkDayToggle = (day: number, checked: boolean) => {
    setHours(prev => ({
      ...prev,
      workDays: checked
        ? [...prev.workDays, day].sort((a, b) => a - b)
        : prev.workDays.filter(d => d !== day),
    }));
  };

  const handleSave = () => {
    if (hours.startHour >= hours.endHour) {
      toast({
        title: 'Invalid hours',
        description: 'Start time must be before end time.',
        variant: 'destructive',
      });
      return;
    }
    if (hours.workDays.length === 0) {
      toast({
        title: 'Invalid days',
        description: 'Select at least one work day.',
        variant: 'destructive',
      });
      return;
    }
    saveMutation.mutate(hours);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Business Hours
        </CardTitle>
        <CardDescription>
          Configure when customers can book appointments
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Start Time</Label>
            <Select
              value={hours.startHour.toString()}
              onValueChange={(v) => setHours(prev => ({ ...prev, startHour: parseInt(v) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.filter(h => h.value < 20).map((hour) => (
                  <SelectItem key={hour.value} value={hour.value.toString()}>
                    {hour.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>End Time</Label>
            <Select
              value={hours.endHour.toString()}
              onValueChange={(v) => setHours(prev => ({ ...prev, endHour: parseInt(v) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.filter(h => h.value > 6).map((hour) => (
                  <SelectItem key={hour.value} value={hour.value.toString()}>
                    {hour.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Work Days</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {DAYS_OF_WEEK.map((day) => (
              <div key={day.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`day-${day.value}`}
                  checked={hours.workDays.includes(day.value)}
                  onCheckedChange={(checked) => handleWorkDayToggle(day.value, checked as boolean)}
                />
                <Label
                  htmlFor={`day-${day.value}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {day.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Current schedule:</strong>{' '}
            {formatHour(hours.startHour)} - {formatHour(hours.endHour)},{' '}
            {hours.workDays
              .map(d => DAYS_OF_WEEK.find(day => day.value === d)?.label.slice(0, 3))
              .join(', ') || 'No days selected'}
          </p>
        </div>

        <Button onClick={handleSave} disabled={saveMutation.isPending} className="w-full">
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Business Hours
        </Button>
      </CardContent>
    </Card>
  );
}
