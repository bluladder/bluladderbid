import { useEffect, useRef, useState, useCallback } from 'react';
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
import { Plus, Trash2, Pencil, Clock, Megaphone, Mail, MessageSquare, ArrowUp, ArrowDown, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { VariableMenu } from './VariableMenu';
import { TEMPLATE_VARS } from './messageTemplateVars';

type TriggerEvent =
  | 'quote_created'
  | 'appointment_scheduled'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'appointment_completed'
  | 'manual';

type LifecycleStatus = 'open' | 'pending' | 'approved' | 'booked' | 'declined';
type CampaignKind = 'lifecycle' | 'event';
type Channel = 'sms' | 'email';

interface Template {
  id: string;
  name: string;
  channel: 'sms' | 'email' | 'both';
  category: string;
  subject: string | null;
  body: string;
  active: boolean;
}

const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  quote_created: 'Quote / bid created',
  appointment_scheduled: 'Appointment scheduled',
  appointment_rescheduled: 'Appointment rescheduled',
  appointment_cancelled: 'Appointment cancelled',
  appointment_completed: 'Appointment completed',
  manual: 'Manual enrollment',
};

const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  open: 'Open — bid requested, no package chosen',
  pending: 'Pending — package selected, not approved/scheduled',
  approved: 'Approved — subscription approved',
  booked: 'Booked — appointment/bid booked',
  declined: 'Declined / Lost',
};

const VAR_TOKENS = TEMPLATE_VARS.map((v) => v.token);

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  campaign_kind: CampaignKind;
  lifecycle_status: LifecycleStatus | null;
  trigger_event: TriggerEvent | null;
  active: boolean;
}

interface Step {
  id: string;
  campaign_id: string;
  step_order: number;
  delay_hours: number;
  channel: Channel;
  subject: string | null;
  body_template: string;
  active: boolean;
}

