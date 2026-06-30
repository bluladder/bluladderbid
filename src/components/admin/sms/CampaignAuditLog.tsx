import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, History, Search, ArrowRight, Bot, UserCog, Download } from 'lucide-react';
import { toast } from 'sonner';

type LifecycleStatus = 'open' | 'pending' | 'approved' | 'booked' | 'declined';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  pending: 'Pending',
  approved: 'Approved',
  booked: 'Booked',
  declined: 'Declined',
};

interface CampaignSummary { id: string; name: string }

interface AuditRow {
  id: string;
  customer_id: string | null;
  actor_id: string | null;
  source: string;
  event_type: string;
  old_status: LifecycleStatus | null;
  new_status: LifecycleStatus | null;
  campaigns_enrolled: CampaignSummary[] | null;
  messages_cancelled: number;
  messages_started: number;
  details: { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null } | null;
  created_at: string;
}

export function CampaignAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('campaign_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (sourceFilter !== 'all') query = query.eq('source', sourceFilter);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows((data as unknown as AuditRow[]) ?? []);
    setLoading(false);
  }, [sourceFilter]);

  useEffect(() => { load(); }, [load]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const d = r.details ?? {};
    return (
      (d.customer_name ?? '').toLowerCase().includes(q) ||
      (d.customer_email ?? '').toLowerCase().includes(q) ||
      (d.customer_phone ?? '').toLowerCase().includes(q)
    );
  });

  const csvCell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const matchesSearch = (r: AuditRow) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const d = r.details ?? {};
    return (
      (d.customer_name ?? '').toLowerCase().includes(q) ||
      (d.customer_email ?? '').toLowerCase().includes(q) ||
      (d.customer_phone ?? '').toLowerCase().includes(q)
    );
  };

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      // Fetch the complete timeline (not the capped 300 shown in the table),
      // honoring the active trigger filter so the export matches the view.
      let query = supabase
        .from('campaign_audit_log')
        .select('*')
        .order('created_at', { ascending: false });
      if (sourceFilter !== 'all') query = query.eq('source', sourceFilter);
      const { data, error } = await query;
      if (error) { toast.error(error.message); return; }

      const all = ((data as unknown as AuditRow[]) ?? []).filter(matchesSearch);
      if (all.length === 0) { toast.info('No entries to export.'); return; }

      const headers = [
        'Timestamp (ISO)', 'Customer name', 'Customer email', 'Customer phone',
        'Trigger', 'Event type', 'From status', 'To status',
        'Campaigns started', 'Messages started', 'Messages cancelled',
      ];
      const lines = all.map((r) => {
        const d = r.details ?? {};
        const camps = (r.campaigns_enrolled ?? []).map((c) => c.name).join('; ');
        return [
          r.created_at,
          d.customer_name ?? '',
          d.customer_email ?? '',
          d.customer_phone ?? '',
          r.source === 'admin' ? 'Manual (admin)' : 'Automatic',
          r.event_type,
          r.old_status ? STATUS_LABELS[r.old_status] : '',
          r.new_status ? STATUS_LABELS[r.new_status] : '',
          camps,
          r.messages_started,
          r.messages_cancelled,
        ].map(csvCell).join(',');
      });
      const csv = [headers.map(csvCell).join(','), ...lines].join('\r\n');

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length} ${all.length === 1 ? 'entry' : 'entries'}.`);
    } finally {
      setExporting(false);
    }
  }, [sourceFilter, search]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2"><History className="w-5 h-5" /> Campaign Audit Log</CardTitle>
            <CardDescription>
              A complete record of every status change — automatic (triggered by bids/bookings) or manual (set by an
              admin). Each entry shows what changed, which campaigns enrolled, and how many queued messages were
              cancelled or started.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All triggers</SelectItem>
                <SelectItem value="auto">Automatic</SelectItem>
                <SelectItem value="admin">Manual (admin)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} className="gap-2">
              <Download className={`w-4 h-4 ${exporting ? 'animate-pulse' : ''}`} /> Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative mb-4">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by customer name, email, or phone" className="pl-8" />
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No audit entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Campaigns started</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const d = r.details ?? {};
                  const camps = r.campaigns_enrolled ?? [];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(r.created_at)}</TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{d.customer_name || '—'}</div>
                        <div className="text-muted-foreground">{d.customer_email || d.customer_phone || ''}</div>
                      </TableCell>
                      <TableCell>
                        {r.source === 'admin' ? (
                          <Badge variant="secondary" className="gap-1"><UserCog className="w-3 h-3" /> Admin</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1"><Bot className="w-3 h-3" /> Auto</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                          <span className="text-muted-foreground">{r.old_status ? STATUS_LABELS[r.old_status] : 'None'}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium">{r.new_status ? STATUS_LABELS[r.new_status] : '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {camps.length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {camps.map((c) => (
                              <Badge key={c.id} variant="outline" className="font-normal">{c.name}</Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap">
                        {r.messages_started > 0 && (
                          <span className="text-green-600 dark:text-green-400">+{r.messages_started} started</span>
                        )}
                        {r.messages_started > 0 && r.messages_cancelled > 0 && <span className="text-muted-foreground"> · </span>}
                        {r.messages_cancelled > 0 && (
                          <span className="text-destructive">−{r.messages_cancelled} cancelled</span>
                        )}
                        {r.messages_started === 0 && r.messages_cancelled === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}