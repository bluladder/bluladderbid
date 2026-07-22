import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Repeat } from 'lucide-react';

interface Row {
  id: string;
  service_key: string;
  display_name: string;
  interval_days: number;
  advisory: string | null;
  is_active: boolean;
  sort_order: number;
}

type Draft = { interval_days: number; advisory: string };

export function MaintenanceIntervalsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_maintenance_intervals')
      .select('*')
      .order('sort_order');
    if (error) {
      toast({ title: 'Failed to load intervals', description: error.message, variant: 'destructive' });
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const edit = (row: Row, patch: Partial<Draft>) => {
    setDrafts((d) => ({
      ...d,
      [row.id]: {
        interval_days: d[row.id]?.interval_days ?? row.interval_days,
        advisory: d[row.id]?.advisory ?? row.advisory ?? '',
        ...patch,
      },
    }));
  };

  const save = async (row: Row) => {
    const d = drafts[row.id];
    if (!d) return;
    const days = Math.max(1, Math.min(3650, Math.round(Number(d.interval_days) || 0)));
    const { error } = await supabase
      .from('service_maintenance_intervals')
      .update({ interval_days: days, advisory: d.advisory.trim() || null })
      .eq('id', row.id);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Saved', description: row.display_name });
    setDrafts((s) => { const n = { ...s }; delete n[row.id]; return n; });
    load();
  };

  const toggle = async (row: Row) => {
    const { error } = await supabase
      .from('service_maintenance_intervals')
      .update({ is_active: !row.is_active })
      .eq('id', row.id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Repeat className="w-4 h-4" /> Maintenance / Rebooking Intervals
        </CardTitle>
        <CardDescription>
          When a service passes its interval, the campaign engine records a
          <code className="mx-1">maintenance_due</code>
          event so a future rebooking campaign can enroll the customer.
          No live message is sent unless a campaign is activated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => {
          const d = drafts[row.id];
          const dirty = d !== undefined;
          return (
            <div key={row.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{row.display_name}</span>
                  <Badge variant="outline" className="text-[10px]">{row.service_key}</Badge>
                  {!row.is_active && <Badge variant="outline" className="text-[10px]">inactive</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => toggle(row)}>
                    {row.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                  {dirty && <Button size="sm" onClick={() => save(row)}>Save</Button>}
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <label className="text-xs text-muted-foreground">Interval (days)</label>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    value={d?.interval_days ?? row.interval_days}
                    onChange={(e) => edit(row, { interval_days: Number(e.target.value) })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Advisory (internal reminder)</label>
                  <Textarea
                    rows={2}
                    value={d?.advisory ?? row.advisory ?? ''}
                    onChange={(e) => edit(row, { advisory: e.target.value })}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No intervals configured.</p>}
      </CardContent>
    </Card>
  );
}