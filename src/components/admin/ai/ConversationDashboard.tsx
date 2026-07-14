import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useAuth } from '@/hooks/useAuth';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { MessageSquare, Copy, UserCheck, CheckCircle2, RotateCcw, AlertTriangle, Bot, User, Search, Phone, Mail, Send, PhoneCall, Bell, Headset } from 'lucide-react';
import { DashboardFilter, FILTER_LABELS, matchesFilter, isAbandoned } from './conversationFilters';
import { LiveJobberTestPanel } from './LiveJobberTestPanel';
import type { ConvoLike } from './liveJobberTest';
import type { Tables } from '@/integrations/supabase/types';

type Convo = Tables<'chat_conversations'>;
// Narrow helpers for the Json columns we read.
const svcList = (c: Convo): string[] => (Array.isArray(c.services_discussed) ? (c.services_discussed as string[]) : []);
const quoteFacts = (c: Convo): { total?: number | null; status?: string | null } =>
  ((c.facts as { quote?: { total?: number | null; status?: string | null } } | null)?.quote) ?? {};
type ChatMsg = { id: string; role: string; content: string | null; created_at: string; tool_name?: string | null };

const FILTERS: DashboardFilter[] = [
  'all', 'new', 'active', 'quote_ready', 'manual_review', 'callback_requested',
  'awaiting_confirmation', 'booked', 'abandoned', 'staff_takeover', 'needs_attention', 'resolved',
];

function stateBadgeVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'booked') return 'default';
  if (state === 'manual_review' || state === 'error_recovery' || state === 'staff_takeover') return 'destructive';
  if (state === 'awaiting_booking_confirmation' || state === 'quote_ready') return 'secondary';
  return 'outline';
}

