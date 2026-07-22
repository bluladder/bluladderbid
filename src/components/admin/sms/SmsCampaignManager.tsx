import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus, Trash2, Pencil, Clock, Megaphone, Mail, MessageSquare, ArrowUp, ArrowDown,
  Zap, AlertTriangle, CheckCircle2, Eye, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { VariableMenu } from './VariableMenu';
import { TEMPLATE_VARS, previewTemplate } from './messageTemplateVars';
import { AudienceConditionEditor } from './AudienceConditionEditor';
import {
  ALLOWED_EVENTS, EVENT_LABELS, CONSENT_TYPES, CONSENT_LABELS, DEFAULT_STOP_CONDITIONS,
  validateActivation, summarizeAudience, withinEffectiveWindow,
  type EditorCampaign, type EditorStep, type CampaignStatus, type Channel, type ConsentType,
} from '@/lib/campaigns/campaignModel';
import { CAMPAIGN_TEMPLATES } from '@/lib/campaigns/campaignTemplates';
import { NurtureBackfillPanel } from './NurtureBackfillPanel';
import { renderEducationalEmail } from '@/lib/campaigns/renderEducationalEmail';
import type { EducationalStepContent } from '@/lib/campaigns/evergreenEducationContent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const VAR_TOKENS = TEMPLATE_VARS.map((v) => v.token);

interface DbCampaign {
  id: string; name: string; description: string | null; status: CampaignStatus | null;
  active: boolean; event_name: string | null; version: number | null;
  effective_start: string | null; effective_end: string | null;
  required_consent: ConsentType | null; reentry_enabled: boolean | null;
  reentry_cooldown_hours: number | null; abandonment_delay_minutes: number | null;
  stop_conditions: EditorCampaign['stop_conditions'] | null;
  audience_conditions: Record<string, unknown> | null;
}
interface DbStep extends EditorStep { id: string; campaign_id: string }

