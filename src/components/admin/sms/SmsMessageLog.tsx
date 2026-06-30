import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, MessageSquare } from 'lucide-react';

interface SmsMessage {
  id: string;
  to_number: string;
  body: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  message_kind: string | null;
  send_at: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sent: 'default',
  pending: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
  inbound: 'secondary',
};

export function SmsMessageLog() {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('sms_messages')
      .select('id,to_number,body,status,message_kind,send_at,sent_at,error,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter as SmsMessage['status']);
    const { data } = await query;
    setMessages((data as SmsMessage[]) ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" /> Text Message Log
            </CardTitle>
            <CardDescription>Every text sent or queued through CallRail.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No messages yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="min-w-[260px]">Message</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[m.status] ?? 'outline'}>{m.status}</Badge>
                      {m.error && <p className="text-xs text-destructive mt-1 max-w-[160px] truncate" title={m.error}>{m.error}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{m.to_number}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{m.message_kind ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[360px]">{m.body}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(m.send_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(m.sent_at)}</TableCell>
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