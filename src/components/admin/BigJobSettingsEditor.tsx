import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users2, DollarSign, Gauge, Save, Loader2, AlertCircle, Clock, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface BigJobSettings {
  big_job_value_threshold: number;
  big_job_solo_hours_threshold: number | null;
  auto_assign_two_techs: boolean;
  crew_efficiency_factor: number;
  allowed_tech_pairs: string[][];
  // Phase 2 additions
  workday_start_time: string;
  workday_end_time: string;
  workday_length_hours: number;
  min_buffer_minutes: number;
  big_job_trigger_mode: 'PRICE_ONLY' | 'HOURS_ONLY' | 'PRICE_OR_HOURS' | 'FITS_IN_DAY';
  pairing_mode: 'AUTO_PAIR' | 'RESTRICTED' | 'PREFER_LIST';
}

interface Technician {
  id: string;
  name: string;
  max_stories: number | null;
  service_capabilities: {
    eligible_for_big_job_pairing?: boolean;
    [key: string]: boolean | undefined;
  } | null;
}

const TRIGGER_MODE_OPTIONS = [
  { value: 'PRICE_ONLY', label: 'Price Only', description: 'Trigger when price exceeds threshold' },
  { value: 'HOURS_ONLY', label: 'Hours Only', description: 'Trigger when estimated solo hours exceeds threshold' },
  { value: 'PRICE_OR_HOURS', label: 'Price OR Hours', description: 'Trigger when either threshold is exceeded' },
  { value: 'FITS_IN_DAY', label: 'Fits in Day (Recommended)', description: 'Trigger when job doesn\'t fit in one workday' },
];

const PAIRING_MODE_OPTIONS = [
  { value: 'AUTO_PAIR', label: 'Auto Pair', description: 'Pair any two available technicians' },
  { value: 'RESTRICTED', label: 'Restricted', description: 'Only pair eligible_for_big_job_pairing technicians' },
  { value: 'PREFER_LIST', label: 'Prefer List', description: 'Prefer specific pairs (future)' },
];

