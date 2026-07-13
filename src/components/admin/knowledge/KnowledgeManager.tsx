import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { BookOpen, RefreshCw, Search } from 'lucide-react';

interface KRow {
  id: string;
  knowledge_key: string;
  category: string;
  title: string;
  content: string;
  is_active: boolean;
  review_status: string;
  source_type: string;
  source_page: string | null;
  applicable_service: string | null;
  last_checked_at: string | null;
  pending_content: string | null;
  requires_owner_review: boolean;
  revision: number;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  published: 'default', draft: 'secondary', conflict: 'destructive', rejected: 'outline',
};

export function KnowledgeManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<KRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'conflict'>('all');
  const [q, setQ] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [editContent, setEditContent] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase.from('business_knowledge').select('*').order('priority').order('sort_order');
    setRows((data as KRow[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const runSync = async (dryRun: boolean) => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-sync', { body: { dryRun } });
      if (error) throw error;
      const s = (data as { summary?: Record<string, number> })?.summary;
      toast({
        title: dryRun ? 'Dry run complete' : 'Sync complete',
        description: s ? `New: ${s.new_draft ?? 0}, Changed: ${s.changed_draft ?? 0}, Conflicts: ${s.conflict ?? 0}, Unchanged: ${s.unchanged ?? 0}` : 'Done',
      });
      if (!dryRun) load();
    } catch (e) {
      toast({ title: 'Sync failed', description: e instanceof Error ? e.message : 'error', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const approvePending = async (row: KRow) => {
    const patch = row.pending_content
      ? { content: row.pending_content, pending_content: null, pending_source_hash: null }
      : {};
    const { error } = await supabase.from('business_knowledge').update({
      ...patch, review_status: 'published', is_active: true, requires_owner_review: false,
    }).eq('id', row.id);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Published', description: row.title });
    load();
  };

  const reject = async (row: KRow) => {
    const { error } = await supabase.from('business_knowledge').update({
      review_status: 'rejected', is_active: false, pending_content: null, pending_source_hash: null,
    }).eq('id', row.id);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Rejected', description: row.title });
    load();
  };

  const saveEdit = async (row: KRow) => {
    const c = editContent[row.id];
    if (c === undefined) return;
    const { error } = await supabase.from('business_knowledge').update({ content: c }).eq('id', row.id);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Saved', description: row.title });
    setEditContent((e) => { const n = { ...e }; delete n[row.id]; return n; });
    load();
  };

  const toggleActive = async (row: KRow) => {
    const { error } = await supabase.from('business_knowledge').update({ is_active: !row.is_active }).eq('id', row.id);
    if (!error) load();
  };

  const filtered = rows.filter((r) => {
    if (filter !== 'all' && r.review_status !== filter) return false;
    if (q && !(`${r.title} ${r.content} ${r.category} ${r.applicable_service ?? ''}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><BookOpen className="w-4 h-4" /> Business Knowledge</CardTitle>
            <CardDescription>Only active, published knowledge reaches the AI. Website material stays draft until you approve it.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => runSync(true)}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} /> Dry run
            </Button>
            <Button size="sm" disabled={syncing} onClick={() => runSync(false)}>Sync website</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'published', 'draft', 'conflict'] as const).map((f) => (
            <Badge key={f} variant={filter === f ? 'default' : 'outline'} className="cursor-pointer capitalize" onClick={() => setFilter(f)}>{f}</Badge>
          ))}
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input className="pl-7 h-9 w-56" placeholder="Search question / service / category" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {filtered.map((row) => (
          <div key={row.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{row.title}</div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{row.category}</Badge>
                <Badge variant={STATUS_VARIANT[row.review_status] ?? 'outline'} className="text-[10px] capitalize">{row.review_status}</Badge>
                {row.source_type === 'website' && <Badge variant="secondary" className="text-[10px]">website</Badge>}
                {!row.is_active && <Badge variant="outline" className="text-[10px]">inactive</Badge>}
              </div>
            </div>

            <Textarea
              rows={3}
              value={editContent[row.id] ?? row.content}
              onChange={(e) => setEditContent((s) => ({ ...s, [row.id]: e.target.value }))}
            />

            {row.pending_content && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 p-2 text-xs">
                <div className="font-medium mb-1">Proposed website change (not published):</div>
                <div className="text-muted-foreground line-clamp-4">{row.pending_content}</div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {row.source_page && <span>Source: {row.source_page}</span>}
              {row.last_checked_at && <span>· Checked {new Date(row.last_checked_at).toLocaleString()}</span>}
              <span>· rev {row.revision}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {editContent[row.id] !== undefined && <Button size="sm" onClick={() => saveEdit(row)}>Save answer</Button>}
              {(row.review_status === 'draft' || row.review_status === 'conflict' || row.pending_content) && (
                <>
                  <Button size="sm" onClick={() => approvePending(row)}>Approve &amp; publish</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(row)}>Reject</Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => toggleActive(row)}>{row.is_active ? 'Deactivate' : 'Activate'}</Button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground">No knowledge matches.</p>}
      </CardContent>
    </Card>
  );
}
