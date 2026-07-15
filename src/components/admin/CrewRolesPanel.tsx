import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ShieldCheck, Users, Truck } from 'lucide-react';

type Role = 'crew_leader' | 'junior_technician' | 'inactive';

interface TechRow {
  id: string;
  name: string;
  is_active: boolean;
  role: Role;
  customer_bookable_lead: boolean;
  has_company_vehicle: boolean;
  max_crew_size: number | null;
  public_display_name: string | null;
}

interface CrewConfig {
  id: string;
  hide_technician_names: boolean;
  default_public_crew_label: string;
  productivity_multipliers: Record<string, number>;
  crew_size_min: number;
  crew_size_max: number;
}

const DEFAULT_MULTIPLIERS: Record<string, number> = { '1': 1.0, '2': 1.8, '3': 2.5, '4': 3.1, '5': 3.6 };

export function CrewRolesPanel() {
  const [techs, setTechs] = useState<TechRow[]>([]);
  const [config, setConfig] = useState<CrewConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [multEdits, setMultEdits] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from('technicians').select('id,name,is_active,role,customer_bookable_lead,has_company_vehicle,max_crew_size,public_display_name').order('name'),
      supabase.from('crew_config').select('*').maybeSingle(),
    ]);
    setTechs((t as unknown as TechRow[]) || []);
    const cfg = (c as unknown as CrewConfig) || null;
    setConfig(cfg);
    if (cfg?.productivity_multipliers) {
      const edits: Record<string, string> = {};
      for (const k of Object.keys(DEFAULT_MULTIPLIERS)) {
        edits[k] = String(cfg.productivity_multipliers[k] ?? DEFAULT_MULTIPLIERS[k]);
      }
      setMultEdits(edits);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateTech = async (id: string, patch: Partial<TechRow>) => {
    // Optimistic
    setTechs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from('technicians').update(patch).eq('id', id);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      load();
    } else {
      toast.success('Updated');
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    const mults: Record<string, number> = {};
    for (const [k, v] of Object.entries(multEdits)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) mults[k] = n;
    }
    const { error } = await supabase.from('crew_config').update({
      hide_technician_names: config.hide_technician_names,
      default_public_crew_label: config.default_public_crew_label,
      productivity_multipliers: mults,
    }).eq('id', config.id);
    setSavingConfig(false);
    if (error) toast.error(`Save failed: ${error.message}`);
    else { toast.success('Crew settings saved'); load(); }
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading crew roles…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="w-5 h-5 text-primary" /> Crew Roles</CardTitle>
          <CardDescription>
            Only <strong>customer-bookable leads</strong> anchor customer-facing availability. Junior technicians are hidden capacity — they can support a leader but never create a slot on their own. Max crew size includes the leader (1–5).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Technician</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Bookable Lead</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Max Crew Size</TableHead>
                <TableHead>Public Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {techs.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    {!t.is_active && <Badge variant="outline" className="mt-1">Inactive</Badge>}
                  </TableCell>
                  <TableCell>
                    <Select value={t.role} onValueChange={(v) => updateTech(t.id, { role: v as Role })}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="crew_leader">Crew Leader</SelectItem>
                        <SelectItem value="junior_technician">Junior</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={t.customer_bookable_lead}
                      onCheckedChange={(v) => updateTech(t.id, {
                        customer_bookable_lead: v,
                        // sensible default when promoting
                        max_crew_size: v ? (t.max_crew_size || 2) : t.max_crew_size,
                      })}
                      disabled={t.role !== 'crew_leader'}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={t.has_company_vehicle} onCheckedChange={(v) => updateTech(t.id, { has_company_vehicle: v })} />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={t.max_crew_size ? String(t.max_crew_size) : '1'}
                      onValueChange={(v) => updateTech(t.id, { max_crew_size: Number(v) })}
                      disabled={!t.customer_bookable_lead}
                    >
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={t.public_display_name ?? ''}
                      placeholder="—"
                      className="w-40"
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== t.public_display_name) updateTech(t.id, { public_display_name: v });
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Users className="w-5 h-5 text-primary" /> Public Crew Label & Productivity</CardTitle>
            <CardDescription>Customers never see technician names. Choose the label and how much faster larger crews complete a job.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between border rounded-md p-3">
              <div>
                <Label className="font-medium">Hide technician names publicly</Label>
                <p className="text-xs text-muted-foreground">When on, customers only see the generic crew label below.</p>
              </div>
              <Switch checked={config.hide_technician_names} onCheckedChange={(v) => setConfig({ ...config, hide_technician_names: v })} />
            </div>

            <div>
              <Label>Default public crew label</Label>
              <Input value={config.default_public_crew_label} onChange={(e) => setConfig({ ...config, default_public_crew_label: e.target.value })} />
            </div>

            <div>
              <Label className="flex items-center gap-2"><Truck className="w-4 h-4" /> Productivity multipliers</Label>
              <p className="text-xs text-muted-foreground mb-2">1 tech = baseline. Higher values shorten calculated duration.</p>
              <div className="grid grid-cols-5 gap-2">
                {['1','2','3','4','5'].map((k) => (
                  <div key={k}>
                    <div className="text-xs text-muted-foreground text-center">{k} tech</div>
                    <Input value={multEdits[k] ?? ''} onChange={(e) => setMultEdits((p) => ({ ...p, [k]: e.target.value }))} className="text-center" />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={saveConfig} disabled={savingConfig}>Save crew settings</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
