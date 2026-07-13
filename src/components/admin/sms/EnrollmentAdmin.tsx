import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Pause, Play, Square, EyeOff, CheckCircle2, UserCog, RotateCw, XCircle, Users, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

interface Enrollment {
  id: string; campaign_id: string; customer_id: string | null; conversation_id: string | null;
  status: string; event_name: string | null; campaign_version: number | null;
  email: string | null; phone: string | null; reason: string | null;
  stopped_reason: string | null; paused_at: string | null; suppressed: boolean;
  suppressed_reason: string | null; enrolled_at: string;
}
interface Msg {
  id: string; enrollment_id: string | null; channel: string; status: string; body: string;
  subject: string | null; send_at: string | null; sent_at: string | null; error: string | null; suppressed: boolean;
}
interface Campaign { id: string; name: string }

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  stopped: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  resolved: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
};
const MSG_COLOR: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  cancelled: 'bg-muted text-muted-foreground',
};

export function EnrollmentAdmin() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [takeover, setTakeover] = useState<Enrollment | null>(null);
  const [takeoverReason, setTakeoverReason] = useState('');
  const [retryMsg, setRetryMsg] = useState<{ msg: Msg; enr: Enrollment | undefined } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: e }, { data: c }] = await Promise.all([
      db.from('campaign_enrollments').select('*').order('enrolled_at', { ascending: false }).limit(100),
      db.from('sms_campaigns').select('id, name'),
    ]);
    const enr = (e as Enrollment[]) ?? [];
    setEnrollments(enr);
    setCampaigns((c as Campaign[]) ?? []);
    const ids = enr.map((x) => x.id);
    if (ids.length) {
      const { data: m } = await db.from('sms_messages')
        .select('id, enrollment_id, channel, status, body, subject, send_at, sent_at, error, suppressed')
        .in('enrollment_id', ids).order('send_at', { ascending: true });
      setMessages((m as Msg[]) ?? []);
    } else setMessages([]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const campaignName = (id: string) => campaigns.find((c) => c.id === id)?.name ?? 'Unknown';
  const msgsFor = (enrId: string) => messages.filter((m) => m.enrollment_id === enrId);

  const filtered = useMemo(
    () => (filter === 'all' ? enrollments : enrollments.filter((e) => e.status === filter)),
    [enrollments, filter],
  );

  const setStatus = async (e: Enrollment, patch: Record<string, unknown>, cancelPending: boolean, okMsg: string) => {
    const { error } = await db.from('campaign_enrollments').update(patch).eq('id', e.id);
    if (error) { toast.error(error.message); return; }
    if (cancelPending) {
      await db.from('sms_messages').update({ status: 'cancelled', error: `Enrollment ${patch.status}`, next_retry_at: null })
        .eq('enrollment_id', e.id).eq('status', 'pending');
    }
    toast.success(okMsg); load();
  };

  const pause = (e: Enrollment) => setStatus(e, { status: 'paused', paused_at: new Date().toISOString() }, false, 'Enrollment paused');
  const resume = (e: Enrollment) => setStatus(e, { status: 'active', paused_at: null }, false, 'Resumed — eligibility & consent are re-checked at delivery');
  const stop = (e: Enrollment) => setStatus(e, { status: 'stopped', stopped_reason: 'admin_stopped', stopped_at: new Date().toISOString() }, true, 'Stopped — pending steps cancelled');
  const resolve = (e: Enrollment) => setStatus(e, { status: 'resolved', stopped_reason: 'resolved', stopped_at: new Date().toISOString() }, true, 'Marked resolved');
  const suppress = async (e: Enrollment) => {
    const { error } = await db.from('campaign_enrollments').update({ suppressed: true, suppressed_reason: 'admin_suppressed' }).eq('id', e.id);
    if (error) { toast.error(error.message); return; }
    await db.from('sms_messages').update({ suppressed: true, suppressed_reason: 'admin_suppressed', status: 'cancelled', next_retry_at: null })
      .eq('enrollment_id', e.id).eq('status', 'pending');
    toast.success('Suppressed — pending delivery blocked'); load();
  };
  const cancelStep = async (m: Msg) => {
    const { error } = await db.from('sms_messages').update({ status: 'cancelled', error: 'Cancelled by admin', next_retry_at: null }).eq('id', m.id).eq('status', 'pending');
    if (error) { toast.error(error.message); return; }
    toast.success('Pending step cancelled'); load();
  };

  // Retry protections: only failed messages, only while enrollment eligible & not suppressed.
  const retryReason = (m: Msg, enr: Enrollment | undefined): { allowed: boolean; why: string } => {
    if (m.status === 'sent') return { allowed: false, why: 'Message already sent — retry is never allowed.' };
    if (m.status !== 'failed') return { allowed: false, why: `Only failed messages can be retried (this is ${m.status}).` };
    if (m.suppressed) return { allowed: false, why: 'Message is suppressed.' };
    if (!enr) return { allowed: false, why: 'No enrollment context.' };
    if (enr.status !== 'active') return { allowed: false, why: `Enrollment is ${enr.status}, not active.` };
    if (enr.suppressed) return { allowed: false, why: 'Enrollment is suppressed.' };
    return { allowed: true, why: 'Consent, opt-out, stop conditions and suppression are re-checked by the queue at delivery.' };
  };
  const doRetry = async () => {
    if (!retryMsg) return;
    const { msg, enr } = retryMsg;
    const check = retryReason(msg, enr);
    if (!check.allowed) { toast.error(check.why); setRetryMsg(null); return; }
    const { error } = await db.from('sms_messages').update({
      status: 'pending', send_at: new Date().toISOString(), next_retry_at: null,
      error: `Retry by admin at ${new Date().toISOString()}`,
    }).eq('id', msg.id).eq('status', 'failed');
    if (error) { toast.error(error.message); return; }
    toast.success('Queued for retry — delivery safety re-checked by the queue');
    setRetryMsg(null); load();
  };

  const submitTakeover = async () => {
    if (!takeover) return;
    if (!takeoverReason.trim()) { toast.error('A reason is required'); return; }
    const { data, error } = await supabase.functions.invoke('campaign-event', {
      body: {
        event_name: 'manual_staff_takeover',
        customer_id: takeover.customer_id, conversation_id: takeover.conversation_id,
        email: takeover.email, phone: takeover.phone, source: 'admin_ui',
        metadata: { reason: takeoverReason.trim() },
      },
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Takeover recorded — ${data?.stopped ?? 0} enrollment(s) paused/stopped`);
    setTakeover(null); setTakeoverReason(''); load();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Enrollments</CardTitle>
            <CardDescription>Inspect why a prospect was included, and safely pause, resume, stop, suppress, resolve, retry or take over.</CardDescription>
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['all', 'active', 'paused', 'stopped', 'resolved'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && enrollments.length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && filtered.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No enrollments.</p>}
        {filtered.map((e) => {
          const msgs = msgsFor(e.id);
          const pending = msgs.filter((m) => m.status === 'pending');
          const sent = msgs.filter((m) => m.status === 'sent');
          const failed = msgs.filter((m) => m.status === 'failed');
          const nextStep = pending.sort((a, b) => (a.send_at ?? '').localeCompare(b.send_at ?? ''))[0];
          return (
            <div key={e.id} className="rounded-lg border p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{e.email || e.phone || 'unknown'}</span>
                <Badge className={STATUS_COLOR[e.status] ?? ''}>{e.status}</Badge>
                <Badge variant="secondary">{campaignName(e.campaign_id)}</Badge>
                {e.event_name && <Badge variant="outline">{e.event_name}</Badge>}
                <Badge variant="outline">v{e.campaign_version ?? 1}</Badge>
                {e.suppressed && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"><EyeOff className="w-3 h-3 mr-1" />suppressed</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{new Date(e.enrolled_at).toLocaleString()}</span>
              </div>
              {e.reason && <p className="text-xs text-muted-foreground">Eligibility: {e.reason}</p>}
              {e.stopped_reason && <p className="text-xs text-muted-foreground">Stopped: {e.stopped_reason}</p>}
              {e.suppressed_reason && <p className="text-xs text-muted-foreground">Suppressed: {e.suppressed_reason}</p>}
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{sent.length} sent</span><span>{pending.length} pending</span><span className={failed.length ? 'text-destructive' : ''}>{failed.length} failed</span>
                {nextStep?.send_at && <span>next: {new Date(nextStep.send_at).toLocaleString()}</span>}
              </div>

              {/* Messages */}
              {msgs.length > 0 && (
                <div className="space-y-1">
                  {msgs.map((m) => {
                    const rc = retryReason(m, e);
                    return (
                      <div key={m.id} className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1 text-xs">
                        <Badge className={MSG_COLOR[m.status] ?? ''}>{m.status}</Badge>
                        <span className="text-muted-foreground">{m.channel}</span>
                        <span className="truncate flex-1">{m.subject ? `${m.subject}: ` : ''}{m.body}</span>
                        {m.status === 'pending' && <Button variant="ghost" size="sm" className="h-6" onClick={() => cancelStep(m)}><XCircle className="w-3 h-3 mr-1" />Cancel</Button>}
                        {m.status === 'failed' && (
                          <Button variant="ghost" size="sm" className="h-6" disabled={!rc.allowed} title={rc.why} onClick={() => setRetryMsg({ msg: m, enr: e })}>
                            <RotateCw className="w-3 h-3 mr-1" />Retry
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-1 flex-wrap pt-1">
                {e.status === 'active' && <Button variant="outline" size="sm" onClick={() => pause(e)}><Pause className="w-3.5 h-3.5 mr-1" />Pause</Button>}
                {e.status === 'paused' && <Button variant="outline" size="sm" onClick={() => resume(e)}><Play className="w-3.5 h-3.5 mr-1" />Resume</Button>}
                {['active', 'paused'].includes(e.status) && <Button variant="outline" size="sm" onClick={() => stop(e)}><Square className="w-3.5 h-3.5 mr-1" />Stop</Button>}
                {!e.suppressed && <Button variant="outline" size="sm" onClick={() => suppress(e)}><EyeOff className="w-3.5 h-3.5 mr-1" />Suppress</Button>}
                <Button variant="outline" size="sm" onClick={() => resolve(e)}><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Resolve</Button>
                <Button variant="outline" size="sm" onClick={() => { setTakeover(e); setTakeoverReason(''); }}><UserCog className="w-3.5 h-3.5 mr-1" />Takeover</Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      {/* Retry confirmation */}
      <Dialog open={!!retryMsg} onOpenChange={(o) => !o && setRetryMsg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retry failed message?</DialogTitle>
            <DialogDescription>{retryMsg ? retryReason(retryMsg.msg, retryMsg.enr).why : ''}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">A sent message can never be re-sent. The queue re-verifies consent, opt-out, stop conditions and suppression before any delivery.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetryMsg(null)}>Cancel</Button>
            <Button onClick={doRetry} disabled={!retryMsg || !retryReason(retryMsg.msg, retryMsg.enr).allowed}>Confirm retry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual staff takeover */}
      <Dialog open={!!takeover} onOpenChange={(o) => !o && setTakeover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserCog className="w-5 h-5" />Record manual staff takeover</DialogTitle>
            <DialogDescription>
              Pauses/stops automated nurture per each campaign's takeover behavior while leaving transactional communication intact.
              Your identity and timestamp are recorded server-side. Repeated clicks are idempotent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (required)</Label>
            <Textarea value={takeoverReason} onChange={(e) => setTakeoverReason(e.target.value)} rows={3} placeholder="e.g. Called customer directly; handling personally." />
            {!takeoverReason.trim() && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />A reason is required.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTakeover(null)}>Cancel</Button>
            <Button onClick={submitTakeover} disabled={!takeoverReason.trim()}>Record takeover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
