import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Car, Save, Loader2, Plus, Trash2, Clock, MapPin } from 'lucide-react';
import { toast } from 'sonner';

interface BufferTier {
  min_drive: number;
  max_drive: number;
  buffer: number;
}

interface DriveTimeConfig {
  id: string;
  base_buffer_minutes: number;
  buffer_tiers: BufferTier[];
  max_drive_time_minutes: number;
  allow_long_first_drive: boolean;
  earliest_start_hour: number;
  latest_start_hour: number;
  last_job_buffer_minutes: number;
  no_long_last_drive: boolean;
  office_address: string | null;
}

const DEFAULT_CONFIG: Omit<DriveTimeConfig, 'id'> = {
  base_buffer_minutes: 10,
  buffer_tiers: [
    { min_drive: 0, max_drive: 10, buffer: 10 },
    { min_drive: 10, max_drive: 25, buffer: 20 },
    { min_drive: 25, max_drive: 45, buffer: 30 },
  ],
  max_drive_time_minutes: 45,
  allow_long_first_drive: true,
  earliest_start_hour: 9,
  latest_start_hour: 16,
  last_job_buffer_minutes: 0,
  no_long_last_drive: true,
  office_address: null,
};

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

export function DriveTimeSettings() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<Omit<DriveTimeConfig, 'id'>>(DEFAULT_CONFIG);
  const [configId, setConfigId] = useState<string | null>(null);

  const { data: savedConfig, isLoading } = useQuery({
    queryKey: ['drive-time-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drive_time_config')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      
      return {
        id: data.id,
        base_buffer_minutes: data.base_buffer_minutes,
        buffer_tiers: data.buffer_tiers as unknown as BufferTier[],
        max_drive_time_minutes: data.max_drive_time_minutes,
        allow_long_first_drive: data.allow_long_first_drive,
        earliest_start_hour: data.earliest_start_hour,
        latest_start_hour: data.latest_start_hour,
        last_job_buffer_minutes: data.last_job_buffer_minutes,
        no_long_last_drive: data.no_long_last_drive,
        office_address: data.office_address,
      } as DriveTimeConfig;
    },
  });

  useEffect(() => {
    if (savedConfig) {
      setConfigId(savedConfig.id);
      setConfig({
        base_buffer_minutes: savedConfig.base_buffer_minutes,
        buffer_tiers: savedConfig.buffer_tiers as BufferTier[],
        max_drive_time_minutes: savedConfig.max_drive_time_minutes,
        allow_long_first_drive: savedConfig.allow_long_first_drive,
        earliest_start_hour: savedConfig.earliest_start_hour,
        latest_start_hour: savedConfig.latest_start_hour,
        last_job_buffer_minutes: savedConfig.last_job_buffer_minutes,
        no_long_last_drive: savedConfig.no_long_last_drive,
        office_address: savedConfig.office_address,
      });
    }
  }, [savedConfig]);

  const saveMutation = useMutation({
    mutationFn: async (newConfig: Omit<DriveTimeConfig, 'id'>) => {
      // Cast buffer_tiers to match Supabase's Json type
      const dbConfig = {
        base_buffer_minutes: newConfig.base_buffer_minutes,
        buffer_tiers: JSON.parse(JSON.stringify(newConfig.buffer_tiers)),
        max_drive_time_minutes: newConfig.max_drive_time_minutes,
        allow_long_first_drive: newConfig.allow_long_first_drive,
        earliest_start_hour: newConfig.earliest_start_hour,
        latest_start_hour: newConfig.latest_start_hour,
        last_job_buffer_minutes: newConfig.last_job_buffer_minutes,
        no_long_last_drive: newConfig.no_long_last_drive,
        office_address: newConfig.office_address,
        updated_at: new Date().toISOString(),
      };
      
      if (configId) {
        const { error } = await supabase
          .from('drive_time_config')
          .update(dbConfig)
          .eq('id', configId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('drive_time_config')
          .insert([dbConfig]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-time-config'] });
      toast.success('Drive time settings saved');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    },
  });

  const handleSave = () => {
    if (config.earliest_start_hour >= config.latest_start_hour) {
      toast.error('Earliest start time must be before latest start time');
      return;
    }
    saveMutation.mutate(config);
  };

  const addBufferTier = () => {
    const lastTier = config.buffer_tiers[config.buffer_tiers.length - 1];
    const newTier: BufferTier = {
      min_drive: lastTier ? lastTier.max_drive : 0,
      max_drive: lastTier ? lastTier.max_drive + 15 : 15,
      buffer: lastTier ? lastTier.buffer + 10 : 10,
    };
    setConfig(prev => ({
      ...prev,
      buffer_tiers: [...prev.buffer_tiers, newTier],
    }));
  };

  const removeBufferTier = (index: number) => {
    if (config.buffer_tiers.length <= 1) {
      toast.error('Must have at least one buffer tier');
      return;
    }
    setConfig(prev => ({
      ...prev,
      buffer_tiers: prev.buffer_tiers.filter((_, i) => i !== index),
    }));
  };

  const updateBufferTier = (index: number, field: keyof BufferTier, value: number) => {
    setConfig(prev => ({
      ...prev,
      buffer_tiers: prev.buffer_tiers.map((tier, i) =>
        i === index ? { ...tier, [field]: value } : tier
      ),
    }));
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
          <Car className="h-5 w-5" />
          Drive Time & Scheduling Rules
        </CardTitle>
        <CardDescription>
          Configure drive time awareness and smart buffer logic for scheduling
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Office Address */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Office Address
          </Label>
          <Input
            value={config.office_address || ''}
            onChange={(e) => setConfig(prev => ({ ...prev, office_address: e.target.value || null }))}
            placeholder="123 Main St, City, State ZIP"
          />
          <p className="text-xs text-muted-foreground">
            Starting location for technicians who begin from the office
          </p>
        </div>

        <Separator />

        {/* Drive Time Limits */}
        <div className="space-y-4">
          <h3 className="font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Drive Time Limits
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Drive Time (minutes)</Label>
              <Input
                type="number"
                min={15}
                max={120}
                value={config.max_drive_time_minutes}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  max_drive_time_minutes: parseInt(e.target.value) || 45,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Slots exceeding this will be hidden from customers
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Base Buffer (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={config.base_buffer_minutes}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  base_buffer_minutes: parseInt(e.target.value) || 0,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Minimum buffer between appointments
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Allow Long First Drive</Label>
              <p className="text-xs text-muted-foreground">
                First job of day can exceed max drive time
              </p>
            </div>
            <Switch
              checked={config.allow_long_first_drive}
              onCheckedChange={(checked) => setConfig(prev => ({
                ...prev,
                allow_long_first_drive: checked,
              }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>No Long Last Drive</Label>
              <p className="text-xs text-muted-foreground">
                Disallow long drives as the last job of day
              </p>
            </div>
            <Switch
              checked={config.no_long_last_drive}
              onCheckedChange={(checked) => setConfig(prev => ({
                ...prev,
                no_long_last_drive: checked,
              }))}
            />
          </div>
        </div>

        <Separator />

        {/* Buffer Tiers */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Drive Time Buffer Tiers</h3>
            <Button variant="outline" size="sm" onClick={addBufferTier}>
              <Plus className="h-4 w-4 mr-1" />
              Add Tier
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Add extra buffer time based on estimated drive duration
          </p>
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Min Drive (min)</TableHead>
                <TableHead>Max Drive (min)</TableHead>
                <TableHead>Buffer Added (min)</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.buffer_tiers.map((tier, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={tier.min_drive}
                      onChange={(e) => updateBufferTier(index, 'min_drive', parseInt(e.target.value) || 0)}
                      className="w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={tier.max_drive}
                      onChange={(e) => updateBufferTier(index, 'max_drive', parseInt(e.target.value) || 0)}
                      className="w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={tier.buffer}
                      onChange={(e) => updateBufferTier(index, 'buffer', parseInt(e.target.value) || 0)}
                      className="w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBufferTier(index)}
                      disabled={config.buffer_tiers.length <= 1}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Separator />

        {/* Day Boundary Rules */}
        <div className="space-y-4">
          <h3 className="font-medium">Day Boundary Rules</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Earliest Start Time</Label>
              <Select
                value={config.earliest_start_hour.toString()}
                onValueChange={(v) => setConfig(prev => ({ ...prev, earliest_start_hour: parseInt(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.filter(h => h.value >= 6 && h.value <= 12).map((hour) => (
                    <SelectItem key={hour.value} value={hour.value.toString()}>
                      {hour.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Latest Start Time</Label>
              <Select
                value={config.latest_start_hour.toString()}
                onValueChange={(v) => setConfig(prev => ({ ...prev, latest_start_hour: parseInt(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.filter(h => h.value >= 12 && h.value <= 20).map((hour) => (
                    <SelectItem key={hour.value} value={hour.value.toString()}>
                      {hour.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Last time a job can start
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Extra Buffer Before Last Job (minutes)</Label>
            <Input
              type="number"
              min={0}
              max={60}
              value={config.last_job_buffer_minutes}
              onChange={(e) => setConfig(prev => ({
                ...prev,
                last_job_buffer_minutes: parseInt(e.target.value) || 0,
              }))}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">
              Additional time buffer before the last job of the day
            </p>
          </div>
        </div>

        <Separator />

        {/* Summary */}
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Current rules:</strong>{' '}
            Max {config.max_drive_time_minutes} min drive, 
            base {config.base_buffer_minutes} min buffer, 
            jobs from {formatHour(config.earliest_start_hour)} to {formatHour(config.latest_start_hour)}.
            {config.allow_long_first_drive && ' Long first drives allowed.'}
            {config.no_long_last_drive && ' No long last drives.'}
          </p>
        </div>

        <Button onClick={handleSave} disabled={saveMutation.isPending} className="w-full">
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Drive Time Settings
        </Button>
      </CardContent>
    </Card>
  );
}