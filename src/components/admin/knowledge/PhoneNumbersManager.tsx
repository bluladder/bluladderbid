import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Phone } from 'lucide-react';

interface PhoneRow {
  id: string;
  purpose: string;
  e164: string;
  display_format: string;
  label: string;
  description: string | null;
  provider: string | null;
  is_public: boolean;
  is_active: boolean;
  revision: number;
}

const PURPOSE_LABEL: Record<string, string> = {
  primary_public: 'Primary public (Call BluLadder / office)',
  app_ai: 'BluLadder Bid / AI app + transactional SMS',
  escalation_sender: 'Internal escalation sender',
};

// Purposes retired from active BluLadder Bid use. Never shown as selectable
// or editable in the admin UI even if a legacy row still exists in the DB.
const RETIRED_PURPOSES = new Set<string>(['responsibid']);

export function PhoneNumbersManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PhoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, Partial<PhoneRow>>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('phone_numbers').select('*').order('purpose');
    const rows = (data as PhoneRow[]) ?? [];
    // Hide retired purposes from the admin editor entirely. They are managed
    // by migration and must not become primary/public/transferable again.
    setRows(rows.filter((r) => !RETIRED_PURPOSES.has(r.purpose)));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async (row: PhoneRow) => {
    const patch = edits[row.id] ?? {};
    const { error } = await supabase.from('phone_numbers').update(patch).eq('id', row.id);
    if (error) { toast({ title: 'Save failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Saved', description: `${PURPOSE_LABEL[row.purpose] ?? row.purpose} updated.` });
    setEdits((e) => { const n = { ...e }; delete n[row.id]; return n; });
    load();
  };

  const set = (id: string, key: keyof PhoneRow, value: unknown) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: value } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Phone className="w-4 h-4" /> Business Phone Numbers</CardTitle>
        <CardDescription>
          Single source of truth. The AI and website pick a number by purpose. The ResponsiBid number is never shown as the primary contact.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {rows.map((row) => {
          const cur = { ...row, ...edits[row.id] };
          const dirty = !!edits[row.id];
          return (
            <div key={row.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{PURPOSE_LABEL[row.purpose] ?? row.purpose}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">rev {row.revision}</Badge>
                  {cur.is_public ? <Badge>Public</Badge> : <Badge variant="secondary">Internal</Badge>}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <label className="text-xs text-muted-foreground">E.164</label>
                  <Input value={cur.e164} onChange={(e) => set(row.id, 'e164', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Display</label>
                  <Input value={cur.display_format} onChange={(e) => set(row.id, 'display_format', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Label</label>
                  <Input value={cur.label} onChange={(e) => set(row.id, 'label', e.target.value)} />
                </div>
              </div>
              {cur.description && <p className="text-xs text-muted-foreground">{cur.description}</p>}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={cur.is_active} onCheckedChange={(v) => set(row.id, 'is_active', v)} /> Active
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={cur.is_public}
                      onCheckedChange={(v) => set(row.id, 'is_public', v)}
                    /> Customer-facing
                  </label>
                </div>
                <Button size="sm" disabled={!dirty} onClick={() => save(row)}>Save</Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
