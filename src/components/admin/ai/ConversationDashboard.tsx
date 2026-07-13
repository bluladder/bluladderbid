import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

  const sendReply = async () => {
    if (!selected) return;
    if (replyChannel === 'call') return; // call is a click-to-call action, not a send
    const msg = replyDraft.trim();
    if (!msg) { toast({ title: 'Write a reply first', variant: 'destructive' }); return; }
    setSendingReply(true);
    try {
      const { data, error } = await supabase.functions.invoke('staff-reply', {
        body: { conversationId: selected.id, channel: replyChannel, message: msg },
      });
      const d = data as { status?: string; reason?: string } | null;
      if (error) { toast({ title: 'Reply failed', description: error.message, variant: 'destructive' }); return; }
      if (d?.status === 'suppressed') {
        toast({ title: 'Not sent — recipient suppressed', description: d.reason ?? 'Opt-out or suppression in effect', variant: 'destructive' });
        return;
      }
      if (d?.status === 'failed') { toast({ title: 'Delivery failed', description: 'The provider rejected the message.', variant: 'destructive' }); return; }
      toast({ title: `Reply sent by ${replyChannel.toUpperCase()}` });
      setReplyDraft('');
      // refresh the transcript to show the outbound staff message
      const { data: msgs } = await supabase.from('chat_messages')
        .select('id, role, content, created_at, tool_name')
        .eq('conversation_id', selected.id).order('created_at', { ascending: true }).limit(500);
      setMessages((msgs ?? []) as ChatMsg[]);
    } finally { setSendingReply(false); }
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
      const d = data as { sms?: { status?: string }; email?: { status?: string } } | null;
      toast({ title: 'Test alert sent', description: `SMS: ${d?.sms?.status ?? '—'} · Email: ${d?.email?.status ?? '—'}` });
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
                    {messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => (
                      <div key={m.id} className="flex gap-2 text-sm">
                        {m.role === 'user'
                          ? <User className="w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground" />
                          : <Bot className="w-3.5 h-3.5 mt-1 shrink-0 text-primary" />}
                        <span className={m.role === 'user' ? 'text-foreground' : 'text-muted-foreground'}>{m.content}</span>
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
