import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { LifeBuoy, UserPlus } from 'lucide-react';

interface Esc {
  id: string; category: string; severity: string; status: string;
  prospect_name: string | null; prospect_phone: string | null; summary: string | null;
  alert_status: string; assigned_recipient: string | null; created_at: string;
  conversation_id: string | null;
  sms_alert_status?: string | null; email_alert_status?: string | null;
  alert_error?: string | null; email_alert_error?: string | null;
  alert_last_attempt_at?: string | null;
}
interface Recipient {
  id: string; name: string; phone: string; role: string; is_enabled: boolean;
  handles_urgent: boolean; verified_at: string | null;
}
interface Settings {
  id: string; internal_alerts_enabled: boolean; after_hours_behavior: string;
  business_hours_start: number; business_hours_end: number; dashboard_base_url: string | null;
  alert_cooldown_minutes: number;
}

const ALERT_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sms_sent: 'default', email_sent: 'default', partially_delivered: 'secondary',
  queued: 'secondary', created: 'secondary', suppressed: 'outline',
  no_recipient_configured: 'destructive', delivery_failed: 'destructive',
  // legacy
  sent: 'default', pending: 'secondary', no_recipient: 'destructive', failed: 'destructive',
};

export function EscalationCenter() {
  const { toast } = useToast();
  const [escs, setEscs] = useState<Esc[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [newR, setNewR] = useState({ name: '', phone: '' });

  const load = useCallback(async () => {
    const [{ data: e }, { data: r }, { data: s }] = await Promise.all([
      supabase.from('ai_escalations').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('escalation_recipients').select('*').order('role'),
      supabase.from('escalation_settings').select('*').eq('singleton', true).maybeSingle(),
    ]);
    setEscs((e as Esc[]) ?? []);
    setRecipients((r as Recipient[]) ?? []);
    setSettings((s as Settings) ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const { error } = await supabase.from('escalation_settings').update(patch).eq('id', settings.id);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    setSettings({ ...settings, ...patch });
    toast({ title: 'Saved' });
  };

  const addRecipient = async () => {
    if (!newR.name || !newR.phone) return;
    const { error } = await supabase.from('escalation_recipients').insert({ name: newR.name, phone: newR.phone, role: 'primary' });
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    setNewR({ name: '', phone: '' });
    toast({ title: 'Recipient added', description: 'Enable it after you verify the number.' });
    load();
  };

  const updateRecipient = async (r: Recipient, patch: Partial<Recipient>) => {
    await supabase.from('escalation_recipients').update(patch).eq('id', r.id);
    load();
  };

  const resolveEsc = async (e: Esc) => {
    await supabase.from('ai_escalations').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', e.id);
    load();
  };

  const enabledConfigured = recipients.some((r) => r.is_enabled);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><LifeBuoy className="w-4 h-4" /> Escalation Settings</CardTitle>
          <CardDescription>No internal alert is sent until a recipient is configured, enabled and alerts are turned on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings && (
            <>
              <label className="flex items-center justify-between text-sm">
                <span>Internal alerts enabled</span>
                <Switch
                  checked={settings.internal_alerts_enabled}
                  disabled={!enabledConfigured}
                  onCheckedChange={(v) => saveSettings({ internal_alerts_enabled: v })}
                />
              </label>
              {!enabledConfigured && <p className="text-xs text-muted-foreground">Add and enable a recipient below to turn alerts on.</p>}
              <div>
                <label className="text-xs text-muted-foreground">Dashboard base URL (in alert)</label>
                <Input
                  value={settings.dashboard_base_url ?? ''}
                  placeholder="https://bluladderbid.lovable.app/admin"
                  onChange={(e) => setSettings({ ...settings, dashboard_base_url: e.target.value })}
                  onBlur={() => saveSettings({ dashboard_base_url: settings.dashboard_base_url })}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="w-4 h-4" /> Escalation Recipients</CardTitle>
          <CardDescription>Staff who receive internal escalation texts. Verify the number before enabling.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border p-2 gap-2">
              <div className="text-sm">
                <div className="font-medium">{r.name} <Badge variant="outline" className="text-[10px] ml-1">{r.role}</Badge></div>
                <div className="text-xs text-muted-foreground">{r.phone}{r.verified_at ? ' · verified' : ' · unverified'}</div>
              </div>
              <div className="flex items-center gap-3">
                {!r.verified_at && (
                  <Button size="sm" variant="outline" onClick={() => updateRecipient(r, { verified_at: new Date().toISOString() })}>Mark verified</Button>
                )}
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch checked={r.is_enabled} disabled={!r.verified_at} onCheckedChange={(v) => updateRecipient(r, { is_enabled: v })} /> Enabled
                </label>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Input placeholder="Name" value={newR.name} onChange={(e) => setNewR({ ...newR, name: e.target.value })} />
            <Input placeholder="Phone (+1…)" value={newR.phone} onChange={(e) => setNewR({ ...newR, phone: e.target.value })} />
            <Button size="sm" onClick={addRecipient}>Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Escalations</CardTitle>
          <CardDescription>Human-handoff requests from the AI chat.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {escs.filter((e) => e.status === 'open' || e.status === 'claimed').map((e) => (
            <div key={e.id} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium capitalize">{e.category.replace(/_/g, ' ')} — {e.prospect_name ?? 'Unknown'}</div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] capitalize">{e.severity}</Badge>
                  <Badge variant={ALERT_VARIANT[e.alert_status] ?? 'outline'} className="text-[10px]">alert: {e.alert_status}</Badge>
                </div>
              </div>
              {e.summary && <p className="text-xs text-muted-foreground">{e.summary}</p>}
              <div className="text-[11px] text-muted-foreground">
                {e.prospect_phone ?? 'no phone'} · {new Date(e.created_at).toLocaleString()}
                {e.assigned_recipient ? ` · → ${e.assigned_recipient}` : ''}
              </div>
              <Button size="sm" variant="ghost" onClick={() => resolveEsc(e)}>Resolve</Button>
            </div>
          ))}
          {escs.filter((e) => e.status === 'open' || e.status === 'claimed').length === 0 && (
            <p className="text-sm text-muted-foreground">No active escalations.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
