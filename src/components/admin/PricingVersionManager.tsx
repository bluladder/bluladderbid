import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { History, UploadCloud } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface PricingVersion {
  version: number;
  note: string | null;
  published_at: string;
}

export function PricingVersionManager() {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const { data: versions, isLoading } = useQuery({
    queryKey: ['pricing-versions'],
    queryFn: async (): Promise<PricingVersion[]> => {
      const { data, error } = await supabase
        .from('pricing_versions')
        .select('version, note, published_at')
        .order('version', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PricingVersion[];
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('publish_pricing_version', {
        p_note: note.trim() || null,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (v) => {
      toast.success(`Published pricing version ${v}`);
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['pricing-versions'] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to publish pricing');
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5" /> Publish Pricing
          </CardTitle>
          <CardDescription>
            Saves a dated, immutable snapshot of the current pricing so historical quotes are
            never affected by future changes. New quotes are stamped with the latest version.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Optional note (e.g. 'Q3 window rate update')"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
          />
          <Button onClick={() => publish.mutate()} disabled={publish.isPending}>
            {publish.isPending ? 'Publishing…' : 'Publish current pricing'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" /> Version History
          </CardTitle>
          <CardDescription>Every published pricing snapshot.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : versions && versions.length > 0 ? (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between border-b py-2 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">v{v.version}</Badge>
                    <span className="text-sm">{v.note || 'No note'}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.published_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No versions published yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}