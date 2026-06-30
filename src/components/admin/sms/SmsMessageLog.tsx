import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  RefreshCw, MessageSquare, Mail, AlertTriangle, Clock, Search, X,
  CheckCircle2, XCircle, Send, RotateCw, CircleDashed, Ban, Inbox,
} from 'lucide-react';

interface SmsMessage {
  id: string;
  to_number: string;
  to_email: string | null;
  channel: 'sms' | 'email' | null;
  subject: string | null;
  body: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled' | 'inbound';
  message_kind: string | null;
  send_at: string | null;
  sent_at: string | null;
  error: string | null;
  attempts: number | null;
  max_attempts: number | null;
  next_retry_at: string | null;
  callrail_message_id: string | null;
  updated_at: string | null;
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
  const [attemptsFilter, setAttemptsFilter] = useState<string>('all');
  const [retryWindow, setRetryWindow] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SmsMessage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('sms_messages')
      .select('id,to_number,to_email,channel,subject,body,status,message_kind,send_at,sent_at,error,attempts,max_attempts,next_retry_at,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    // "retrying" is a derived state of pending messages, so query pending at the
    // DB level and refine client-side below.
    if (statusFilter === 'retrying') query = query.eq('status', 'pending');
    else if (statusFilter !== 'all') query = query.eq('status', statusFilter as SmsMessage['status']);
    const { data } = await query;
    setMessages((data as SmsMessage[]) ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  // A message is awaiting an automatic retry when it failed at least once but is
  // queued again for a future attempt.
  const isRetrying = (m: SmsMessage) =>
    m.status === 'pending' && (m.attempts ?? 0) > 0 && !!m.next_retry_at;

  const matchesAttempts = (m: SmsMessage) => {
    if (attemptsFilter === 'all') return true;
    const a = m.attempts ?? 0;
    if (attemptsFilter === '0') return a === 0;
    if (attemptsFilter === '1') return a === 1;
    if (attemptsFilter === '2') return a === 2;
    if (attemptsFilter === '3+') return a >= 3;
    return true;
  };

  const matchesRetryWindow = (m: SmsMessage) => {
    if (retryWindow === 'all') return true;
    if (!m.next_retry_at) return false;
    const t = new Date(m.next_retry_at).getTime();
    const now = Date.now();
    if (retryWindow === 'has') return true;
    if (retryWindow === 'overdue') return t < now;
    if (retryWindow === '1h') return t >= now && t <= now + 60 * 60 * 1000;
    if (retryWindow === '24h') return t >= now && t <= now + 24 * 60 * 60 * 1000;
    return true;
  };

  const matchesSearch = (m: SmsMessage) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [m.to_number, m.to_email, m.subject, m.body, m.error, m.message_kind]
      .some((v) => (v ?? '').toLowerCase().includes(q));
  };

  const filtered = messages.filter((m) => {
    if (statusFilter === 'retrying' && !isRetrying(m)) return false;
    return matchesAttempts(m) && matchesRetryWindow(m) && matchesSearch(m);
  });

  // Build a best-effort attempt timeline from the columns we persist. We do not
  // store a row per attempt, so this reconstructs the lifecycle from timestamps,
  // the attempt counter and the latest provider outcome.
  const buildTimeline = (m: SmsMessage) => {
    const events: { icon: typeof Clock; label: string; detail?: string; at: string | null; tone: string }[] = [];
    events.push({ icon: CircleDashed, label: 'Queued', detail: `Message created (${m.channel === 'email' ? 'email' : 'text'})`, at: m.created_at, tone: 'text-muted-foreground' });
    if (m.send_at) events.push({ icon: Clock, label: 'Scheduled to send', at: m.send_at, tone: 'text-muted-foreground' });
    const attempts = m.attempts ?? 0;
    if (attempts > 0) {
      for (let i = 1; i <= attempts; i++) {
        const isLast = i === attempts;
        if (isLast && m.status === 'sent') {
          events.push({ icon: CheckCircle2, label: `Attempt ${i}: delivered`, detail: m.callrail_message_id ? `Provider ID ${m.callrail_message_id}` : undefined, at: m.sent_at, tone: 'text-green-600 dark:text-green-400' });
        } else if (isLast && m.status === 'failed') {
          events.push({ icon: XCircle, label: `Attempt ${i}: failed`, detail: m.error ?? undefined, at: m.updated_at, tone: 'text-destructive' });
        } else {
          events.push({ icon: XCircle, label: `Attempt ${i}: failed`, detail: m.error ?? 'Send error', at: null, tone: 'text-amber-600 dark:text-amber-400' });
        }
      }
    } else if (m.status === 'sent') {
      events.push({ icon: CheckCircle2, label: 'Delivered', detail: m.callrail_message_id ? `Provider ID ${m.callrail_message_id}` : undefined, at: m.sent_at, tone: 'text-green-600 dark:text-green-400' });
    }
    if (isRetrying(m) && m.next_retry_at) {
      events.push({ icon: RotateCw, label: `Retry scheduled (attempt ${attempts + 1}/${m.max_attempts ?? 3})`, at: m.next_retry_at, tone: 'text-amber-600 dark:text-amber-400' });
    }
    if (m.status === 'cancelled') {
      events.push({ icon: Ban, label: 'Cancelled', detail: m.error ?? undefined, at: m.updated_at, tone: 'text-muted-foreground' });
    }
    if (m.status === 'inbound') {
      events.push({ icon: Inbox, label: 'Inbound message received', at: m.created_at, tone: 'text-blue-600 dark:text-blue-400' });
    }
    return events;
  };

  // Reconstruct the outbound payload as sent to the provider.
  const sendPayload = (m: SmsMessage) =>
    m.channel === 'email'
      ? { channel: 'email', to: m.to_email, subject: m.subject, body: m.body, message_kind: m.message_kind, scheduled_for: m.send_at }
      : { channel: 'sms', to: m.to_number, body: m.body, message_kind: m.message_kind, scheduled_for: m.send_at };

  const providerResponse = (m: SmsMessage) => ({
    status: m.status,
    provider_message_id: m.callrail_message_id,
    sent_at: m.sent_at,
    error: m.error,
    attempts: m.attempts ?? 0,
    max_attempts: m.max_attempts ?? 3,
    next_retry_at: m.next_retry_at,
  });

  const hasActiveFilters =
    statusFilter !== 'all' || attemptsFilter !== 'all' || retryWindow !== 'all' || search.trim() !== '';

  const clearFilters = () => {
    setStatusFilter('all');
    setAttemptsFilter('all');
    setRetryWindow('all');
    setSearch('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" /> Text Message Log
            </CardTitle>
            <CardDescription>Every text and email sent or queued by your campaigns.</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recipient, message, error…"
                className="h-9 w-[220px] pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="retrying">Retrying</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
              </SelectContent>
            </Select>
            <Select value={attemptsFilter} onValueChange={setAttemptsFilter}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any attempts</SelectItem>
                <SelectItem value="0">0 attempts</SelectItem>
                <SelectItem value="1">1 attempt</SelectItem>
                <SelectItem value="2">2 attempts</SelectItem>
                <SelectItem value="3+">3+ attempts</SelectItem>
              </SelectContent>
            </Select>
            <Select value={retryWindow} onValueChange={setRetryWindow}>
              <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any retry time</SelectItem>
                <SelectItem value="has">Retry scheduled</SelectItem>
                <SelectItem value="overdue">Retry overdue</SelectItem>
                <SelectItem value="1h">Retry within 1h</SelectItem>
                <SelectItem value="24h">Retry within 24h</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                <X className="w-3.5 h-3.5" /> Clear
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {messages.length === 0 ? 'No messages yet.' : 'No messages match the current filters.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-2">
              Showing {filtered.length} of {messages.length} loaded
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="min-w-[260px]">Message</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow key={m.id} className="cursor-pointer" onClick={() => setSelected(m)}>
                    <TableCell>
                      <Badge variant={isRetrying(m) ? 'secondary' : (STATUS_VARIANT[m.status] ?? 'outline')}>
                        {isRetrying(m) ? 'retrying' : m.status}
                      </Badge>
                      {m.status === 'failed' && (
                        <p className="text-[11px] text-destructive mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          Failed after {m.attempts ?? 0} attempt{(m.attempts ?? 0) === 1 ? '' : 's'}
                        </p>
                      )}
                      {m.error && (
                        <p className="text-xs text-muted-foreground mt-1 max-w-[180px] truncate" title={m.error}>{m.error}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.channel === 'email' ? (
                        <span className="flex items-center gap-1 text-xs"><Mail className="w-3.5 h-3.5" /> Email</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs"><MessageSquare className="w-3.5 h-3.5" /> Text</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{m.channel === 'email' ? m.to_email : m.to_number}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{m.message_kind ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[360px]">
                      {m.channel === 'email' && m.subject && <div className="font-medium text-foreground text-xs mb-0.5">{m.subject}</div>}
                      <div className="line-clamp-2">{m.body}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {(m.attempts ?? 0) > 0 ? (
                        <div>
                          <span className="text-muted-foreground">{m.attempts}/{m.max_attempts ?? 3}</span>
                          {isRetrying(m) && (
                            <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mt-0.5">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span title={m.next_retry_at ?? ''}>next {fmt(m.next_retry_at)}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(m.send_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(m.sent_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.channel === 'email' ? <Mail className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                  Message details
                </SheetTitle>
                <SheetDescription>
                  {selected.message_kind ?? 'message'} · queued {fmt(selected.created_at)}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={isRetrying(selected) ? 'secondary' : (STATUS_VARIANT[selected.status] ?? 'outline')}>
                      {isRetrying(selected) ? 'retrying' : selected.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {(selected.attempts ?? 0)} / {selected.max_attempts ?? 3} attempts
                    </span>
                  </div>
                </section>

                <section>
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                    <Send className="w-3.5 h-3.5" /> Send payload
                  </h4>
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(sendPayload(selected), null, 2)}
                  </pre>
                </section>

                <section>
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                    <Inbox className="w-3.5 h-3.5" /> Provider response
                  </h4>
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(providerResponse(selected), null, 2)}
                  </pre>
                  {selected.error && (
                    <p className="text-xs text-destructive mt-2 flex items-start gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {selected.error}
                    </p>
                  )}
                </section>

                <section>
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                    <Clock className="w-3.5 h-3.5" /> Attempt timeline
                  </h4>
                  <ol className="space-y-3">
                    {buildTimeline(selected).map((e, i) => {
                      const Icon = e.icon;
                      return (
                        <li key={i} className="flex gap-3">
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${e.tone}`} />
                          <div className="min-w-0">
                            <p className="text-sm leading-tight">{e.label}</p>
                            {e.detail && <p className="text-xs text-muted-foreground break-words">{e.detail}</p>}
                            <p className="text-[11px] text-muted-foreground mt-0.5">{e.at ? fmt(e.at) : 'time not recorded'}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="text-[11px] text-muted-foreground mt-3">
                    Per-attempt timestamps are reconstructed from stored counters; only the latest provider outcome is retained.
                  </p>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}