export function BigJobSettingsEditor() {
  const [settings, setSettings] = useState<BigJobSettings>({
    big_job_value_threshold: 900,
    big_job_solo_hours_threshold: null,
    auto_assign_two_techs: true,
    crew_efficiency_factor: 1.8,
    allowed_tech_pairs: [],
    workday_start_time: '09:00',
    workday_end_time: '17:00',
    workday_length_hours: 8,
    min_buffer_minutes: 30,
    big_job_trigger_mode: 'FITS_IN_DAY',
    pairing_mode: 'RESTRICTED',
  });
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [eligibleTechs, setEligibleTechs] = useState<Technician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [settingsRes, techsRes] = await Promise.all([
        supabase.from('big_job_settings').select('*').eq('id', 'default').single(),
        supabase.from('technicians').select('id, name, max_stories, service_capabilities').eq('is_active', true),
      ]);

      if (settingsRes.error && settingsRes.error.code !== 'PGRST116') {
        throw settingsRes.error;
      }
      if (techsRes.error) throw techsRes.error;

      if (settingsRes.data) {
        // Parse time values - they come as "HH:MM:SS" from DB
        const parseTime = (t: string | null) => {
          if (!t) return '09:00';
          return t.substring(0, 5); // Take only HH:MM
        };

        setSettings({
          big_job_value_threshold: settingsRes.data.big_job_value_threshold,
          big_job_solo_hours_threshold: settingsRes.data.big_job_solo_hours_threshold,
          auto_assign_two_techs: settingsRes.data.auto_assign_two_techs,
          crew_efficiency_factor: Number(settingsRes.data.crew_efficiency_factor),
          allowed_tech_pairs: (settingsRes.data.allowed_tech_pairs as string[][]) || [],
          workday_start_time: parseTime(settingsRes.data.workday_start_time),
          workday_end_time: parseTime(settingsRes.data.workday_end_time),
          workday_length_hours: Number(settingsRes.data.workday_length_hours) || 8,
          min_buffer_minutes: settingsRes.data.min_buffer_minutes || 30,
          big_job_trigger_mode: (settingsRes.data.big_job_trigger_mode as BigJobSettings['big_job_trigger_mode']) || 'FITS_IN_DAY',
          pairing_mode: (settingsRes.data.pairing_mode as BigJobSettings['pairing_mode']) || 'RESTRICTED',
        });
      }

      const techs = (techsRes.data || []).map(t => ({
        ...t,
        service_capabilities: t.service_capabilities as Technician['service_capabilities'],
      }));
      setTechnicians(techs);
      
      // Filter to techs eligible for big job pairing
      const eligible = techs.filter(t => 
        t.service_capabilities?.eligible_for_big_job_pairing === true
      );
      setEligibleTechs(eligible);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      toast.error('Failed to load big job settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('big_job_settings')
        .upsert({
          id: 'default',
          big_job_value_threshold: settings.big_job_value_threshold,
          big_job_solo_hours_threshold: settings.big_job_solo_hours_threshold,
          auto_assign_two_techs: settings.auto_assign_two_techs,
          crew_efficiency_factor: settings.crew_efficiency_factor,
          allowed_tech_pairs: settings.allowed_tech_pairs,
          workday_start_time: settings.workday_start_time + ':00',
          workday_end_time: settings.workday_end_time + ':00',
          workday_length_hours: settings.workday_length_hours,
          min_buffer_minutes: settings.min_buffer_minutes,
          big_job_trigger_mode: settings.big_job_trigger_mode,
          pairing_mode: settings.pairing_mode,
        });

      if (error) throw error;
      toast.success('Big job settings saved');
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate workday length when times change
  useEffect(() => {
    if (settings.workday_start_time && settings.workday_end_time) {
      const [startH, startM] = settings.workday_start_time.split(':').map(Number);
      const [endH, endM] = settings.workday_end_time.split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      const lengthHours = Math.max(0, (endMins - startMins) / 60);
      if (lengthHours !== settings.workday_length_hours) {
        setSettings(s => ({ ...s, workday_length_hours: lengthHours }));
      }
    }
  }, [settings.workday_start_time, settings.workday_end_time]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users2 className="w-5 h-5" />
          Big Job & Scheduling Settings
        </CardTitle>
        <CardDescription>
          Configure automatic two-person crew assignment and workday constraints
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Workday Settings */}
        <div className="space-y-4">
          <h4 className="font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Workday Configuration
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="workday_start">Workday Start</Label>
              <Input
                id="workday_start"
                type="time"
                value={settings.workday_start_time}
                onChange={(e) => setSettings({ ...settings, workday_start_time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workday_end">Workday End</Label>
              <Input
                id="workday_end"
                type="time"
                value={settings.workday_end_time}
                onChange={(e) => setSettings({ ...settings, workday_end_time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="min_buffer">Min Buffer (minutes)</Label>
              <Input
                id="min_buffer"
                type="number"
                value={settings.min_buffer_minutes}
                onChange={(e) => setSettings({ ...settings, min_buffer_minutes: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Workday length: <strong>{settings.workday_length_hours.toFixed(1)} hours</strong>
          </p>
        </div>

        <Separator />

        {/* Big Job Trigger Mode */}
        <div className="space-y-4">
          <h4 className="font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Big Job Detection
          </h4>
          
          <div className="space-y-2">
            <Label htmlFor="trigger_mode">Trigger Mode</Label>
            <Select
              value={settings.big_job_trigger_mode}
              onValueChange={(v) => setSettings({ ...settings, big_job_trigger_mode: v as BigJobSettings['big_job_trigger_mode'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_MODE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div>
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">— {opt.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Thresholds */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="value_threshold" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Price Threshold ($)
            </Label>
            <Input
              id="value_threshold"
              type="number"
              value={settings.big_job_value_threshold}
              onChange={(e) => setSettings({ ...settings, big_job_value_threshold: parseInt(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">
              Jobs at or above this value may trigger two-person crew
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hours_threshold" className="flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Solo Hours Threshold
            </Label>
            <Input
              id="hours_threshold"
              type="number"
              value={settings.big_job_solo_hours_threshold ?? ''}
              onChange={(e) => setSettings({ 
                ...settings, 
                big_job_solo_hours_threshold: e.target.value ? parseFloat(e.target.value) : null 
              })}
              placeholder="e.g., 8"
            />
            <p className="text-xs text-muted-foreground">
              Solo duration exceeding this may trigger two-person crew
            </p>
          </div>
        </div>

        {settings.big_job_trigger_mode === 'FITS_IN_DAY' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Fits in Day mode:</strong> A job is "big" if estimated solo hours &gt; 
              ({settings.workday_length_hours.toFixed(1)}h workday − {settings.min_buffer_minutes}min buffer) = {
                ((settings.workday_length_hours * 60 - settings.min_buffer_minutes) / 60).toFixed(1)
              }h available
            </AlertDescription>
          </Alert>
        )}

        <Separator />

        {/* Auto-assign toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Auto-assign Two Technicians</Label>
            <p className="text-xs text-muted-foreground">
              Automatically schedule both technicians for big jobs
            </p>
          </div>
          <Switch
            checked={settings.auto_assign_two_techs}
            onCheckedChange={(checked) => setSettings({ ...settings, auto_assign_two_techs: checked })}
          />
        </div>

        {/* Pairing Mode */}
        <div className="space-y-2">
          <Label htmlFor="pairing_mode">Pairing Mode</Label>
          <Select
            value={settings.pairing_mode}
            onValueChange={(v) => setSettings({ ...settings, pairing_mode: v as BigJobSettings['pairing_mode'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAIRING_MODE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div>
                    <span>{opt.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">— {opt.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Efficiency factor */}
        <div className="space-y-2">
          <Label htmlFor="efficiency">Crew Efficiency Factor</Label>
          <div className="flex items-center gap-4">
            <Input
              id="efficiency"
              type="number"
              step="0.1"
              min="1"
              max="3"
              value={settings.crew_efficiency_factor}
              onChange={(e) => setSettings({ ...settings, crew_efficiency_factor: parseFloat(e.target.value) || 1.8 })}
              className="w-24"
            />
            <p className="text-sm text-muted-foreground">
              A 6-hour solo job becomes {(6 / settings.crew_efficiency_factor).toFixed(1)} hours with crew
            </p>
          </div>
        </div>

        <Separator />

        {/* Eligible technicians */}
        <div className="space-y-3">
          <Label>Eligible for Big Job Pairing</Label>
          <p className="text-xs text-muted-foreground">
            Only technicians with "eligible_for_big_job_pairing" capability (in Restricted mode).
          </p>
          
          {eligibleTechs.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No technicians are marked as eligible for big job pairing. 
                Edit technician capabilities to enable this feature.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-wrap gap-2">
              {eligibleTechs.map(tech => (
                <Badge key={tech.id} variant="secondary">
                  {tech.name}
                  {tech.max_stories && (
                    <span className="text-xs opacity-70 ml-1">
                      (≤{tech.max_stories} story)
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          )}

          {eligibleTechs.length >= 2 && (
            <p className="text-xs text-green-600">
              ✓ {eligibleTechs.length} technicians eligible — any combination can be paired for big jobs
            </p>
          )}
        </div>

        <Separator />

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}