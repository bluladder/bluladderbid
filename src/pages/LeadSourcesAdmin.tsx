import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, useIsAdmin } from '@/hooks/useAuth';
import { AdminLogin } from '@/components/admin/AdminLogin';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, ShieldX } from 'lucide-react';
import { toast } from 'sonner';

type LeadSourceRow = {
  id: string;
  source_key: string;
  display_name: string;
  channel_group: string;
  aliases: string[];
  is_other: boolean;
  is_active: boolean;
  sort_order: number;
  jobber_mapping_mode: 'native' | 'custom_field' | 'internal_note' | 'disabled';
  jobber_mapping_key: string | null;
};

export default function LeadSourcesAdmin() {
  const { user, isAdmin, loading } = useIsAdmin();
  const { signOut } = useAuth();
  const [rows, setRows] = useState<LeadSourceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const load = async () => {
    const { data, error } = await supabase
      .from('lead_source_definitions')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) return toast.error(error.message);
    const next = (data ?? []) as LeadSourceRow[];
    setRows(next);
    setSelectedId((current) => current ?? next[0]?.id ?? null);
  };

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin]);

  const patchSelected = (patch: Partial<LeadSourceRow>) => {
    if (!selectedId) return;
    setRows((current) => current.map((row) => row.id === selectedId ? { ...row, ...patch } : row));
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const { error } = await supabase
      .from('lead_source_definitions')
      .update({
        display_name: selected.display_name.trim(),
        channel_group: selected.channel_group.trim(),
        aliases: selected.aliases,
        is_active: selected.is_active,
        sort_order: selected.sort_order,
        jobber_mapping_mode: selected.jobber_mapping_mode,
        jobber_mapping_key: selected.jobber_mapping_key?.trim() || null,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selected.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Lead source saved');
    await load();
  };

  if (!user && !loading) return <AdminLogin />;
  if (loading) return <div className="min-h-screen grid place-items-center">Checking access…</div>;
  if (!isAdmin) return <div className="min-h-screen grid place-items-center"><Card><CardHeader><ShieldX className="h-10 w-10 text-destructive" /><CardTitle>Access denied</CardTitle></CardHeader></Card></div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container flex items-center justify-between py-4">
          <div>
            <h1 className="text-xl font-bold text-primary">Lead Sources</h1>
            <p className="text-xs text-muted-foreground">Manage customer-facing choices, normalization aliases, and Jobber mapping policy.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/admin"><ArrowLeft className="mr-2 h-4 w-4" />Admin</Link></Button>
            <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="container py-6">
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader><CardTitle>Source catalog</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {rows.map((row) => (
                <button key={row.id} onClick={() => setSelectedId(row.id)} className={`w-full rounded-md border p-3 text-left ${selectedId === row.id ? 'border-primary bg-muted' : 'hover:bg-muted/60'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{row.display_name}</span>
                    <span className={`text-[10px] uppercase ${row.is_active ? 'text-primary' : 'text-muted-foreground'}`}>{row.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{row.channel_group} · {row.jobber_mapping_mode}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{selected ? selected.display_name : 'Select a source'}</CardTitle></CardHeader>
            {selected && <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1"><Label>Source key</Label><Input value={selected.source_key} disabled /></div>
                <div className="space-y-1"><Label>Display name</Label><Input value={selected.display_name} onChange={(e) => patchSelected({ display_name: e.target.value })} /></div>
                <div className="space-y-1"><Label>Channel group</Label><Input value={selected.channel_group} onChange={(e) => patchSelected({ channel_group: e.target.value })} /></div>
                <div className="space-y-1"><Label>Sort order</Label><Input type="number" value={selected.sort_order} onChange={(e) => patchSelected({ sort_order: Number(e.target.value) || 0 })} /></div>
              </div>

              <div className="space-y-1"><Label>Aliases</Label><Input value={selected.aliases.join(', ')} onChange={(e) => patchSelected({ aliases: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /><p className="text-xs text-muted-foreground">Comma-separated values used to normalize imported or spoken source names.</p></div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1"><Label>Jobber mapping</Label><Select value={selected.jobber_mapping_mode} onValueChange={(value) => patchSelected({ jobber_mapping_mode: value as LeadSourceRow['jobber_mapping_mode'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="internal_note">Internal note fallback</SelectItem><SelectItem value="custom_field">Custom field</SelectItem><SelectItem value="native">Native lead source</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></div>
                <div className="space-y-1"><Label>Mapping key</Label><Input value={selected.jobber_mapping_key ?? ''} onChange={(e) => patchSelected({ jobber_mapping_key: e.target.value })} placeholder="Optional custom field key" /></div>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3"><div><Label>Active</Label><p className="text-xs text-muted-foreground">Inactive sources disappear from new customer submissions but remain on historical records.</p></div><Switch checked={selected.is_active} onCheckedChange={(checked) => patchSelected({ is_active: checked })} /></div>

              <Button onClick={() => void save()} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save source'}</Button>
            </CardContent>}
          </Card>
        </div>
      </main>
    </div>
  );
}
