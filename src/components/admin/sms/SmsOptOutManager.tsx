import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Ban, BellOff, BellRing, ShieldX } from 'lucide-react';
import { toast } from 'sonner';

interface OptOut {
  id: string;
  phone: string;
  opted_out: boolean;
  source: string;
  reason: string | null;
  opted_out_at: string | null;
  opted_in_at: string | null;
  updated_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  customer_reply: 'Replied STOP',
  customer_portal: 'Customer portal',
  admin: 'Added by admin',
};

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\+\d{10,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function SmsOptOutManager() {
  const [rows, setRows] = useState<OptOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sms_opt_outs')
      .select('id,phone,opted_out,source,reason,opted_out_at,opted_in_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) toast.error('Failed to load opt-outs');
    setRows((data as OptOut[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addOptOut = async () => {
    const phone = normalizePhone(newPhone);
    if (!phone) {
      toast.error('Enter a valid 10-digit US phone number');
      return;
    }
    setAdding(true);
    const { error } = await supabase.from('sms_opt_outs').upsert({
      phone, opted_out: true, source: 'admin',
      reason: 'Added by admin', opted_out_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
    if (error) {
      toast.error('Could not add opt-out');
    } else {
      toast.success(`${phone} will no longer receive texts`);
      setNewPhone('');
      load();
    }
    setAdding(false);
  };

  const toggle = async (row: OptOut) => {
    const next = !row.opted_out;
    const { error } = await supabase.from('sms_opt_outs').update({
      opted_out: next,
      source: 'admin',
      reason: next ? 'Suppressed by admin' : 'Re-subscribed by admin',
      opted_out_at: next ? new Date().toISOString() : row.opted_out_at,
      opted_in_at: next ? row.opted_in_at : new Date().toISOString(),
    }).eq('id', row.id);
    if (error) {
      toast.error('Update failed');
      return;
    }
    toast.success(next ? `${row.phone} suppressed` : `${row.phone} re-subscribed`);
    load();
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  const optedOutCount = rows.filter((r) => r.opted_out).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldX className="w-5 h-5" /> Opt-Out Management
            </CardTitle>
            <CardDescription>
              {optedOutCount} number{optedOutCount === 1 ? '' : 's'} currently suppressed. Customers who reply STOP are added automatically.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Manually suppress a number</label>
            <Input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="(469) 747-2877"
              onKeyDown={(e) => e.key === 'Enter' && addOptOut()}
            />
          </div>
          <Button onClick={addOptOut} disabled={adding}>
            <Ban className="w-4 h-4 mr-2" /> Add opt-out
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No opt-out records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.opted_out
                        ? <Badge variant="destructive">Opted out</Badge>
                        : <Badge variant="default">Subscribed</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.phone}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {SOURCE_LABEL[r.source] ?? r.source}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => toggle(r)}>
                        {r.opted_out
                          ? <><BellRing className="w-3.5 h-3.5 mr-1.5" /> Re-subscribe</>
                          : <><BellOff className="w-3.5 h-3.5 mr-1.5" /> Suppress</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
