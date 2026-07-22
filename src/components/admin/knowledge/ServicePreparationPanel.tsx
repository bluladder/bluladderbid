import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ClipboardList } from 'lucide-react';

interface PrepRow {
  id: string;
  service_key: string;
  display_name: string;
  is_active: boolean;
  instructions: string[];
  notes: string | null;
  sort_order: number;
  updated_at: string;
}

type Draft = { display_name: string; instructionsText: string; notes: string };

function toDraft(row: PrepRow): Draft {
  return {
    display_name: row.display_name,
    instructionsText: (row.instructions ?? []).join('\n'),
    notes: row.notes ?? '',
  };
}

export function ServicePreparationPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_preparation_config')
      .select('*')
      .order('sort_order');
    if (error) {
      toast({ title: 'Failed to load preparation config', description: error.message, variant: 'destructive' });
      return;
    }
    const parsed = (data ?? []).map((r) => ({
      ...r,
      instructions: Array.isArray(r.instructions) ? (r.instructions as string[]) : [],
    })) as PrepRow[];
    setRows(parsed);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const editDraft = (row: PrepRow, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [row.id]: { ...(d[row.id] ?? toDraft(row)), ...patch } }));
  };

  const save = async (row: PrepRow) => {
    const draft = drafts[row.id] ?? toDraft(row);
    const instructions = draft.instructionsText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const { error } = await supabase
      .from('service_preparation_config')
      .update({
        display_name: draft.display_name.trim() || row.display_name,
        instructions,
        notes: draft.notes.trim() || null,
      })
      .eq('id', row.id);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Saved', description: row.display_name });
    setDrafts((d) => { const n = { ...d }; delete n[row.id]; return n; });
    load();
  };

  const toggleActive = async (row: PrepRow) => {
    const { error } = await supabase
      .from('service_preparation_config')
      .update({ is_active: !row.is_active })
      .eq('id', row.id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="w-4 h-4" /> Service Preparation Instructions
        </CardTitle>
        <CardDescription>
          Appended once to the BluLadder booking confirmation email — never re-sent on reschedule,
          never duplicated in an extra SMS. Only active services appear.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => {
          const draft = drafts[row.id] ?? toDraft(row);
          const dirty = drafts[row.id] !== undefined;
          return (
            <div key={row.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{row.display_name}</span>
                  <Badge variant="outline" className="text-[10px]">{row.service_key}</Badge>
                  {!row.is_active && <Badge variant="outline" className="text-[10px]">inactive</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(row)}>
                    {row.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                  {dirty && <Button size="sm" onClick={() => save(row)}>Save</Button>}
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <label className="text-xs text-muted-foreground">Display name</label>
                  <Input
                    value={draft.display_name}
                    onChange={(e) => editDraft(row, { display_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Admin notes (not shown to customers)</label>
                  <Input
                    value={draft.notes}
                    onChange={(e) => editDraft(row, { notes: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Instructions (one bullet per line)
                </label>
                <Textarea
                  rows={5}
                  value={draft.instructionsText}
                  onChange={(e) => editDraft(row, { instructionsText: e.target.value })}
                />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No preparation entries configured.</p>
        )}
      </CardContent>
    </Card>
  );
}