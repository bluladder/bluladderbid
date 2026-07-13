import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

async function count(table: string, build: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { count: n } = await build(db.from(table).select('id', { count: 'exact', head: true }));
  return n ?? 0;
}

interface Stats {
  campaignsActive: number; campaignsDraft: number;
  enrActive: number; enrPaused: number; enrStopped: number;
  msgPending: number; msgFailed: number; msgSuppressed: number;
  recentOptOuts: number; recentReplies: number; recentTakeovers: number; abandonedEvents: number;
}

const DAY = 7 * 24 * 3600 * 1000;

export function CampaignDashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - DAY).toISOString();
    const [
      campaignsActive, campaignsDraft, enrActive, enrPaused, enrStopped,
      msgPending, msgFailed, msgSuppressed, recentOptOuts, recentReplies, recentTakeovers, abandonedEvents,
    ] = await Promise.all([
      count('sms_campaigns', (q) => q.eq('status', 'active')),
      count('sms_campaigns', (q) => q.eq('status', 'draft')),
      count('campaign_enrollments', (q) => q.eq('status', 'active')),
      count('campaign_enrollments', (q) => q.eq('status', 'paused')),
      count('campaign_enrollments', (q) => q.eq('status', 'stopped')),
      count('sms_messages', (q) => q.eq('status', 'pending')),
      count('sms_messages', (q) => q.eq('status', 'failed')),
      count('sms_messages', (q) => q.eq('suppressed', true)),
      count('sms_opt_outs', (q) => q.gte('created_at', since)),
      count('campaign_events', (q) => q.eq('event_name', 'customer_replied').gte('created_at', since)),
      count('campaign_events', (q) => q.eq('event_name', 'manual_staff_takeover').gte('created_at', since)),
      count('campaign_events', (q) => q.eq('event_name', 'quote_abandoned').gte('created_at', since)),
    ]);
    setS({ campaignsActive, campaignsDraft, enrActive, enrPaused, enrStopped, msgPending, msgFailed, msgSuppressed, recentOptOuts, recentReplies, recentTakeovers, abandonedEvents });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const tiles: { label: string; value: number; hint?: string; tone?: string }[] = s ? [
    { label: 'Active campaigns', value: s.campaignsActive },
    { label: 'Draft campaigns', value: s.campaignsDraft },
    { label: 'Enrollments active', value: s.enrActive, tone: 'text-emerald-600' },
    { label: 'Enrollments paused', value: s.enrPaused, tone: 'text-amber-600' },
    { label: 'Enrollments stopped', value: s.enrStopped },
    { label: 'Messages pending', value: s.msgPending, tone: 'text-blue-600' },
    { label: 'Messages failed', value: s.msgFailed, tone: s.msgFailed ? 'text-destructive' : undefined },
    { label: 'Messages suppressed', value: s.msgSuppressed, tone: 'text-amber-600' },
    { label: 'Recent opt-outs', value: s.recentOptOuts, hint: '7d' },
    { label: 'Recent replies', value: s.recentReplies, hint: '7d' },
    { label: 'Recent takeovers', value: s.recentTakeovers, hint: '7d' },
    { label: 'Abandoned-quote events', value: s.abandonedEvents, hint: '7d' },
  ] : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Campaign overview</CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
      </CardHeader>
      <CardContent>
        {!s ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border p-3">
                <div className={`text-2xl font-semibold ${t.tone ?? ''}`}>{t.value}</div>
                <div className="text-xs text-muted-foreground">{t.label}{t.hint ? ` · ${t.hint}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