const STATUS_BADGE: Record<CampaignStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  draft: 'bg-muted text-muted-foreground',
  inactive: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
};

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function StepRow({
  step, index, total, campaignConsent, onUpdate, onDelete, onMove,
}: {
  step: DbStep; index: number; total: number; campaignConsent: ConsentType;
  onUpdate: (id: string, patch: Partial<EditorStep>) => void;
  onDelete: (id: string) => void; onMove: (index: number, dir: -1 | 1) => void;
}) {
  const [body, setBody] = useState(step.body_template);
  const [subject, setSubject] = useState(step.subject ?? '');
  const [showPreview, setShowPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setBody(step.body_template); }, [step.body_template]);
  useEffect(() => { setSubject(step.subject ?? ''); }, [step.subject]);

  const insertVar = (token: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next); onUpdate(step.id, { body_template: next });
  };

  const consentWarn = step.is_marketing && campaignConsent === 'transactional';
  const smsTooLong = step.channel === 'sms' && body.length > 480;

  // ------------------------------------------------------------------
  // Optional educational-content editor. Only rendered for email steps
  // that carry a content_config payload (currently the Evergreen
  // Service Education Nurture campaign). Editing these fields
  // re-renders subject + body_template via the shared pure renderer, so
  // the admin UI and the delivery pipeline stay in lock-step.
  // ------------------------------------------------------------------
  const rawCfg = (step.content_config ?? null) as Partial<EducationalStepContent> | null;
  const hasEduContent = step.channel === 'email' && rawCfg && typeof rawCfg === 'object' && 'placeholder_id' in rawCfg;
  const [eduOpen, setEduOpen] = useState(false);
  const [eduCfg, setEduCfg] = useState<Partial<EducationalStepContent>>(rawCfg ?? {});
  useEffect(() => { setEduCfg((step.content_config ?? {}) as Partial<EducationalStepContent>); }, [step.content_config]);

  const commitEdu = (patch: Partial<EducationalStepContent>) => {
    const next = { ...eduCfg, ...patch } as EducationalStepContent;
    setEduCfg(next);
    // Only re-render when the minimum required fields are present.
    if (!next.subject || !next.body || !next.cta_label || !next.cta_url || !next.fallback_copy) {
      onUpdate(step.id, { content_config: next });
      return;
    }
    const rendered = renderEducationalEmail(next);
    setSubject(rendered.subject);
    setBody(rendered.body);
    onUpdate(step.id, {
      content_config: next,
      subject: rendered.subject,
      body_template: rendered.body,
    });
  };

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
          <Label className="text-xs" title="Hours after this enrollment starts, not hours after the quote was created. Abandonment inactivity is a separate, fixed threshold.">Delay after enrollment (hrs)</Label>
          <Input type="number" min={0} defaultValue={step.delay_hours} className="h-8 w-20"
            onBlur={(e) => onUpdate(step.id, { delay_hours: Number(e.target.value) })} />
        </div>
        <div className="flex items-center gap-1">
          <Switch checked={step.active} onCheckedChange={(v) => onUpdate(step.id, { active: v })} />
          <Label className="text-xs text-muted-foreground mr-1">{step.active ? 'On' : 'Off'}</Label>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUp className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={index === total - 1} onClick={() => onMove(index, 1)}><ArrowDown className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(step.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs">
        <label className="flex items-center gap-1">
          <Switch checked={step.is_marketing} onCheckedChange={(v) => onUpdate(step.id, { is_marketing: v })} />
          {step.is_marketing ? 'Marketing' : 'Transactional'}
        </label>
        <label className="flex items-center gap-1">
          <Switch checked={step.business_hours_only} onCheckedChange={(v) => onUpdate(step.id, { business_hours_only: v })} />
          Business hours only
        </label>
        <VariableMenu onInsert={insertVar} />
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview((s) => !s)}><Eye className="w-3.5 h-3.5 mr-1" /> Preview</Button>
      </div>

      {consentWarn && (
        <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Marketing step needs the campaign to require follow-up or marketing consent.</p>
      )}

      {step.channel === 'email' && (
        <Input value={subject} placeholder="Email subject line" className="h-8 text-sm"
          onChange={(e) => setSubject(e.target.value)} onBlur={(e) => onUpdate(step.id, { subject: e.target.value })} />
      )}
      <Textarea ref={bodyRef} value={body} rows={step.channel === 'email' ? 5 : 3} className="text-sm"
        onChange={(e) => setBody(e.target.value)} onBlur={(e) => onUpdate(step.id, { body_template: e.target.value })} />
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Variables: {VAR_TOKENS.slice(0, 5).map((v) => <code key={v} className="mx-0.5">{v}</code>)}</span>
        <span className={smsTooLong ? 'text-destructive' : ''}>{body.length} chars</span>
      </div>

      {hasEduContent && (
        <div className="rounded-md border bg-background/60">
          <button
            type="button"
            onClick={() => setEduOpen((s) => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Educational content
              <Badge variant="outline" className="ml-1 text-[10px]">{eduCfg.placeholder_id}</Badge>
            </span>
            <span className="text-muted-foreground">{eduOpen ? 'Hide' : 'Edit'}</span>
          </button>
          {eduOpen && (
            <div className="px-3 pb-3 space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Subject</Label>
                <Input className="h-8 text-sm" value={eduCfg.subject ?? ''}
                  onChange={(e) => setEduCfg((c) => ({ ...c, subject: e.target.value }))}
                  onBlur={(e) => commitEdu({ subject: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Body</Label>
                <Textarea rows={5} className="text-sm" value={eduCfg.body ?? ''}
                  onChange={(e) => setEduCfg((c) => ({ ...c, body: e.target.value }))}
                  onBlur={(e) => commitEdu({ body: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">CTA label</Label>
                  <Input className="h-8 text-sm" value={eduCfg.cta_label ?? ''}
                    onChange={(e) => setEduCfg((c) => ({ ...c, cta_label: e.target.value }))}
                    onBlur={(e) => commitEdu({ cta_label: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CTA URL</Label>
                  <Input className="h-8 text-sm" value={eduCfg.cta_url ?? ''}
                    onChange={(e) => setEduCfg((c) => ({ ...c, cta_url: e.target.value }))}
                    onBlur={(e) => commitEdu({ cta_url: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Article title (optional)</Label>
                  <Input className="h-8 text-sm" value={eduCfg.article_title ?? ''}
                    onChange={(e) => setEduCfg((c) => ({ ...c, article_title: e.target.value }))}
                    onBlur={(e) => commitEdu({ article_title: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Article URL (optional)</Label>
                  <Input className="h-8 text-sm" value={eduCfg.article_url ?? ''}
                    onChange={(e) => setEduCfg((c) => ({ ...c, article_url: e.target.value }))}
                    onBlur={(e) => commitEdu({ article_url: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Article description (optional)</Label>
                <Input className="h-8 text-sm" value={eduCfg.article_description ?? ''}
                  onChange={(e) => setEduCfg((c) => ({ ...c, article_description: e.target.value }))}
                  onBlur={(e) => commitEdu({ article_description: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fallback copy (used when no article is configured)</Label>
                <Textarea rows={2} className="text-sm" value={eduCfg.fallback_copy ?? ''}
                  onChange={(e) => setEduCfg((c) => ({ ...c, fallback_copy: e.target.value }))}
                  onBlur={(e) => commitEdu({ fallback_copy: e.target.value })} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Editing any field re-renders the subject and body above using the shared, timing-neutral renderer.
                Leave the article fields blank to send the fallback line instead.
              </p>
            </div>
          )}
        </div>
      )}

      {showPreview && (
        <div className="rounded-md border bg-background p-2 text-xs">
          {step.channel === 'email' && subject && <p className="font-medium">{previewTemplate(subject)}</p>}
          <p className="whitespace-pre-wrap text-muted-foreground">{previewTemplate(body)}</p>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Timing: quote inactivity threshold + delay after enrollment. The
            first message becomes sendable when both have elapsed, subject to
            the one-minute queue cadence.
          </p>
        </div>
      )}
    </div>
  );
}

export function SmsCampaignManager() {
  const [campaigns, setCampaigns] = useState<DbCampaign[]>([]);
  const [steps, setSteps] = useState<DbStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<DbCampaign | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState<DbCampaign | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: s }] = await Promise.all([
      db.from('sms_campaigns').select('*').order('created_at', { ascending: true }),
      db.from('sms_campaign_steps').select('*').order('step_order', { ascending: true }),
    ]);
    setCampaigns((c as DbCampaign[]) ?? []);
    setSteps((s as DbStep[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toEditor = useCallback((c: DbCampaign): EditorCampaign => {
    const cSteps = steps.filter((s) => s.campaign_id === c.id && s.active);
    const channels = Array.from(new Set(cSteps.map((s) => s.channel))) as Channel[];
    return {
      id: c.id, name: c.name, description: c.description, status: (c.status ?? (c.active ? 'active' : 'draft')) as CampaignStatus,
      event_name: (ALLOWED_EVENTS as readonly string[]).includes(c.event_name ?? '') ? (c.event_name as EditorCampaign['event_name']) : null,
      version: c.version ?? 1, effective_start: c.effective_start, effective_end: c.effective_end,
      allowed_channels: channels, required_consent: c.required_consent ?? 'transactional',
      reentry_enabled: !!c.reentry_enabled, reentry_cooldown_hours: c.reentry_cooldown_hours,
      abandonment_delay_minutes: c.abandonment_delay_minutes,
      stop_conditions: { ...DEFAULT_STOP_CONDITIONS, ...(c.stop_conditions ?? {}) },
      audience_conditions: c.audience_conditions ?? {},
    };
  }, [steps]);

  const openNew = () => {
    setEditing({
      id: '', name: '', description: '', status: 'draft', active: false, event_name: null, version: 1,
      effective_start: null, effective_end: null, required_consent: 'requested_follow_up',
      reentry_enabled: false, reentry_cooldown_hours: 72, abandonment_delay_minutes: null,
      stop_conditions: { ...DEFAULT_STOP_CONDITIONS }, audience_conditions: {},
    });
    setDialogOpen(true);
  };

  const patchEditing = (patch: Partial<DbCampaign>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  const persist = async (c: DbCampaign, forceStatus?: CampaignStatus) => {
    const status = forceStatus ?? c.status ?? 'draft';
    const payload = {
      name: c.name.trim(), description: c.description?.trim() || null,
      status, active: status === 'active',
      event_name: c.event_name, version: c.version ?? 1,
      effective_start: c.effective_start, effective_end: c.effective_end,
      required_consent: c.required_consent, reentry_enabled: !!c.reentry_enabled,
      reentry_cooldown_hours: c.reentry_enabled ? c.reentry_cooldown_hours : null,
      abandonment_delay_minutes: c.abandonment_delay_minutes,
      stop_conditions: c.stop_conditions ?? DEFAULT_STOP_CONDITIONS,
      audience_conditions: c.audience_conditions ?? {},
      campaign_kind: 'event',
    };
    const { error } = c.id
      ? await db.from('sms_campaigns').update(payload).eq('id', c.id)
      : await db.from('sms_campaigns').insert(payload);
    if (error) { toast.error(error.message); return false; }
    return true;
  };

  const saveCampaign = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error('Campaign name is required'); return; }
    // Activation gate: only when trying to save as active.
    if (editing.status === 'active') {
      const cSteps = steps.filter((s) => s.campaign_id === editing.id);
      const editorSteps: EditorStep[] = cSteps.map((s) => ({ ...s }));
      const result = validateActivation(toEditor(editing), editorSteps);
      if (!result.ok) { toast.error('Cannot activate — fix validation errors first'); return; }
      // Force a confirmation before activating.
      setConfirmActivate(editing);
      return;
    }
    if (await persist(editing)) { toast.success('Campaign saved'); setDialogOpen(false); setEditing(null); load(); }
  };

  const confirmAndActivate = async () => {
    if (!confirmActivate) return;
    if (await persist(confirmActivate, 'active')) {
      toast.success('Campaign activated');
      setConfirmActivate(null); setDialogOpen(false); setEditing(null); load();
    }
  };

  const changeStatus = async (c: DbCampaign, status: CampaignStatus) => {
    if (status === 'active') {
      const cSteps = steps.filter((s) => s.campaign_id === c.id).map((s) => ({ ...s }));
      const result = validateActivation(toEditor(c), cSteps);
      if (!result.ok) { toast.error(`Cannot activate: ${result.errors[0]}`); return; }
      setConfirmActivate(c);
      return;
    }
    if (await persist(c, status)) { toast.success(`Campaign set to ${status}`); load(); }
  };

  const deleteCampaign = async (id: string) => {
    const { error } = await db.from('sms_campaigns').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Campaign deleted'); load();
  };

  const addStep = async (campaignId: string, channel: Channel) => {
    const existing = steps.filter((s) => s.campaign_id === campaignId);
    const nextOrder = existing.length ? Math.max(...existing.map((s) => s.step_order)) + 1 : 1;
    const { error } = await db.from('sms_campaign_steps').insert({
      campaign_id: campaignId, step_order: nextOrder, delay_hours: existing.length ? 24 : 0, channel,
      subject: channel === 'email' ? 'A note from BluLadder' : null,
      body_template: channel === 'sms'
        ? 'Hi {{first_name}}, this is BluLadder following up. {{link}} Reply STOP to opt out.'
        : 'Hi {{first_name}},\n\nThis is BluLadder following up.\n\n{{link}}\n\n- The BluLadder Team',
      active: true, is_marketing: false, business_hours_only: false,
    });
    if (error) { toast.error(error.message); return; }
    load();
  };
  const updateStep = async (id: string, patch: Partial<EditorStep>) => {
    const { error } = await db.from('sms_campaign_steps').update(patch).eq('id', id);
    if (error) toast.error(error.message); else load();
  };
  const deleteStep = async (id: string) => { await db.from('sms_campaign_steps').delete().eq('id', id); load(); };
  const moveStep = async (campaignId: string, index: number, dir: -1 | 1) => {
    const cSteps = steps.filter((s) => s.campaign_id === campaignId).sort((a, b) => a.step_order - b.step_order);
    const target = index + dir;
    if (target < 0 || target >= cSteps.length) return;
    const a = cSteps[index]; const b = cSteps[target];
    await Promise.all([
      db.from('sms_campaign_steps').update({ step_order: b.step_order }).eq('id', a.id),
      db.from('sms_campaign_steps').update({ step_order: a.step_order }).eq('id', b.id),
    ]);
    load();
  };

  const createFromTemplate = async (key: string) => {
    const tpl = CAMPAIGN_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    const { data, error } = await db.from('sms_campaigns').insert({
      name: tpl.campaign.name, description: tpl.campaign.description, status: 'draft', active: false,
      event_name: tpl.campaign.event_name, version: tpl.campaign.version,
      required_consent: tpl.campaign.required_consent, reentry_enabled: tpl.campaign.reentry_enabled,
      reentry_cooldown_hours: tpl.campaign.reentry_cooldown_hours, abandonment_delay_minutes: tpl.campaign.abandonment_delay_minutes,
      stop_conditions: tpl.campaign.stop_conditions, audience_conditions: tpl.campaign.audience_conditions,
      campaign_kind: 'event',
    }).select('id').single();
    if (error || !data) { toast.error(error?.message ?? 'Failed'); return; }
    await db.from('sms_campaign_steps').insert(tpl.steps.map((s) => ({ ...s, campaign_id: data.id })));
    toast.success(`Draft "${tpl.label}" created — review before activating`);
    load();
  };

  const editorModel = editing ? toEditor(editing) : null;
  const validation = useMemo(() => {
    if (!editing || !editorModel) return null;
    const editorSteps = steps.filter((s) => s.campaign_id === editing.id).map((s) => ({ ...s }));
    return validateActivation(editorModel, editorSteps);
  }, [editing, editorModel, steps]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5" /> Event Campaigns</CardTitle>
              <CardDescription>
                Event-driven text &amp; email sequences. New campaigns start as <strong>draft</strong> and never send until an
                administrator explicitly activates them after validation.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><Sparkles className="w-4 h-4 mr-1" /> Templates</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Create a draft (never auto-activated)</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {CAMPAIGN_TEMPLATES.map((t) => (
                    <DropdownMenuItem key={t.key} onClick={() => createFromTemplate(t.key)} className="flex flex-col items-start">
                      <span className="font-medium">{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={openNew} size="sm"><Plus className="w-4 h-4 mr-1" /> New Campaign</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No campaigns yet.</p>
          ) : (
            campaigns.map((c) => {
              const cSteps = steps.filter((s) => s.campaign_id === c.id);
              const status = (c.status ?? (c.active ? 'active' : 'draft')) as CampaignStatus;
              const channels = Array.from(new Set(cSteps.filter((s) => s.active).map((s) => s.channel)));
              const scheduled = status === 'active' && !withinEffectiveWindow(c.effective_start, c.effective_end);
              return (
                <Card key={c.id} className="border-muted">
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{c.name}</span>
                          <Badge className={STATUS_BADGE[status]}>{status}</Badge>
                          {c.event_name && <Badge variant="secondary" className="gap-1"><Zap className="w-3 h-3" />{EVENT_LABELS[c.event_name as keyof typeof EVENT_LABELS] ?? c.event_name}</Badge>}
                          <Badge variant="outline">v{c.version ?? 1}</Badge>
                          {channels.map((ch) => <Badge key={ch} variant="outline">{ch}</Badge>)}
                          <span className="text-xs text-muted-foreground">{cSteps.length} step{cSteps.length === 1 ? '' : 's'}</span>
                          {scheduled && <Badge variant="outline" className="text-amber-600">outside window</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{summarizeAudience(c.audience_conditions)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Select value={status} onValueChange={(v) => changeStatus(c, v as CampaignStatus)}>
                          <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setDialogOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteCampaign(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {cSteps.map((s, i) => (
                      <StepRow key={s.id} step={s} index={i} total={cSteps.length}
                        campaignConsent={c.required_consent ?? 'transactional'}
                        onUpdate={updateStep} onDelete={deleteStep} onMove={(idx, dir) => moveStep(c.id, idx, dir)} />
                    ))}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => addStep(c.id, 'sms')}><MessageSquare className="w-4 h-4 mr-1" /> Add Text</Button>
                      <Button variant="outline" size="sm" onClick={() => addStep(c.id, 'email')}><Mail className="w-4 h-4 mr-1" /> Add Email</Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Operations-admin backfill for historical quote_follow_up_completed
          events. Uses the canonical campaign-event pipeline only. */}
      <NurtureBackfillPanel />

      {/* Editor dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit Campaign' : 'New Campaign'}</DialogTitle>
            <DialogDescription>Configure trigger, audience, consent, lifecycle behavior and steps. Save as draft, then activate.</DialogDescription>
          </DialogHeader>
          {editing && editorModel && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2"><Label>Name</Label>
                  <Input value={editing.name} onChange={(e) => patchEditing({ name: e.target.value })} placeholder="Abandoned quote follow-up" /></div>
                <div className="space-y-1 col-span-2"><Label>Description</Label>
                  <Textarea value={editing.description ?? ''} rows={2} onChange={(e) => patchEditing({ description: e.target.value })} /></div>
                <div className="space-y-1"><Label>Trigger event</Label>
                  <Select value={editing.event_name ?? ''} onValueChange={(v) => patchEditing({ event_name: v })}>
                    <SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger>
                    <SelectContent>
                      {ALLOWED_EVENTS.map((ev) => <SelectItem key={ev} value={ev}>{EVENT_LABELS[ev]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Version</Label>
                  <Input type="number" min={1} value={editing.version ?? 1} onChange={(e) => patchEditing({ version: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Effective start (optional)</Label>
                  <Input type="datetime-local" value={toLocalInput(editing.effective_start)} onChange={(e) => patchEditing({ effective_start: toIso(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Effective end (optional)</Label>
                  <Input type="datetime-local" value={toLocalInput(editing.effective_end)} onChange={(e) => patchEditing({ effective_end: toIso(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Required consent (per channel)</Label>
                  <Select value={editing.required_consent ?? 'transactional'} onValueChange={(v) => patchEditing({ required_consent: v as ConsentType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONSENT_TYPES.map((ct) => <SelectItem key={ct} value={ct}>{CONSENT_LABELS[ct]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Status</Label>
                  <Select value={editing.status ?? 'draft'} onValueChange={(v) => patchEditing({ status: v as CampaignStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Re-entry */}
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-sm">Re-entry</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={!editing.reentry_enabled ? 'default' : 'outline'} onClick={() => patchEditing({ reentry_enabled: false })}>Prohibited</Button>
                  <Button type="button" size="sm" variant={editing.reentry_enabled ? 'default' : 'outline'} onClick={() => patchEditing({ reentry_enabled: true })}>Allowed</Button>
                  {editing.reentry_enabled && (
                    <div className="flex items-center gap-2 ml-2">
                      <Label className="text-xs">Cooldown (hrs)</Label>
                      <Input type="number" min={1} className="h-8 w-24" value={editing.reentry_cooldown_hours ?? 72}
                        onChange={(e) => patchEditing({ reentry_cooldown_hours: Number(e.target.value) })} />
                    </div>
                  )}
                </div>
              </div>

              {/* Abandonment delay */}
              {editing.event_name === 'quote_abandoned' && (
                <div className="rounded-md border p-3 space-y-1">
                  <Label className="text-sm">Abandonment delay (minutes)</Label>
                  <Input type="number" min={1} className="h-8 w-32" value={editing.abandonment_delay_minutes ?? 1440}
                    onChange={(e) => patchEditing({ abandonment_delay_minutes: Number(e.target.value) })} />
                  <p className="text-xs text-muted-foreground">How long a firm, never-booked quote must sit idle before it counts as abandoned.</p>
                </div>
              )}

              {/* Stop / lifecycle behavior */}
              <div className="rounded-md border p-3 space-y-3">
                <Label className="text-sm">Lifecycle &amp; stop behavior</Label>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1"><Label className="text-xs">On customer reply</Label>
                    <Select value={editing.stop_conditions?.on_reply ?? 'pause'} onValueChange={(v) => patchEditing({ stop_conditions: { ...editing.stop_conditions, on_reply: v as never } })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pause">Pause nurture</SelectItem>
                        <SelectItem value="stop">Stop nurture</SelectItem>
                        <SelectItem value="transactional_only">Continue transactional only</SelectItem>
                        <SelectItem value="none">No action</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">On booking completed</Label>
                    <Select value={editing.stop_conditions?.on_booking ?? 'stop_abandoned'} onValueChange={(v) => patchEditing({ stop_conditions: { ...editing.stop_conditions, on_booking: v as never } })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stop_abandoned">Stop abandoned-quote sequence</SelectItem>
                        <SelectItem value="stop_nurture">Stop lead nurture</SelectItem>
                        <SelectItem value="transactional_only">Continue transactional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">On appointment cancellation</Label>
                    <Select value={editing.stop_conditions?.on_cancellation ?? 'stop_reminders'} onValueChange={(v) => patchEditing({ stop_conditions: { ...editing.stop_conditions, on_cancellation: v as never } })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stop_reminders">Stop appointment reminders</SelectItem>
                        <SelectItem value="continue_followup">Continue approved follow-up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">On manual staff takeover</Label>
                    <Select value={editing.stop_conditions?.on_takeover ?? 'pause'} onValueChange={(v) => patchEditing({ stop_conditions: { ...editing.stop_conditions, on_takeover: v as never } })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pause">Pause automation</SelectItem>
                        <SelectItem value="stop">Stop automation</SelectItem>
                        <SelectItem value="transactional_only">Leave transactional active</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Consent revocation / opt-out always stops marketing — this cannot be overridden.</p>
              </div>

              {/* Audience */}
              <AudienceConditionEditor value={editing.audience_conditions ?? {}} onChange={(v) => patchEditing({ audience_conditions: v })} />

              {/* Live validation */}
              {validation && (
                validation.ok ? (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Passes activation checks{validation.warnings.length ? ` — ${validation.warnings.length} warning(s)` : ''}.
                  </div>
                ) : (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
                    <div className="flex items-center gap-1 font-medium"><AlertTriangle className="w-3.5 h-3.5" /> Not ready to activate</div>
                    {validation.errors.map((e, i) => <p key={i}>• {e}</p>)}
                  </div>
                )
              )}
              {validation?.warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">⚠ {w}</p>)}
              {!editing.id && <p className="text-xs text-muted-foreground">Save the draft first, then add steps below the campaign card.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={saveCampaign}>{editing?.status === 'active' ? 'Save & Activate' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activation confirmation */}
      <Dialog open={!!confirmActivate} onOpenChange={(o) => { if (!o) { setConfirmActivate(null); setConfirmName(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate campaign?</DialogTitle>
            <DialogDescription>
              This campaign will begin enrolling real prospects on <strong>{confirmActivate?.event_name}</strong> and may send messages
              (subject to consent, suppression and effective window). Approved test identities always remain suppressed.
            </DialogDescription>
          </DialogHeader>
          {confirmActivate && (
            <div className="text-sm space-y-1">
              <p><strong>Audience:</strong> {summarizeAudience(confirmActivate.audience_conditions)}</p>
              <p><strong>Consent required:</strong> {CONSENT_LABELS[confirmActivate.required_consent ?? 'transactional']}</p>
              <div className="pt-3 space-y-1">
                <Label className="text-xs">Type the campaign name to confirm:</Label>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={confirmActivate.name}
                  autoFocus
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmActivate(null); setConfirmName(''); }}>Cancel</Button>
            <Button
              onClick={() => { confirmAndActivate(); setConfirmName(''); }}
              disabled={!confirmActivate || confirmName.trim() !== confirmActivate.name.trim()}
            >
              Confirm activation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
