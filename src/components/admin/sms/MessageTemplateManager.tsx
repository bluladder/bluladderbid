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
import { Plus, Trash2, Pencil, Mail, MessageSquare, Library, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { VariableMenu } from './VariableMenu';
import { previewTemplate } from './messageTemplateVars';

type Channel = 'sms' | 'email' | 'both';

interface Template {
  id: string;
  name: string;
  description: string | null;
  channel: Channel;
  category: string;
  subject: string | null;
  body: string;
  active: boolean;
}

const CHANNEL_LABELS: Record<Channel, string> = { sms: 'Text', email: 'Email', both: 'Text & Email' };

const CATEGORIES = ['general', 'quote', 'appointment', 'follow_up', 'reminder', 'promotion'];

function blank(): Template {
  return { id: '', name: '', description: '', channel: 'both', category: 'general', subject: '', body: '', active: true };
}

export function MessageTemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [lastFocus, setLastFocus] = useState<'body' | 'subject'>('body');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('message_templates').select('*').order('category').order('name');
    if (error) toast.error(error.message);
    setTemplates((data as Template[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(blank()); setOpen(true); };
  const openEdit = (t: Template) => { setEditing({ ...t }); setOpen(true); };

  const insertVar = (token: string) => {
    if (!editing) return;
    if (lastFocus === 'subject' && editing.channel !== 'sms') {
      const el = subjectRef.current;
      const cur = editing.subject ?? '';
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      const next = cur.slice(0, start) + token + cur.slice(end);
      setEditing({ ...editing, subject: next });
      requestAnimationFrame(() => { el?.focus(); const p = start + token.length; el?.setSelectionRange(p, p); });
    } else {
      const el = bodyRef.current;
      const cur = editing.body ?? '';
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? cur.length;
      const next = cur.slice(0, start) + token + cur.slice(end);
      setEditing({ ...editing, body: next });
      requestAnimationFrame(() => { el?.focus(); const p = start + token.length; el?.setSelectionRange(p, p); });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error('Template name is required'); return; }
    if (!editing.body.trim()) { toast.error('Message body is required'); return; }
    const payload = {
      name: editing.name.trim(),
      description: editing.description?.trim() || null,
      channel: editing.channel,
      category: editing.category,
      subject: editing.channel === 'sms' ? null : (editing.subject?.trim() || null),
      body: editing.body,
      active: editing.active,
    };
    const { error } = editing.id
      ? await supabase.from('message_templates').update(payload).eq('id', editing.id)
      : await supabase.from('message_templates').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success('Template saved');
    setOpen(false); setEditing(null); load();
  };

  const duplicate = async (t: Template) => {
    const { error } = await supabase.from('message_templates').insert({
      name: `${t.name} (copy)`, description: t.description, channel: t.channel,
      category: t.category, subject: t.subject, body: t.body, active: t.active,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Template duplicated'); load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('message_templates').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Template deleted'); load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><Library className="w-5 h-5" /> Message Templates</CardTitle>
              <CardDescription>
                Reusable text &amp; email templates with personalization variables. Apply them when building campaign steps to
                write messages faster.
              </CardDescription>
            </div>
            <Button onClick={openNew} size="sm"><Plus className="w-4 h-4 mr-1" /> New Template</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && templates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No templates yet. Create one to reuse across campaigns.</p>
          ) : (
            templates.map((t) => (
              <div key={t.id} className={`rounded-md border p-3 space-y-2 ${t.active ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{t.name}</span>
                    <Badge variant="secondary" className="gap-1">
                      {t.channel === 'email' ? <Mail className="w-3 h-3" /> : t.channel === 'sms' ? <MessageSquare className="w-3 h-3" /> : null}
                      {CHANNEL_LABELS[t.channel]}
                    </Badge>
                    <Badge variant="outline">{t.category}</Badge>
                    {!t.active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicate(t)}><Copy className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(t.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </div>
                {t.subject && <p className="text-xs font-medium">Subject: {t.subject}</p>}
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.body}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit Template' : 'New Template'}</DialogTitle>
            <DialogDescription>Write once, reuse anywhere. Use variables for personalization.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Quote ready" />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={editing.category} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={editing.channel} onValueChange={(v) => setEditing({ ...editing, channel: v as Channel })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Text &amp; Email</SelectItem>
                    <SelectItem value="sms">Text only</SelectItem>
                    <SelectItem value="email">Email only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="When to use this template" />
              </div>
              {editing.channel !== 'sms' && (
                <div className="space-y-2">
                  <Label>Email subject</Label>
                  <Input ref={subjectRef} value={editing.subject ?? ''} onFocus={() => setLastFocus('subject')}
                    onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="Your BluLadder quote is ready" />
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Message body</Label>
                  <VariableMenu onInsert={insertVar} />
                </div>
                <Textarea ref={bodyRef} value={editing.body} rows={editing.channel === 'sms' ? 3 : 6}
                  onFocus={() => setLastFocus('body')}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  placeholder="Hi {{first_name}}, …" />
              </div>
              {editing.body && (
                <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                  <p className="font-medium text-muted-foreground">Preview with sample data</p>
                  {editing.channel !== 'sms' && editing.subject && <p className="font-medium">{previewTemplate(editing.subject)}</p>}
                  <p className="whitespace-pre-wrap">{previewTemplate(editing.body)}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                <Label>Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