export function ConversationDashboard() {
  const { user } = useAuth();
  const { canViewAnalytics, isReadOnly, canOverrideBookings } = useAdminPermissions();
  const [convos, setConvos] = useState<Convo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [events, setEvents] = useState<{ id: string; event_name: string; created_at: string }[]>([]);
  const [notesDraft, setNotesDraft] = useState('');
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [takeoverReason, setTakeoverReason] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [replyChannel, setReplyChannel] = useState<'sms' | 'email' | 'call'>('sms');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyDiag, setReplyDiag] = useState<{ correlationId?: string; detail?: string; category?: string; channel?: string; from?: string; to?: string; retryable?: boolean } | null>(null);
  const [authorizingTest, setAuthorizingTest] = useState(false);
  const [returnAiOpen, setReturnAiOpen] = useState(false);
  const [testNotifyOpen, setTestNotifyOpen] = useState(false);
  const [testNotifyBusy, setTestNotifyBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('chat_conversations')
      .select('*')
      .order('last_activity_at', { ascending: false })
      .limit(500);
    if (error) toast({ title: 'Failed to load conversations', description: error.message, variant: 'destructive' });
    setConvos(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (canViewAnalytics) load(); }, [canViewAnalytics, load]);

  const selected = useMemo(() => convos.find((c) => c.id === selectedId) ?? null, [convos, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setNotesDraft(selected?.internal_notes ?? '');
    (async () => {
      const [{ data: msgs }, { data: ev }] = await Promise.all([
        supabase.from('chat_messages').select('id, role, content, created_at, tool_name')
          .eq('conversation_id', selectedId).order('created_at', { ascending: true }).limit(500),
        supabase.from('campaign_events').select('id, event_name, created_at')
          .eq('conversation_id', selectedId).order('created_at', { ascending: false }).limit(50),
      ]);
      setMessages((msgs ?? []) as ChatMsg[]);
      setEvents(ev ?? []);
    })();
  }, [selectedId, selected?.internal_notes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return convos.filter((c) => {
      if (!matchesFilter(c, filter)) return false;
      if (!q) return true;
      const hay = [
        c.prospect_name, c.prospect_email, c.prospect_phone, c.service_address,
        c.conversation_state, c.ai_summary, svcList(c).join(' '),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [convos, filter, search]);

  const counts = useMemo(() => {
    const m: Partial<Record<DashboardFilter, number>> = {};
    for (const f of FILTERS) m[f] = convos.filter((c) => matchesFilter(c, f)).length;
    return m;
  }, [convos]);

  const patchSelected = async (patch: Record<string, unknown>, successMsg: string) => {
    if (!selectedId) return;
    const { error } = await supabase.from('chat_conversations').update(patch).eq('id', selectedId);
    if (error) { toast({ title: 'Update failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: successMsg });
    setConvos((prev) => prev.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)));
  };

  const saveNotes = () => patchSelected({ internal_notes: notesDraft }, 'Internal note saved');
  const assignToMe = () => patchSelected({ assigned_admin: user?.id ?? null }, 'Assigned to you');
  const markResolved = () => patchSelected({ resolved: true, needs_attention: false }, 'Marked resolved');
  const reopen = () => patchSelected({ resolved: false }, 'Reopened');

  const submitTakeover = async () => {
    if (!selected) return;
    if (!takeoverReason.trim()) { toast({ title: 'A reason is required', variant: 'destructive' }); return; }
    const { data, error } = await supabase.functions.invoke('campaign-event', {
      body: {
        event_name: 'manual_staff_takeover',
        conversation_id: selected.id, email: selected.prospect_email, phone: selected.prospect_phone,
        source: 'admin_ui', metadata: { reason: takeoverReason.trim() },
      },
    });
    if (error) { toast({ title: 'Takeover failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Takeover recorded — ${data?.stopped ?? 0} enrollment(s) paused` });
    setTakeoverOpen(false); setTakeoverReason(''); load();
  };

  const copySummary = () => {
    if (!selected) return;
    const q = quoteFacts(selected);
    const lines = [
      `BluLadder AI conversation`,
      `Prospect: ${selected.prospect_name ?? '—'} | ${selected.prospect_email ?? '—'} | ${selected.prospect_phone ?? '—'}`,
      `State: ${selected.conversation_state}`,
      `Address: ${selected.service_address ?? '—'} (${selected.service_area_status ?? 'not validated'})`,
      `Services: ${svcList(selected).join(', ') || '—'}`,
      selected.ai_summary ? `Summary: ${selected.ai_summary}` : '',
      q.total != null ? `Quote total: $${q.total}` : '',
    ].filter(Boolean);
    navigator.clipboard?.writeText(lines.join('\n'));
    toast({ title: 'Summary copied' });
  };

  // ---- Defect 4: staff takeover human reply composer -----------------------
  const inTakeover = !!selected?.staff_takeover_at || selected?.conversation_state === 'staff_takeover';

  // Refresh the transcript so the outbound staff message (sent OR "would have
  // sent") appears immediately in the timeline.
  const refreshTranscript = async (id: string) => {
    const { data: msgs } = await supabase.from('chat_messages')
      .select('id, role, content, created_at, tool_name')
      .eq('conversation_id', id).order('created_at', { ascending: true }).limit(500);
    setMessages((msgs ?? []) as ChatMsg[]);
  };

  const sendReply = async (useTestAuthorization = false) => {
    if (!selected) return;
    if (replyChannel === 'call') return; // call is a click-to-call action, not a send
    const msg = replyDraft.trim();
    if (!msg) { toast({ title: 'Write a reply first', variant: 'destructive' }); return; }
    setSendingReply(true);
    setReplyDiag(null);
    const chan = replyChannel;
    try {
      const { data, error } = await supabase.functions.invoke('staff-reply', {
        body: { conversationId: selected.id, channel: chan, message: msg, useTestAuthorization },
      });
      // Non-2xx (auth / eligibility / validation): read the real reason from context.
      if (error) {
        let detail = error.message;
        let correlationId: string | undefined;
        if (error instanceof FunctionsHttpError) {
          try {
            const parsed = JSON.parse(await error.context.text());
            detail = parsed?.message || detail;
            correlationId = parsed?.correlationId;
          } catch { /* keep generic */ }
        }
        setReplyDiag({ correlationId, detail, channel: chan });
        toast({ title: 'Reply not sent', description: detail, variant: 'destructive' });
        return;
      }
      const d = data as {
        ok?: boolean; status?: string; deliveryState?: string; reason?: string;
        message?: string; wouldHaveSent?: boolean; correlationId?: string; errorCode?: string;
        failureCategory?: string; retryable?: boolean; from?: string; to?: string;
      } | null;
      // Handled non-delivery outcomes come back 2xx with ok:false + a safe message.
      if (d && d.ok === false) {
        setReplyDiag({
          correlationId: d.correlationId,
          detail: d.message ?? `${d.errorCode ?? d.status ?? 'error'}`,
          category: d.failureCategory ?? d.errorCode ?? d.status,
          channel: chan,
          from: d.from,
          to: d.to,
          retryable: d.retryable,
        });
        if (d.status === 'suppressed') {
          toast({ title: 'Recorded as "would have sent"', description: d.message ?? 'Recipient is protected by test suppression.' });
          await refreshTranscript(selected.id);
        } else {
          toast({ title: `${chan.toUpperCase()} not sent`, description: d.message ?? 'The message could not be delivered.', variant: 'destructive' });
        }
        return;
      }
      toast({ title: `Reply sent by ${chan.toUpperCase()}`, description: d?.correlationId ? `Ref ${d.correlationId.slice(0, 8)}` : undefined });
      setReplyDraft('');
      setReplyDiag(null);
      await refreshTranscript(selected.id);
    } finally { setSendingReply(false); }
  };

  // Operations-admin: authorize exactly ONE real reply to a protected test
  // identity, then send it. The authorization is single-use and short-lived.
  const authorizeAndSendTestReply = async () => {
    if (!selected || replyChannel === 'call') return;
    setAuthorizingTest(true);
    try {
      // Cast: RPC is newly added and may not yet be in generated types.
      const { error } = await (supabase.rpc as unknown as (
        fn: string, args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>)('authorize_staff_test_reply', {
        p_conversation_id: selected.id, p_channel: replyChannel,
      });
      if (error) { toast({ title: 'Authorization failed', description: error.message, variant: 'destructive' }); return; }
      await sendReply(true);
    } finally { setAuthorizingTest(false); }
  };

  const returnToAi = async () => {
    if (!selected) return;
    const { error } = await supabase.from('chat_conversations')
      .update({ staff_takeover_at: null, staff_takeover_reason: null })
      .eq('id', selected.id);
    if (error) { toast({ title: 'Failed to return to AI', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Conversation returned to AI', description: 'Automation resumes on the next customer message.' });
    setReturnAiOpen(false);
    setConvos((prev) => prev.map((c) => (c.id === selected.id ? { ...c, staff_takeover_at: null } : c)));
    load();
  };

  const runTestNotify = async () => {
    setTestNotifyBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('escalation-test-notify', { body: { confirm: true } });
      if (error) { toast({ title: 'Test notification failed', description: error.message, variant: 'destructive' }); return; }
      const d = data as {
        sms?: { status?: string; error?: string };
        email?: { status?: string; error?: string; category?: string; from?: string };
      } | null;
      const emailOk = d?.email?.status === 'sent';
      const emailLine = emailOk
        ? `Email: sent${d?.email?.from ? ` (from ${d.email.from})` : ''}`
        : `Email: ${d?.email?.status ?? '—'}${d?.email?.error ? ` — ${d.email.error}` : ''}`;
      toast({
        title: 'Escalation test result',
        description: `SMS: ${d?.sms?.status ?? '—'} · ${emailLine}`,
        variant: emailOk || d?.sms?.status === 'sent' ? undefined : 'destructive',
      });
      setTestNotifyOpen(false);
    } finally { setTestNotifyBusy(false); }
  };

  if (!canViewAnalytics) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">You do not have permission to view AI conversations.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2"><Bot className="w-5 h-5" /> AI Conversations</CardTitle>
              <CardDescription>Live view of website-chat prospects, their deterministic state, and handoff tools.</CardDescription>
            </div>
            {canOverrideBookings && (
              <Button size="sm" variant="outline" onClick={() => setTestNotifyOpen(true)}>
                <Bell className="w-3.5 h-3.5 mr-1" /> Test escalation alert
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone, address, service…" className="pl-8" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Badge key={f} variant={filter === f ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setFilter(f)}>
                {FILTER_LABELS[f]} {counts[f] ? <span className="ml-1 opacity-70">{counts[f]}</span> : null}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* List */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              {loading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
              {!loading && filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No conversations.</p>}
              <ul className="divide-y divide-border">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${selectedId === c.id ? 'bg-muted' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{c.prospect_name || c.prospect_email || 'Anonymous visitor'}</span>
                        <Badge variant={stateBadgeVariant(c.conversation_state)} className="shrink-0 text-[10px]">{c.conversation_state}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{c.ai_summary || svcList(c).join(', ') || 'No summary yet'}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {c.needs_attention && <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="w-3 h-3" />Attention</Badge>}
                        {isAbandoned(c) && <Badge variant="outline" className="text-[10px]">Abandoned</Badge>}
                        <span className="text-[10px] text-muted-foreground">{c.last_activity_at ? new Date(c.last_activity_at).toLocaleString() : ''}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail */}
        <Card>
          {!selected ? (
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Select a conversation to view details.
            </CardContent>
          ) : (
            <CardContent className="p-4 space-y-4">
              {/* Header + actions */}
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{selected.prospect_name || 'Anonymous visitor'}</h3>
                    <Badge variant={stateBadgeVariant(selected.conversation_state)}>{selected.conversation_state}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{selected.prospect_email || '—'} · {selected.prospect_phone || '—'}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={copySummary}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
                  {!isReadOnly && <Button size="sm" variant="outline" onClick={assignToMe}><UserCheck className="w-3.5 h-3.5 mr-1" />Assign me</Button>}
                  {!isReadOnly && (selected.resolved
                    ? <Button size="sm" variant="outline" onClick={reopen}><RotateCcw className="w-3.5 h-3.5 mr-1" />Reopen</Button>
                    : <Button size="sm" variant="outline" onClick={markResolved}><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Resolve</Button>)}
                  {!isReadOnly && selected.conversation_state !== 'staff_takeover' &&
                    <Button size="sm" variant="destructive" onClick={() => setTakeoverOpen(true)}>Take over</Button>}
                  {!isReadOnly && inTakeover &&
                    <Button size="sm" variant="outline" onClick={() => setReturnAiOpen(true)}><RotateCcw className="w-3.5 h-3.5 mr-1" />Return to AI</Button>}
                </div>
              </div>

              {selected.ai_summary && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground mb-1">AI summary (transcript is authoritative)</p>
                  {selected.ai_summary}
                </div>
              )}

              {/* Facts grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Fact label="Address" value={selected.service_address} />
                <Fact label="Service area" value={selected.service_area_status} />
                <Fact label="Services" value={svcList(selected).join(', ')} />
                <Fact label="Booking" value={selected.booking_status} />
                <Fact label="Quote total" value={quoteFacts(selected).total != null ? `$${quoteFacts(selected).total}` : quoteFacts(selected).status} />
                <Fact label="Pricing version" value={selected.pricing_version} />
                <Fact label="Selected slot" value={selected.selected_slot_id} />
                <Fact label="Marketing consent" value={selected.marketing_consent ? 'granted' : 'no'} />
                <Fact label="Manual review" value={selected.manual_review_reason} />
                <Fact label="Callback" value={selected.callback_requested ? 'requested' : 'no'} />
              </div>

              {selected.staff_takeover_at && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs">
                  Staff takeover recorded {new Date(selected.staff_takeover_at).toLocaleString()} — {selected.staff_takeover_reason}
                </div>
              )}

              {/* Defect 4: human reply composer — only after takeover. Customer-visible. */}
              {!isReadOnly && inTakeover && (
                <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Headset className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">Reply to customer (visible to customer)</span>
                  </div>
                  {/* Channel selector */}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant={replyChannel === 'sms' ? 'default' : 'outline'} onClick={() => setReplyChannel('sms')} disabled={!selected.prospect_phone}>
                      <Phone className="w-3.5 h-3.5 mr-1" />SMS
                    </Button>
                    <Button size="sm" variant={replyChannel === 'email' ? 'default' : 'outline'} onClick={() => setReplyChannel('email')} disabled={!selected.prospect_email}>
                      <Mail className="w-3.5 h-3.5 mr-1" />Email
                    </Button>
                    <Button size="sm" variant={replyChannel === 'call' ? 'default' : 'outline'} onClick={() => setReplyChannel('call')} disabled={!selected.prospect_phone}>
                      <PhoneCall className="w-3.5 h-3.5 mr-1" />Call
                    </Button>
                  </div>
                  {/* Sending identity / recipient shown before sending */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {replyChannel === 'sms' && <span>To {selected.prospect_phone || '—'} · sent from the BluLadder app number (469) 747-2877</span>}
                    {replyChannel === 'email' && <span>To {selected.prospect_email || '—'} · sent from BluLadder</span>}
                    {replyChannel === 'call' && <span>Customer phone: {selected.prospect_phone || '—'}</span>}
                    {selected.prospect_phone && (
                      <button className="underline hover:text-foreground" onClick={() => { navigator.clipboard?.writeText(selected.prospect_phone || ''); toast({ title: 'Phone copied' }); }}>Copy phone</button>
                    )}
                  </div>
                  {replyChannel === 'call' ? (
                    <Button size="sm" asChild disabled={!selected.prospect_phone}>
                      <a href={`tel:${selected.prospect_phone ?? ''}`}><PhoneCall className="w-3.5 h-3.5 mr-1" />Call {selected.prospect_phone || 'customer'}</a>
                    </Button>
                  ) : (
                    <>
                      <Textarea value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} rows={3} placeholder={`Type your ${replyChannel.toUpperCase()} reply to the customer…`} />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground">Opt-outs and suppression are respected automatically. This is not an internal note.</span>
                        <Button size="sm" disabled={sendingReply} onClick={() => sendReply()}>
                          <Send className="w-3.5 h-3.5 mr-1" />{sendingReply ? 'Sending…' : `Send ${replyChannel.toUpperCase()}`}
                        </Button>
                      </div>
                      {replyDiag && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] space-y-1">
                          <div className="flex items-center gap-1 font-medium text-destructive">
                            <AlertTriangle className="w-3 h-3" /> Delivery diagnostics
                          </div>
                          <div className="text-muted-foreground">Reason: {replyDiag.detail || 'unknown'}</div>
                          {replyDiag.channel && <div className="text-muted-foreground">Channel: {replyDiag.channel.toUpperCase()}</div>}
                          {replyDiag.category && <div className="text-muted-foreground">Category: {replyDiag.category}</div>}
                          {replyDiag.from && <div className="text-muted-foreground">From: {replyDiag.from}{replyDiag.to ? ` → ${replyDiag.to}` : ''}</div>}
                          {replyDiag.retryable !== undefined && (
                            <div className="text-muted-foreground">Retry eligible: {replyDiag.retryable ? 'yes' : 'no — fix the sender configuration first'}</div>
                          )}
                          {replyDiag.correlationId && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Ref {replyDiag.correlationId}</span>
                              <button className="underline" onClick={() => { navigator.clipboard?.writeText(replyDiag.correlationId ?? ''); toast({ title: 'Reference copied' }); }}>Copy</button>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-3">
                            {replyDiag.retryable !== false && (
                              <button className="underline" onClick={() => sendReply()} disabled={sendingReply}>Retry</button>
                            )}
                            <a className="underline" href="/admin?tab=knowledge&section=health">Open System Health</a>
                            {canOverrideBookings && (
                              <button className="underline text-destructive" onClick={authorizeAndSendTestReply} disabled={authorizingTest || sendingReply}>
                                {authorizingTest ? 'Authorizing…' : 'Send one real test reply despite test suppression'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* One-time live Jobber test authorization (operations admins, protected test identity only) */}
              <LiveJobberTestPanel
                convo={selected as unknown as ConvoLike}
                isOperationsAdmin={canOverrideBookings}
                adminUserId={user?.id ?? null}
                onChanged={load}
              />

              {/* Campaign events */}
              {events.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {events.map((e) => <Badge key={e.id} variant="secondary" className="text-[10px]">{e.event_name}</Badge>)}
                </div>
              )}

              <Separator />

              {/* Transcript */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Transcript</p>
                <ScrollArea className="h-[240px] rounded-lg border border-border p-3">
                  <div className="space-y-2">
                    {messages.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'staff').map((m) => (
                      <div key={m.id} className="flex gap-2 text-sm">
                        {m.role === 'user'
                          ? <User className="w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground" />
                          : m.role === 'staff'
                          ? <Headset className="w-3.5 h-3.5 mt-1 shrink-0 text-primary" />
                          : <Bot className="w-3.5 h-3.5 mt-1 shrink-0 text-primary" />}
                        <span className={m.role === 'user' ? 'text-foreground' : 'text-muted-foreground'}>
                          {m.role === 'staff' && <span className="font-medium text-primary mr-1">[Staff]</span>}
                          {m.content}
                        </span>
                      </div>
                    ))}
                    {messages.length === 0 && <p className="text-xs text-muted-foreground">No messages.</p>}
                  </div>
                </ScrollArea>
              </div>

              {/* Internal notes */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Internal notes (never shown to customers)</p>
                <Textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={3} disabled={isReadOnly} placeholder="Add a private note…" />
                {!isReadOnly && <Button size="sm" className="mt-2" onClick={saveNotes}>Save note</Button>}
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      <Dialog open={takeoverOpen} onOpenChange={setTakeoverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take over this conversation</DialogTitle>
            <DialogDescription>This pauses automated nurture enrollment for this prospect and marks the conversation as staff-handled. A brief reason is required.</DialogDescription>
          </DialogHeader>
          <Textarea value={takeoverReason} onChange={(e) => setTakeoverReason(e.target.value)} rows={3} placeholder="Why are you taking over?" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTakeoverOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={submitTakeover}>Record takeover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnAiOpen} onOpenChange={setReturnAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return this conversation to the AI?</DialogTitle>
            <DialogDescription>
              This ends staff handling and lets the assistant respond automatically again on the customer's next message.
              Nurture stays paused until the customer re-engages. This action is audited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnAiOpen(false)}>Cancel</Button>
            <Button onClick={returnToAi}>Return to AI</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testNotifyOpen} onOpenChange={setTestNotifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send one real internal test alert?</DialogTitle>
            <DialogDescription>
              This sends ONE real escalation SMS (and email, if configured) to the primary recipient
              (Ben, +1 469-215-0144) to verify notifications work end-to-end. It deliberately bypasses
              test-identity suppression for this one controlled check. No customer is contacted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestNotifyOpen(false)} disabled={testNotifyBusy}>Cancel</Button>
            <Button onClick={runTestNotify} disabled={testNotifyBusy}>{testNotifyBusy ? 'Sending…' : 'Send test alert'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate">{value != null && value !== '' ? String(value) : '—'}</p>
    </div>
  );
}
