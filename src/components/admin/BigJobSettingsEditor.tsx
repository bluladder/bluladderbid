import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Users2, DollarSign, Gauge, Save, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface BigJobSettings {
  big_job_value_threshold: number;
  big_job_solo_hours_threshold: number | null;
  auto_assign_two_techs: boolean;
  crew_efficiency_factor: number;
  allowed_tech_pairs: string[][];
}

interface Technician {
  id: string;
  name: string;
  service_capabilities: {
    eligible_for_big_job_pairing?: boolean;
    [key: string]: boolean | undefined;
  } | null;
}

export function BigJobSettingsEditor() {
  const [settings, setSettings] = useState<BigJobSettings>({
    big_job_value_threshold: 900,
    big_job_solo_hours_threshold: null,
    auto_assign_two_techs: true,
    crew_efficiency_factor: 1.8,
    allowed_tech_pairs: [],
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
        supabase.from('technicians').select('id, name, service_capabilities').eq('is_active', true),
      ]);

      if (settingsRes.error && settingsRes.error.code !== 'PGRST116') {
        throw settingsRes.error;
      }
      if (techsRes.error) throw techsRes.error;

      if (settingsRes.data) {
        setSettings({
          big_job_value_threshold: settingsRes.data.big_job_value_threshold,
          big_job_solo_hours_threshold: settingsRes.data.big_job_solo_hours_threshold,
          auto_assign_two_techs: settingsRes.data.auto_assign_two_techs,
          crew_efficiency_factor: Number(settingsRes.data.crew_efficiency_factor),
          allowed_tech_pairs: (settingsRes.data.allowed_tech_pairs as string[][]) || [],
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
          Big Job Settings
        </CardTitle>
        <CardDescription>
          Configure automatic two-person crew assignment for large jobs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Thresholds */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="value_threshold" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Value Threshold ($)
            </Label>
            <Input
              id="value_threshold"
              type="number"
              value={settings.big_job_value_threshold}
              onChange={(e) => setSettings({ ...settings, big_job_value_threshold: parseInt(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">
              Jobs at or above this value trigger two-person crew
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hours_threshold" className="flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Solo Hours Threshold (optional)
            </Label>
            <Input
              id="hours_threshold"
              type="number"
              value={settings.big_job_solo_hours_threshold ?? ''}
              onChange={(e) => setSettings({ 
                ...settings, 
                big_job_solo_hours_threshold: e.target.value ? parseFloat(e.target.value) : null 
              })}
              placeholder="e.g., 6"
            />
            <p className="text-xs text-muted-foreground">
              Alternative trigger: solo duration exceeds this many hours
            </p>
          </div>
        </div>

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
            Only technicians with the "eligible_for_big_job_pairing" capability will be considered.
            Edit this in the Technician settings.
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
