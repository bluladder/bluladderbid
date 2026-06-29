import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, Clock, Megaphone } from 'lucide-react';
import { toast } from 'sonner';

type TriggerEvent =
  | 'quote_created'
  | 'appointment_scheduled'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'appointment_completed'
  | 'manual';

const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  quote_created: 'Quote / bid created',
  appointment_scheduled: 'Appointment scheduled',
  appointment_rescheduled: 'Appointment rescheduled',
  appointment_cancelled: 'Appointment cancelled',
  appointment_completed: 'Appointment completed',
  manual: 'Manual enrollment',
};

const TEMPLATE_VARS = ['{{name}}', '{{service}}', '{{date}}', '{{time}}', '{{link}}'];

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  trigger_event: TriggerEvent;
  active: boolean;
}

interface Step {
  id: string;
  campaign_id: string;
  step_order: number;
  delay_hours: number;
  body_template: string;
  active: boolean;
}

export function SmsCampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from('sms_campaigns').select('*').order('created_at', { ascending: true }),
      supabase.from('sms_campaign_steps').select('*').order('step_order', { ascending: true }),
    ]);
    setCampaigns((c as Campaign[]) ?? []);
    setSteps((s as Step[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing({ id: '', name: '', description: '', trigger_event: 'quote_created', active: true });
    setDialogOpen(true);
  };

  const saveCampaign = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error('Campaign name is required'); return; }
    const payload = {
      name: editing.name.trim(),
      description: editing.description?.trim() || null,
      trigger_event: editing.trigger_event,
      active: editing.active,
    };
    const { error } = editing.id
      ? await supabase.from('sms_campaigns').update(payload).eq('id', editing.id)
      : await supabase.from('sms_campaigns').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success('Campaign saved');
    setDialogOpen(false);
    setEditing(null);
    load();
  };

  const deleteCampaign = async (id: string) => {
    const { error } = await supabase.from('sms_campaigns').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Campaign deleted');
    load();
  };

  const toggleActive = async (c: Campaign) => {
    await supabase.from('sms_campaigns').update({ active: !c.active }).eq('id', c.id);
    load();
  };

  const addStep = async (campaignId: string) => {
    const existing = steps.filter((s) => s.campaign_id === campaignId);
    const nextOrder = existing.length ? Math.max(...existing.map((s) => s.step_order)) + 1 : 1;
    const { error } = await supabase.from('sms_campaign_steps').insert({
      campaign_id: campaignId,
      step_order: nextOrder,
      delay_hours: existing.length ? 24 : 0,
      body_template: 'Hi {{name}}, this is BluLadder following up. {{link}} Reply STOP to opt out.',
      active: true,
    });
    if (error) { toast.error(error.message); return; }
    load();
  };

  const updateStep = async (id: string, patch: Partial<Step>) => {
    const { error } = await supabase.from('sms_campaign_steps').update(patch).eq('id', id);
    if (error) toast.error(error.message);
  };

  const deleteStep = async (id: string) => {
    await supabase.from('sms_campaign_steps').delete().eq('id', id);
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5" /> Follow-up Campaigns</CardTitle>
              <CardDescription>
                Build multi-step text sequences that fire automatically after an event. Delays are counted from the trigger.
              </CardDescription>
            </div>
            <Button onClick={openNew} size="sm"><Plus className="w-4 h-4 mr-1" /> New Campaign</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
            Template variables: {TEMPLATE_VARS.map((v) => <code key={v} className="mx-1 px-1 rounded bg-background">{v}</code>)}
          </div>
          {loading && campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No campaigns yet. Create one to start following up automatically.</p>
          ) : (
            campaigns.map((c) => {
              const cSteps = steps.filter((s) => s.campaign_id === c.id);
              return (
                <Card key={c.id} className="border-muted">
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.name}</span>
                          <Badge variant={c.active ? 'default' : 'outline'}>{c.active ? 'Active' : 'Paused'}</Badge>
                          <Badge variant="secondary">{TRIGGER_LABELS[c.trigger_event]}</Badge>
                        </div>
                        {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} />
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setDialogOpen(true); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteCampaign(c.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {cSteps.map((s, i) => (
                      <div key={s.id} className="rounded-md border p-3 space-y-2 bg-muted/20">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <Badge variant="outline">Step {i + 1}</Badge>
                          <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                            <Label className="text-xs">Delay (hours)</Label>
                            <Input
                              type="number"
                              min={0}
                              defaultValue={s.delay_hours}
                              className="h-8 w-24"
                              onBlur={(e) => updateStep(s.id, { delay_hours: Number(e.target.value) })}
                            />
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteStep(s.id)}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        <Textarea
                          defaultValue={s.body_template}
                          rows={2}
                          className="text-sm"
                          onBlur={(e) => updateStep(s.id, { body_template: e.target.value })}
                        />
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => addStep(c.id)}>
                      <Plus className="w-4 h-4 mr-1" /> Add Step
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit Campaign' : 'New Campaign'}</DialogTitle>
            <DialogDescription>Name the sequence and pick what event starts it.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Quote follow-up" />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Trigger event</Label>
                <Select value={editing.trigger_event} onValueChange={(v) => setEditing({ ...editing, trigger_event: v as TriggerEvent })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TRIGGER_LABELS) as TriggerEvent[]).map((k) => (
                      <SelectItem key={k} value={k}>{TRIGGER_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                <Label>Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveCampaign}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}