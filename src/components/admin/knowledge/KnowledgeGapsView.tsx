import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { HelpCircle } from 'lucide-react';

interface Gap {
  id: string;
  normalized_question: string;
  example_wording: string | null;
  service: string | null;
  category: string | null;
  conversation_count: number;
  handoff_count: number;
  status: string;
  reason: string | null;
  last_seen_at: string;
}

export function KnowledgeGapsView() {
  const { toast } = useToast();
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('knowledge_gaps').select('*')
      .order('conversation_count', { ascending: false }).limit(200);
    setGaps((data as Gap[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const createDraft = async (g: Gap) => {
    const key = `gap:${g.id.slice(0, 8)}`;
    const { data: k, error } = await supabase.from('business_knowledge').insert({
      knowledge_key: key,
      category: g.category ?? 'faq',
      title: (g.example_wording ?? g.normalized_question).slice(0, 120),
      content: 'DRAFT — write the approved answer here, then Approve & publish.',
      is_active: false,
      source_type: 'manual',
      review_status: 'draft',
      requires_owner_review: true,
      applicable_service: g.service,
    }).select('id').single();
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('knowledge_gaps').update({ status: 'in_progress', related_knowledge_id: k?.id }).eq('id', g.id);
    toast({ title: 'Draft created', description: 'Fill it in under Business Knowledge, then publish.' });
    load();
  };

  const setStatus = async (g: Gap, status: string) => {
    await supabase.from('knowledge_gaps').update({ status }).eq('id', g.id);
    load();
  };

  const visible = gaps.filter((g) => showResolved || (g.status !== 'resolved' && g.status !== 'dismissed'));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><HelpCircle className="w-4 h-4" /> Knowledge Gaps</CardTitle>
            <CardDescription>Questions the AI could not answer well. Create a draft answer — it never auto-publishes.</CardDescription>
          </div>
          <Badge variant="outline" className="cursor-pointer" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.map((g) => (
          <div key={g.id} className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{g.example_wording ?? g.normalized_question}</div>
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px]">{g.conversation_count}×</Badge>
                {g.handoff_count > 0 && <Badge variant="destructive" className="text-[10px]">{g.handoff_count} handoffs</Badge>}
                <Badge variant="outline" className="text-[10px] capitalize">{g.status}</Badge>
              </div>
            </div>
            {g.reason && <p className="text-xs text-muted-foreground">{g.reason}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => createDraft(g)}>Create draft answer</Button>
              <Button size="sm" variant="outline" onClick={() => setStatus(g, 'resolved')}>Resolve</Button>
              <Button size="sm" variant="ghost" onClick={() => setStatus(g, 'dismissed')}>Dismiss</Button>
            </div>
          </div>
        ))}
        {visible.length === 0 && <p className="text-sm text-muted-foreground">No open knowledge gaps. 🎉</p>}
      </CardContent>
    </Card>
  );
}
