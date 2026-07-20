import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, RefreshCw, Shield, Plus } from 'lucide-react';
import { toast } from 'sonner';

type Row = {
  id: string;
  email: string;
  reason: 'bounced' | 'complained' | 'unsubscribed' | 'invalid' | 'manual';
  source: string;
  notes: string | null;
  created_at: string;
};

const REASON_STYLE: Record<Row['reason'], string> = {
  bounced: 'bg-red-100 text-red-800 border-red-200',
  complained: 'bg-orange-100 text-orange-800 border-orange-200',
  unsubscribed: 'bg-blue-100 text-blue-800 border-blue-200',
  invalid: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  manual: 'bg-slate-100 text-slate-800 border-slate-200',
};

export function EmailSuppressionsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('email_suppressions')
      .select('id,email,reason,source,notes,created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) { toast.error(`Failed to load: ${error.message}`); return; }
    setRows((data ?? []) as Row[]);
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.email.includes(needle) || r.reason.includes(needle));
  }, [rows, q]);

  async function remove(id: string, email: string) {
    if (!confirm(`Remove ${email} from the suppression list? Future emails to this address will resume.`)) return;
    const { error } = await supabase.from('email_suppressions').delete().eq('id', id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    toast.success(`${email} removed`);
    void load();
  }

  async function add() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email');
      return;
    }
    const { error } = await supabase.from('email_suppressions').insert({
      email, reason: 'manual', source: 'admin-ui', notes: newNote || null,
    });
    if (error) { toast.error(`Add failed: ${error.message}`); return; }
    toast.success(`${email} added to suppression list`);
    setNewEmail(''); setNewNote('');
    void load();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.reason] = (c[r.reason] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" /> Email suppression list
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {(['bounced','complained','unsubscribed','invalid','manual'] as const).map((r) => (
            <Badge key={r} variant="outline" className={REASON_STYLE[r]}>
              {r}: {counts[r] ?? 0}
            </Badge>
          ))}
          <Badge variant="outline">total: {rows.length}</Badge>
        </div>

        <div className="flex gap-2 flex-wrap items-end border rounded-md p-3 bg-muted/40">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-muted-foreground">Add address (manual)</label>
            <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="user@example.com" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-muted-foreground">Note (optional)</label>
            <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Why is this address blocked?" />
          </div>
          <Button onClick={add} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>

        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or reason…" />

        <div className="border rounded-md divide-y max-h-[420px] overflow-auto">
          {filtered.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No suppressed recipients.</div>
          )}
          {filtered.map((r) => (
            <div key={r.id} className="flex items-center gap-2 p-2 text-sm">
              <Badge variant="outline" className={REASON_STYLE[r.reason]}>{r.reason}</Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.email}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {new Date(r.created_at).toLocaleString()} · {r.source}
                  {r.notes ? ` · ${r.notes}` : ''}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(r.id, r.email)} aria-label={`Remove ${r.email}`}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Bounces, complaints, and unsubscribes are added automatically from the Resend webhook.
          The <code>sendEmail</code> helper blocks any address on this list, regardless of caller.
          Add <code>RESEND_WEBHOOK_SECRET</code> and point Resend at <code>/functions/v1/resend-webhook</code> to enable auto-ingestion.
        </p>
      </CardContent>
    </Card>
  );
}