import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CloudSun } from 'lucide-react';

type Status = 'normal' | 'monitoring' | 'delayed' | 'paused';

interface Row {
  id: string;
  status: Status;
  advisory_message: string | null;
  internal_note: string | null;
  updated_at: string;
}

const STATUS_COPY: Record<Status, { label: string; description: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  normal: { label: 'Normal', description: 'AI answers weather questions normally. No advisory shown.', variant: 'outline' },
  monitoring: { label: 'Monitoring', description: 'AI relays your advisory when weather comes up.', variant: 'secondary' },
  delayed: { label: 'Delayed', description: 'AI warns customers that appointments may run late.', variant: 'secondary' },
  paused: { label: 'Paused', description: 'AI tells customers outdoor work is on hold.', variant: 'destructive' },
};

export function WeatherStatusPanel() {
  const { toast } = useToast();
  const [row, setRow] = useState<Row | null>(null);
  const [status, setStatus] = useState<Status>('normal');
  const [advisory, setAdvisory] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('weather_status')
      .select('*')
      .eq('singleton', true)
      .maybeSingle();
    if (error) {
      toast({ title: 'Failed to load weather status', description: error.message, variant: 'destructive' });
      return;
    }
    if (data) {
      setRow(data as Row);
      setStatus((data.status as Status) ?? 'normal');
      setAdvisory(data.advisory_message ?? '');
      setNote(data.internal_note ?? '');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!row) return;
    setSaving(true);
    const { error } = await supabase
      .from('weather_status')
      .update({
        status,
        advisory_message: advisory.trim() || null,
        internal_note: note.trim() || null,
      })
      .eq('id', row.id);
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Weather status updated', description: STATUS_COPY[status].label });
    load();
  };

  const current = STATUS_COPY[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudSun className="w-4 h-4" /> Weather Status
        </CardTitle>
        <CardDescription>
          When status is not <em>normal</em>, the customer chat AI will relay your advisory verbatim
          — and cannot invent a forecast, promise a reschedule, or make its own decision about your team's schedule.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant={current.variant}>{current.label}</Badge>
          <span className="text-xs text-muted-foreground">{current.description}</span>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal — no advisory</SelectItem>
              <SelectItem value="monitoring">Monitoring — watching conditions</SelectItem>
              <SelectItem value="delayed">Delayed — appointments may run late</SelectItem>
              <SelectItem value="paused">Paused — outdoor work on hold</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Customer-safe advisory (relayed verbatim by the AI)
          </label>
          <Textarea
            rows={3}
            value={advisory}
            placeholder="e.g. Storms expected Tuesday afternoon — we'll reach out directly if your appointment is affected."
            onChange={(e) => setAdvisory(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Keep it short and factual. The AI will never invent details beyond this line.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Internal note (not shown to customers)</label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>Save weather status</Button>
        </div>
        {row?.updated_at && (
          <p className="text-[11px] text-muted-foreground">
            Last updated {new Date(row.updated_at).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}