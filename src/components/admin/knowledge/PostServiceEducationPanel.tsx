import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { GraduationCap } from 'lucide-react';

interface Row {
  id: string;
  service_key: string;
  display_name: string;
  send_after_days: number;
  channel: 'email' | 'sms';
  subject: string | null;
  body: string;
  is_active: boolean;
  sort_order: number;
}

type Draft = { send_after_days: number; subject: string; body: string };

export function PostServiceEducationPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_education_content')
      .select('*')
      .order('sort_order');
    if (error) {
      toast({ title: 'Failed to load education content', description: error.message, variant: 'destructive' });
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const edit = (row: Row, patch: Partial<Draft>) => {
    setDrafts((d) => ({
      ...d,
      [row.id]: {
        send_after_days: d[row.id]?.send_after_days ?? row.send_after_days,
        subject: d[row.id]?.subject ?? row.subject ?? '',
        body: d[row.id]?.body ?? row.body,
        ...patch,
      },
    }));
  };

  const save = async (row: Row) => {
    const d = drafts[row.id];
    if (!d) return;
    const days = Math.max(0, Math.min(365, Math.round(Number(d.send_after_days) || 0)));
    const { error } = await supabase
      .from('service_education_content')
      .update({
        send_after_days: days,
        subject: d.subject.trim() || null,
        body: d.body,
      })
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
      .from('service_education_content')
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
          <GraduationCap className="w-4 h-4" /> Post-Service Education
        </CardTitle>
        <CardDescription>
          After a service is marked complete, a
          <code className="mx-1">service_completed</code>
          event is recorded. Draft content lives here; live emails only send if a matching campaign is activated.
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
                  <Badge variant="outline" className="text-[10px]">{row.channel}</Badge>
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
                  <label className="text-xs text-muted-foreground">Send after (days)</label>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={d?.send_after_days ?? row.send_after_days}
                    onChange={(e) => edit(row, { send_after_days: Number(e.target.value) })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Subject</label>
                  <Input
                    value={d?.subject ?? row.subject ?? ''}
                    onChange={(e) => edit(row, { subject: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Body</label>
                <Textarea
                  rows={4}
                  value={d?.body ?? row.body}
                  onChange={(e) => edit(row, { body: e.target.value })}
                />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No education content configured.</p>}
      </CardContent>
    </Card>
  );
}