import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FlaskConical, ShieldOff, Loader2, PlayCircle, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { EVENT_LABELS } from '@/lib/campaigns/campaignModel';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

interface Campaign { id: string; name: string; event_name: string | null; status: string | null; active: boolean }
interface TestIdentity { id: string; name: string; email: string | null; phone: string | null; active: boolean }
interface Decision { campaignName: string; outcome: string; reason: string; scheduledMessages?: number }
interface WouldSend { id: string; channel: string; body: string; subject: string | null; suppressed_reason: string | null }

const outcomeColor: Record<string, string> = {
  enrolled: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  suppressed: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  not_enrolled: 'bg-muted text-muted-foreground',
  no_consent: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  skipped_duplicate: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
};

export function CampaignDryRun() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [identities, setIdentities] = useState<TestIdentity[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [identityId, setIdentityId] = useState('');
  const [running, setRunning] = useState(false);
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [wouldSend, setWouldSend] = useState<WouldSend[]>([]);
  const [suppressed, setSuppressed] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [{ data: c }, { data: t }] = await Promise.all([
      db.from('sms_campaigns').select('id, name, event_name, status, active').order('name'),
      db.from('test_identities').select('id, name, email, phone, active').eq('active', true).order('name'),
    ]);
    setCampaigns((c as Campaign[]) ?? []);
    setIdentities((t as TestIdentity[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const campaign = campaigns.find((c) => c.id === campaignId);
  const identity = identities.find((i) => i.id === identityId);

  const run = async (simulate: boolean) => {
    if (!campaign?.event_name) { toast.error('Pick a campaign with a trigger event'); return; }
    if (!identity) { toast.error('Pick an approved test identity'); return; }
    setRunning(true); setDecisions(null); setWouldSend([]); setSuppressed(null);
    try {
      const { data, error } = await supabase.functions.invoke('campaign-event', {
        body: {
          event_name: campaign.event_name,
          email: identity.email, phone: identity.phone,
          source: 'admin_dry_run',
          simulate,
          idempotency_key: simulate ? undefined : `dry_run:${campaign.id}:${identity.id}:${Date.now()}`,
          metadata: { dry_run: true },
        },
      });
      if (error) { toast.error(error.message); return; }
      setDecisions((data?.decisions as Decision[]) ?? []);
      setSuppressed(!!data?.suppressed);
      if (!simulate) {
        // Load the suppressed "would have sent" rows produced for this identity.
        const or = [identity.email ? `to_email.eq.${identity.email}` : null, identity.phone ? `to_number.eq.${identity.phone}` : null].filter(Boolean).join(',');
        const { data: msgs } = await db.from('sms_messages')
          .select('id, channel, body, subject, suppressed_reason')
          .eq('suppressed', true).or(or).order('created_at', { ascending: false }).limit(20);
        setWouldSend((msgs as WouldSend[]) ?? []);
        if (!data?.suppressed) toast.error('Warning: identity was NOT suppressed — check test identity setup');
      }
      toast.success(simulate ? 'Preview complete (no writes)' : 'Suppressed dry run complete');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Campaign dry run</CardTitle>
        <CardDescription>
          Evaluate eligibility and preview messages without delivering anything. <strong>Preview</strong> writes nothing.
          <strong> Suppressed dry run</strong> runs a real event against an approved test identity — the first-class suppression
          system produces inspectable “would have sent” rows and never delivers SMS, email, CallRail or Jobber records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs flex items-center gap-2">
          <ShieldOff className="w-4 h-4 text-amber-600" /> Dry runs are limited to approved, active test identities and never send external messages.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Campaign</Label>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} {c.event_name ? `· ${EVENT_LABELS[c.event_name as keyof typeof EVENT_LABELS] ?? c.event_name}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Approved test identity</Label>
            <Select value={identityId} onValueChange={setIdentityId}>
              <SelectTrigger><SelectValue placeholder="Select test identity" /></SelectTrigger>
              <SelectContent>
                {identities.length === 0 && <SelectItem value="__none" disabled>No active test identities</SelectItem>}
                {identities.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.email || i.phone})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {campaign && <p className="text-xs text-muted-foreground">Triggering event: <strong>{campaign.event_name ?? '—'}</strong></p>}

        <div className="flex gap-2">
          <Button variant="outline" disabled={running} onClick={() => run(true)}>
            {running ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-1" />} Preview (no writes)
          </Button>
          <Button disabled={running} onClick={() => run(false)}>
            {running ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <EyeOff className="w-4 h-4 mr-1" />} Suppressed dry run
          </Button>
        </div>

        {suppressed !== null && (
          <Badge className={suppressed ? outcomeColor.suppressed : 'bg-red-100 text-red-800'}>
            {suppressed ? 'Suppressed — nothing was delivered' : 'NOT suppressed'}
          </Badge>
        )}

        {decisions && (
          <div className="space-y-2">
            <Label className="text-sm">Eligibility decisions</Label>
            {decisions.length === 0 && <p className="text-sm text-muted-foreground">No matching active campaigns for this event.</p>}
            {decisions.map((d, i) => (
              <div key={i} className="rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{d.campaignName}</span>
                  <Badge className={outcomeColor[d.outcome] ?? ''}>{d.outcome}</Badge>
                  {typeof d.scheduledMessages === 'number' && <span className="text-xs text-muted-foreground">{d.scheduledMessages} step(s)</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{d.reason}</p>
              </div>
            ))}
          </div>
        )}

        {wouldSend.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm">Would-have-sent messages (suppressed)</Label>
            {wouldSend.map((m) => (
              <div key={m.id} className="rounded-md border border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs">
                <div className="flex items-center gap-2"><Badge variant="outline">{m.channel}</Badge><span className="text-amber-700 dark:text-amber-300">would have sent — {m.suppressed_reason}</span></div>
                {m.subject && <p className="font-medium mt-1">{m.subject}</p>}
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{m.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
