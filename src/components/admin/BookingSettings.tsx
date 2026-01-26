import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Save, Loader2, Sparkles, Route } from 'lucide-react';

export interface BookingSettingsConfig {
  bookingHorizonDays: number;
  showSuggestedDays: boolean;
  routeDensityWeight: 'low' | 'medium' | 'high';
}

const DEFAULT_BOOKING_SETTINGS: BookingSettingsConfig = {
  bookingHorizonDays: 21,
  showSuggestedDays: true,
  routeDensityWeight: 'medium',
};

const HORIZON_OPTIONS = [
  { value: 14, label: '2 weeks' },
  { value: 21, label: '3 weeks (default)' },
  { value: 30, label: '1 month' },
  { value: 45, label: '6 weeks' },
  { value: 60, label: '2 months' },
];

const DENSITY_WEIGHTS = [
  { value: 'low', label: 'Low', description: 'Slight preference for efficient routes' },
  { value: 'medium', label: 'Medium', description: 'Balanced route optimization' },
  { value: 'high', label: 'High', description: 'Strong preference for route efficiency' },
] as const;

export function BookingSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<BookingSettingsConfig>(DEFAULT_BOOKING_SETTINGS);

  const { data: savedSettings, isLoading } = useQuery({
    queryKey: ['booking-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_config')
        .select('config_value')
        .eq('config_key', 'booking_settings')
        .maybeSingle();

      if (error) throw error;
      if (!data?.config_value) return null;
      const val = data.config_value as Record<string, unknown>;
      return {
        bookingHorizonDays: (val.bookingHorizonDays as number) || DEFAULT_BOOKING_SETTINGS.bookingHorizonDays,
        showSuggestedDays: val.showSuggestedDays !== false,
        routeDensityWeight: (val.routeDensityWeight as BookingSettingsConfig['routeDensityWeight']) || 'medium',
      };
    },
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings);
    }
  }, [savedSettings]);

  const saveMutation = useMutation({
    mutationFn: async (newSettings: BookingSettingsConfig) => {
      const { data: existing } = await supabase
        .from('pricing_config')
        .select('id')
        .eq('config_key', 'booking_settings')
        .maybeSingle();

      const configValue = {
        bookingHorizonDays: newSettings.bookingHorizonDays,
        showSuggestedDays: newSettings.showSuggestedDays,
        routeDensityWeight: newSettings.routeDensityWeight,
      };

      if (existing) {
        const { error } = await supabase
          .from('pricing_config')
          .update({
            config_value: configValue,
            updated_at: new Date().toISOString(),
          })
          .eq('config_key', 'booking_settings');
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pricing_config')
          .insert([{
            config_key: 'booking_settings',
            config_value: configValue,
            description: 'Booking calendar and scheduling settings',
          }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-settings'] });
      toast({
        title: 'Booking settings saved',
        description: 'Customer booking experience has been updated.',
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

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const getDensitySliderValue = () => {
    if (settings.routeDensityWeight === 'low') return [0];
    if (settings.routeDensityWeight === 'medium') return [50];
    return [100];
  };

  const handleDensitySliderChange = (value: number[]) => {
    let weight: BookingSettingsConfig['routeDensityWeight'] = 'medium';
    if (value[0] < 33) weight = 'low';
    else if (value[0] > 66) weight = 'high';
    setSettings(prev => ({ ...prev, routeDensityWeight: weight }));
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
          <Calendar className="h-5 w-5" />
          Booking Calendar Settings
        </CardTitle>
        <CardDescription>
          Configure how far ahead customers can book and route optimization preferences
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Booking Horizon */}
        <div className="space-y-2">
          <Label>Scheduling Horizon</Label>
          <p className="text-sm text-muted-foreground">
            How far into the future customers can browse and book appointments
          </p>
          <Select
            value={settings.bookingHorizonDays.toString()}
            onValueChange={(v) => setSettings(prev => ({ ...prev, bookingHorizonDays: parseInt(v) }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZON_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Suggested Days Toggle */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <Label>Show Suggested Booking Days</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Display recommended days based on route efficiency and availability
            </p>
          </div>
          <Switch
            checked={settings.showSuggestedDays}
            onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showSuggestedDays: checked }))}
          />
        </div>

        {/* Route Density Weight */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4" />
            <Label>Route Density Optimization</Label>
          </div>
          <p className="text-sm text-muted-foreground">
            How strongly to prioritize route-efficient time slots
          </p>
          <div className="pt-2">
            <Slider
              value={getDensitySliderValue()}
              onValueChange={handleDensitySliderChange}
              max={100}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>Low</span>
              <span>Medium</span>
              <span>High</span>
            </div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">
              {DENSITY_WEIGHTS.find(w => w.value === settings.routeDensityWeight)?.label}
            </p>
            <p className="text-xs text-muted-foreground">
              {DENSITY_WEIGHTS.find(w => w.value === settings.routeDensityWeight)?.description}
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-2">
          <p className="text-sm font-medium">Current Configuration</p>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Customers can book up to <strong>{settings.bookingHorizonDays} days</strong> ahead</li>
            <li>• Suggested days: <strong>{settings.showSuggestedDays ? 'Enabled' : 'Disabled'}</strong></li>
            <li>• Route optimization: <strong>{settings.routeDensityWeight}</strong> priority</li>
          </ul>
        </div>

        <Button onClick={handleSave} disabled={saveMutation.isPending} className="w-full">
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Booking Settings
        </Button>
      </CardContent>
    </Card>
  );
}

// Hook to fetch booking settings for use in other components
export function useBookingSettings() {
  return useQuery({
    queryKey: ['booking-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_config')
        .select('config_value')
        .eq('config_key', 'booking_settings')
        .maybeSingle();

      if (error) throw error;
      if (!data?.config_value) return DEFAULT_BOOKING_SETTINGS;
      const val = data.config_value as Record<string, unknown>;
      return {
        bookingHorizonDays: (val.bookingHorizonDays as number) || DEFAULT_BOOKING_SETTINGS.bookingHorizonDays,
        showSuggestedDays: val.showSuggestedDays !== false,
        routeDensityWeight: (val.routeDensityWeight as BookingSettingsConfig['routeDensityWeight']) || 'medium',
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
