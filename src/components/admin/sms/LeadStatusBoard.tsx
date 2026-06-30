import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Users, Search, MessageSquare, Mail } from 'lucide-react';
import { toast } from 'sonner';

type LifecycleStatus = 'open' | 'pending' | 'approved' | 'booked' | 'declined';

const STATUS_LABELS: Record<LifecycleStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  approved: 'Approved',
  booked: 'Booked',
  declined: 'Declined',
};

const STATUS_VARIANT: Record<LifecycleStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'secondary',
  pending: 'default',
  approved: 'default',
  booked: 'default',
  declined: 'destructive',
};

interface Customer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  lifecycle_status: LifecycleStatus | null;
  lifecycle_changed_at: string | null;
  lifecycle_source: string | null;
  sms_paused: boolean | null;
  email_paused: boolean | null;
}

export function LeadStatusBoard() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('customers')
      .select('id,first_name,last_name,email,phone,lifecycle_status,lifecycle_changed_at,lifecycle_source,sms_paused,email_paused')
      .order('lifecycle_changed_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (statusFilter !== 'all') query = query.eq('lifecycle_status', statusFilter as LifecycleStatus);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows((data as Customer[]) ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: LifecycleStatus) => {
    setPendingId(id);
    const { error } = await supabase.rpc('admin_set_lifecycle', { p_customer_id: id, p_status: status });
    setPendingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Moved to ${STATUS_LABELS[status]} — campaign re-enrolled`);
    load();
  };

  const togglePause = async (c: Customer, channel: 'sms' | 'email') => {
    const col = channel === 'sms' ? 'sms_paused' : 'email_paused';
    const next = !(channel === 'sms' ? c.sms_paused : c.email_paused);
    const updates: Record<string, boolean> = { [col]: next };
    // Optimistic update
    setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, [col]: next } : r)));
    const { error } = await supabase.from('customers').update(updates).eq('id', c.id);
    if (error) {
      toast.error(error.message);
      setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, [col]: !next } : r)));
      return;
    }
    const label = channel === 'sms' ? 'Texting' : 'Email';
    toast.success(next ? `${label} paused for this lead` : `${label} resumed for this lead`);
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      `${r.first_name ?? ''} ${r.last_name ?? ''}`.toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q) ||
      (r.phone ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Lead Status Board</CardTitle>
            <CardDescription>
              Each customer's status drives which lifecycle campaigns they receive. Status updates automatically as bids
              and bookings change — or move someone manually here to re-enroll them. Use the Messaging toggles to pause
              texts or emails for one lead without affecting your campaigns.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(STATUS_LABELS) as LifecycleStatus[]).map((k) => (
                  <SelectItem key={k} value={k}>{STATUS_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative mb-4">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, or phone" className="pl-8" />
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No customers found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Messaging</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Move to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{c.email ?? '—'}</div>
                      <div className="font-mono">{c.phone ?? '—'}</div>
                    </TableCell>
                    <TableCell>
                      {c.lifecycle_status ? (
                        <Badge variant={STATUS_VARIANT[c.lifecycle_status]}>{STATUS_LABELS[c.lifecycle_status]}</Badge>
                      ) : (
                        <Badge variant="outline">None</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant={c.sms_paused ? 'destructive' : 'outline'}
                          size="sm"
                          className="h-7 px-2"
                          title={c.sms_paused ? 'Texting paused — click to resume' : 'Texting active — click to pause'}
                          onClick={() => togglePause(c, 'sms')}
                        >
                          <MessageSquare className="w-3.5 h-3.5 mr-1" />
                          {c.sms_paused ? 'Paused' : 'On'}
                        </Button>
                        <Button
                          variant={c.email_paused ? 'destructive' : 'outline'}
                          size="sm"
                          className="h-7 px-2"
                          title={c.email_paused ? 'Email paused — click to resume' : 'Email active — click to pause'}
                          onClick={() => togglePause(c, 'email')}
                        >
                          <Mail className="w-3.5 h-3.5 mr-1" />
                          {c.email_paused ? 'Paused' : 'On'}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmt(c.lifecycle_changed_at)}
                      {c.lifecycle_source && <span className="ml-1">({c.lifecycle_source})</span>}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={c.lifecycle_status ?? undefined}
                        onValueChange={(v) => setStatus(c.id, v as LifecycleStatus)}
                        disabled={pendingId === c.id}
                      >
                        <SelectTrigger className="h-8 w-[130px]"><SelectValue placeholder="Set status" /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(STATUS_LABELS) as LifecycleStatus[]).map((k) => (
                            <SelectItem key={k} value={k}>{STATUS_LABELS[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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