function StepEditor({
  step, index, total, templates, onUpdate, onDelete, onMove,
}: {
  step: Step;
  index: number;
  total: number;
  templates: Template[];
  onUpdate: (id: string, patch: Partial<Step>) => void;
  onDelete: (id: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const [subject, setSubject] = useState(step.subject ?? '');
  const [body, setBody] = useState(step.body_template);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setSubject(step.subject ?? ''); }, [step.subject]);
  useEffect(() => { setBody(step.body_template); }, [step.body_template]);

  const insertVar = (token: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    onUpdate(step.id, { body_template: next });
    requestAnimationFrame(() => { el?.focus(); const p = start + token.length; el?.setSelectionRange(p, p); });
  };

  const applyTemplate = (tplId: string) => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    const patch: Partial<Step> = { body_template: tpl.body };
    setBody(tpl.body);
    if (step.channel === 'email' && tpl.subject) { setSubject(tpl.subject); patch.subject = tpl.subject; }
    onUpdate(step.id, patch);
    toast.success(`Applied "${tpl.name}"`);
  };

  const matchingTemplates = templates.filter(
    (t) => t.active && (t.channel === 'both' || t.channel === step.channel)
  );

  return (
    <div className={`rounded-md border p-3 space-y-2 ${step.active ? 'bg-muted/20' : 'bg-muted/40 opacity-70'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">Step {index + 1}</Badge>
          <Select value={step.channel} onValueChange={(v) => onUpdate(step.id, { channel: v as Channel })}>
            <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sms"><span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Text</span></SelectItem>
              <SelectItem value="email"><span className="flex items-center gap-1"><Mail className="w-3 h-3" /> Email</span></SelectItem>
            </SelectContent>
          </Select>
          <Clock className="w-3.5 h-3.5 text-muted-foreground ml-1" />
          <Label className="text-xs">Delay (hrs)</Label>
          <Input
            type="number"
            min={0}
            defaultValue={step.delay_hours}
            className="h-8 w-20"
            onBlur={(e) => onUpdate(step.id, { delay_hours: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 mr-1">
            <Switch checked={step.active} onCheckedChange={(v) => onUpdate(step.id, { active: v })} />
            <Label className="text-xs text-muted-foreground">{step.active ? 'On' : 'Paused'}</Label>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(index, -1)}>
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === total - 1} onClick={() => onMove(index, 1)}>
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(step.id)}>
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <VariableMenu onInsert={insertVar} />
        {matchingTemplates.length > 0 && (
          <Select value="" onValueChange={applyTemplate}>
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder="Apply template…" />
            </SelectTrigger>
            <SelectContent>
              {matchingTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {step.channel === 'email' && (
        <Input
          value={subject}
          placeholder="Email subject line"
          className="h-8 text-sm"
          onChange={(e) => setSubject(e.target.value)}
          onBlur={(e) => onUpdate(step.id, { subject: e.target.value })}
        />
      )}
      <Textarea
        ref={bodyRef}
        value={body}
        rows={step.channel === 'email' ? 5 : 2}
        className="text-sm"
        onChange={(e) => setBody(e.target.value)}
        onBlur={(e) => onUpdate(step.id, { body_template: e.target.value })}
      />
    </div>
  );
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
    setEditing({ id: '', name: '', description: '', campaign_kind: 'lifecycle', lifecycle_status: 'open', trigger_event: null, active: true });
    setDialogOpen(true);
  };

  const saveCampaign = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error('Campaign name is required'); return; }
    const isLifecycle = editing.campaign_kind === 'lifecycle';
    if (isLifecycle && !editing.lifecycle_status) { toast.error('Pick a customer status'); return; }
    if (!isLifecycle && !editing.trigger_event) { toast.error('Pick a trigger event'); return; }
    const payload = {
      name: editing.name.trim(),
      description: editing.description?.trim() || null,
      campaign_kind: editing.campaign_kind,
      lifecycle_status: isLifecycle ? editing.lifecycle_status : null,
      trigger_event: isLifecycle ? null : editing.trigger_event,
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
      channel: 'sms',
      body_template: 'Hi {{name}}, this is BluLadder following up. {{link}} Reply STOP to opt out.',
      active: true,
    });
    if (error) { toast.error(error.message); return; }
    load();
  };

  const addEmailStep = async (campaignId: string) => {
    const existing = steps.filter((s) => s.campaign_id === campaignId);
    const nextOrder = existing.length ? Math.max(...existing.map((s) => s.step_order)) + 1 : 1;
    const { error } = await supabase.from('sms_campaign_steps').insert({
      campaign_id: campaignId,
      step_order: nextOrder,
      delay_hours: existing.length ? 24 : 0,
      channel: 'email',
      subject: 'A note from BluLadder',
      body_template: 'Hi {{first_name}},\n\nThis is BluLadder following up.\n\n{{link}}\n\n- The BluLadder Team',
      active: true,
    });
    if (error) { toast.error(error.message); return; }
    load();
  };

  const updateStep = async (id: string, patch: Partial<Step>) => {
    const { error } = await supabase.from('sms_campaign_steps').update(patch).eq('id', id);
    if (error) toast.error(error.message);
    else load();
  };

  const deleteStep = async (id: string) => {
    await supabase.from('sms_campaign_steps').delete().eq('id', id);
    load();
  };

  const moveStep = async (campaignId: string, index: number, dir: -1 | 1) => {
    const cSteps = steps.filter((s) => s.campaign_id === campaignId).sort((a, b) => a.step_order - b.step_order);
    const target = index + dir;
    if (target < 0 || target >= cSteps.length) return;
    const a = cSteps[index];
    const b = cSteps[target];
    await Promise.all([
      supabase.from('sms_campaign_steps').update({ step_order: b.step_order }).eq('id', a.id),
      supabase.from('sms_campaign_steps').update({ step_order: a.step_order }).eq('id', b.id),
    ]);
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5" /> Campaigns</CardTitle>
              <CardDescription>
                Build multi-step text &amp; email sequences. Lifecycle campaigns enroll customers based on their status; event
                campaigns fire after a one-time event. Delays count from when the customer enters the campaign.
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{c.name}</span>
                          <Badge variant={c.active ? 'default' : 'outline'}>{c.active ? 'Active' : 'Paused'}</Badge>
                          {c.campaign_kind === 'lifecycle' ? (
                            <Badge variant="secondary" className="gap-1"><Users className="w-3 h-3" />{c.lifecycle_status ? LIFECYCLE_LABELS[c.lifecycle_status].split(' — ')[0] : 'Lifecycle'}</Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1"><Zap className="w-3 h-3" />{c.trigger_event ? TRIGGER_LABELS[c.trigger_event] : 'Event'}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">{cSteps.length} step{cSteps.length === 1 ? '' : 's'}</span>
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
                      <div key={s.id} className={`rounded-md border p-3 space-y-2 ${s.active ? 'bg-muted/20' : 'bg-muted/40 opacity-70'}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline">Step {i + 1}</Badge>
                            <Select value={s.channel} onValueChange={(v) => updateStep(s.id, { channel: v as Channel })}>
                              <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sms"><span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Text</span></SelectItem>
                                <SelectItem value="email"><span className="flex items-center gap-1"><Mail className="w-3 h-3" /> Email</span></SelectItem>
                              </SelectContent>
                            </Select>
                            <Clock className="w-3.5 h-3.5 text-muted-foreground ml-1" />
                            <Label className="text-xs">Delay (hrs)</Label>
                            <Input
                              type="number"
                              min={0}
                              defaultValue={s.delay_hours}
                              className="h-8 w-20"
                              onBlur={(e) => updateStep(s.id, { delay_hours: Number(e.target.value) })}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="flex items-center gap-1 mr-1">
                              <Switch checked={s.active} onCheckedChange={(v) => updateStep(s.id, { active: v })} />
                              <Label className="text-xs text-muted-foreground">{s.active ? 'On' : 'Paused'}</Label>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => moveStep(c.id, i, -1)}>
                              <ArrowUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === cSteps.length - 1} onClick={() => moveStep(c.id, i, 1)}>
                              <ArrowDown className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteStep(s.id)}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        {s.channel === 'email' && (
                          <Input
                            defaultValue={s.subject ?? ''}
                            placeholder="Email subject line"
                            className="h-8 text-sm"
                            onBlur={(e) => updateStep(s.id, { subject: e.target.value })}
                          />
                        )}
                        <Textarea
                          defaultValue={s.body_template}
                          rows={s.channel === 'email' ? 5 : 2}
                          className="text-sm"
                          onBlur={(e) => updateStep(s.id, { body_template: e.target.value })}
                        />
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => addStep(c.id)}>
                        <MessageSquare className="w-4 h-4 mr-1" /> Add Text
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => addEmailStep(c.id)}>
                        <Mail className="w-4 h-4 mr-1" /> Add Email
                      </Button>
                    </div>
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
            <DialogDescription>Name the sequence and choose what enrolls customers into it.</DialogDescription>
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
                <Label>Campaign type</Label>
                <Select value={editing.campaign_kind} onValueChange={(v) => setEditing({ ...editing, campaign_kind: v as CampaignKind })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lifecycle">Lifecycle status (auto-enroll by customer status)</SelectItem>
                    <SelectItem value="event">Event (one-time trigger)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing.campaign_kind === 'lifecycle' ? (
                <div className="space-y-2">
                  <Label>Customer status</Label>
                  <Select value={editing.lifecycle_status ?? undefined} onValueChange={(v) => setEditing({ ...editing, lifecycle_status: v as LifecycleStatus })}>
                    <SelectTrigger><SelectValue placeholder="Choose a status" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LIFECYCLE_LABELS) as LifecycleStatus[]).map((k) => (
                        <SelectItem key={k} value={k}>{LIFECYCLE_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Trigger event</Label>
                  <Select value={editing.trigger_event ?? undefined} onValueChange={(v) => setEditing({ ...editing, trigger_event: v as TriggerEvent })}>
                    <SelectTrigger><SelectValue placeholder="Choose an event" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TRIGGER_LABELS) as TriggerEvent[]).map((k) => (
                        <SelectItem key={k} value={k}>{TRIGGER_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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