import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ShieldCheck, ShieldOff, Mail, MessageSquare, Zap, EyeOff } from 'lucide-react';

// Read-only administrator view of the canonical consent model, allowlisted
// campaign events (with per-campaign enrollment reasons), enrollments, and
// suppressed "would have sent" messages. All writes happen server-side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

interface ConsentRow {
  id: string; channel: string; consent_type: string; status: string;
  email: string | null; phone: string | null; source: string; language_shown: string | null;
  granted_at: string | null; revoked_at: string | null; opt_out_source: string | null; created_at: string;
}
interface ConsentEventRow {
  id: string; consent_id: string | null; action: string; channel: string; consent_type: string;
  status: string; source: string; language_shown: string | null; created_at: string;
}
interface Decision { campaignName: string; outcome: string; reason: string }
interface EventRow {
  id: string; event_name: string; source: string; email: string | null; phone: string | null;
  enrollments_created: number; created_at: string; processed_at: string | null;
  metadata: { decisions?: Decision[] } | null;
}
interface EnrollmentRow {
  id: string; campaign_id: string; status: string; event_name: string | null;
  email: string | null; phone: string | null; reason: string | null;
  stopped_reason: string | null; suppressed: boolean; suppressed_reason: string | null; enrolled_at: string;
}
interface MsgRow {
  id: string; channel: string; to_number: string | null; to_email: string | null;
  body: string; suppressed_reason: string | null; error: string | null; created_at: string;
}

const statusColor: Record<string, string> = {
  granted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  revoked: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  unknown: 'bg-muted text-muted-foreground',
};

export function ConsentInspector() {
  const [consent, setConsent] = useState<ConsentRow[]>([]);
  const [consentEvents, setConsentEvents] = useState<ConsentEventRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [suppressed, setSuppressed] = useState<MsgRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, ce, e, en, m] = await Promise.all([
      db.from('communication_consent').select('*').order('created_at', { ascending: false }).limit(100),
      db.from('communication_consent_events').select('id, consent_id, action, channel, consent_type, status, source, language_shown, created_at').order('created_at', { ascending: false }).limit(300),
      db.from('campaign_events').select('*').order('created_at', { ascending: false }).limit(100),
      db.from('campaign_enrollments').select('id, campaign_id, status, event_name, email, phone, reason, stopped_reason, suppressed, suppressed_reason, enrolled_at').order('enrolled_at', { ascending: false }).limit(100),
      db.from('sms_messages').select('id, channel, to_number, to_email, body, suppressed_reason, error, created_at').eq('suppressed', true).order('created_at', { ascending: false }).limit(50),
    ]);
    setConsent(c.data ?? []);
    setConsentEvents(ce.data ?? []);
    setEvents(e.data ?? []);
    setEnrollments(en.data ?? []);
    setSuppressed(m.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Consent & Campaign Events</CardTitle>
        <CardDescription>
          Canonical consent records, allowlisted server events, enrollment reasons, and suppressed “would have sent” messages. Read-only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="consent">
          <TabsList>
            <TabsTrigger value="consent">Consent ({consent.length})</TabsTrigger>
            <TabsTrigger value="events">Events ({events.length})</TabsTrigger>
            <TabsTrigger value="enrollments">Enrollments ({enrollments.length})</TabsTrigger>
            <TabsTrigger value="suppressed">Would-have-sent ({suppressed.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="consent" className="mt-4 space-y-2">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-2">
              Read-only. Consent is recorded only through explicit, sourced customer actions — administrators cannot fabricate consent here,
              and a statutory-style opt-out is never overridden without a documented new opt-in.
            </p>
            {!loading && consent.length === 0 && <p className="text-sm text-muted-foreground">No consent records yet.</p>}
            {consent.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  {r.channel === 'email' ? <Mail className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                  <span className="font-medium">{r.email || r.phone}</span>
                  <Badge variant="outline">{r.consent_type}</Badge>
                  <Badge className={statusColor[r.status] ?? ''}>{r.status}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">via {r.source}</span>
                </div>
                {r.language_shown && <p className="mt-1 text-xs text-muted-foreground italic">“{r.language_shown}”</p>}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                  {r.granted_at && <span>granted {new Date(r.granted_at).toLocaleString()}</span>}
                  {r.revoked_at && <span>revoked {new Date(r.revoked_at).toLocaleString()}</span>}
                  {r.opt_out_source && <span>opt-out via {r.opt_out_source}</span>}
                </div>
                {(() => {
                  const history = consentEvents.filter((ev) => ev.consent_id === r.id);
                  if (!history.length) return null;
                  const open = expanded === r.id;
                  return (
                    <div className="mt-1">
                      <button className="text-[11px] underline text-muted-foreground" onClick={() => setExpanded(open ? null : r.id)}>
                        {open ? 'Hide' : `Show`} audit history ({history.length})
                      </button>
                      {open && (
                        <ul className="mt-1 space-y-0.5">
                          {history.map((ev) => (
                            <li key={ev.id} className="text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground">{ev.action}</span> → {ev.status} · {ev.consent_type} · via {ev.source} · {new Date(ev.created_at).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="events" className="mt-4 space-y-2">
            {!loading && events.length === 0 && <p className="text-sm text-muted-foreground">No campaign events yet.</p>}
            {events.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Zap className="w-4 h-4" />
                  <span className="font-medium">{e.event_name}</span>
                  <Badge variant="outline">{e.enrollments_created} enrolled</Badge>
                  <span className="text-xs text-muted-foreground">{e.email || e.phone}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{new Date(e.created_at).toLocaleString()}</span>
                </div>
                {Array.isArray(e.metadata?.decisions) && e.metadata.decisions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {e.metadata.decisions.map((d: Decision, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{d.campaignName}:</span> {d.outcome} — {d.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="enrollments" className="mt-4 space-y-2">
            {!loading && enrollments.length === 0 && <p className="text-sm text-muted-foreground">No enrollments yet.</p>}
            {enrollments.map((en) => (
              <div key={en.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{en.email || en.phone || 'unknown'}</span>
                  <Badge variant="outline">{en.event_name}</Badge>
                  <Badge className={en.status === 'active' ? statusColor.granted : en.status === 'stopped' ? statusColor.revoked : ''}>{en.status}</Badge>
                  {en.suppressed && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"><EyeOff className="w-3 h-3 mr-1" />suppressed</Badge>}
                </div>
                {en.reason && <p className="mt-1 text-xs text-muted-foreground">Why: {en.reason}</p>}
                {en.stopped_reason && <p className="mt-1 text-xs text-muted-foreground">Stopped: {en.stopped_reason}</p>}
                {en.suppressed_reason && <p className="mt-1 text-xs text-muted-foreground">Suppressed: {en.suppressed_reason}</p>}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="suppressed" className="mt-4 space-y-2">
            {!loading && suppressed.length === 0 && <p className="text-sm text-muted-foreground">No suppressed messages — nothing was blocked from sending.</p>}
            {suppressed.map((m) => (
              <div key={m.id} className="rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <ShieldOff className="w-4 h-4 text-amber-600" />
                  <span className="font-medium">{m.to_email || m.to_number}</span>
                  <Badge variant="outline">{m.channel}</Badge>
                  <span className="text-xs text-amber-700 dark:text-amber-300 ml-auto">would have sent — {m.suppressed_reason || m.error}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{m.body}</p>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default ConsentInspector;
