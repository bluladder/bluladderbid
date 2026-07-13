import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Activity, AlertTriangle, MapPinOff } from 'lucide-react';

interface Issue {
  id: string;
  issue_type: string;
  severity: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  associated_ref: string | null;
  status: string;
  suggested_action: string | null;
}

const SEV_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'secondary', warning: 'outline', critical: 'destructive',
};

export function SystemHealthView() {
  const [issues, setIssues] = useState<Issue[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('system_issues').select('*')
      .neq('status', 'resolved').order('last_seen_at', { ascending: false }).limit(200);
    setIssues((data as Issue[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (i: Issue, status: string) => {
    await supabase.from('system_issues').update({ status }).eq('id', i.id);
    load();
  };

  return (
    <div className="space-y-4">
      {/* Persistent external blocker: Google Geocoding API misconfigured. */}
      <Alert variant="destructive">
        <MapPinOff className="h-4 w-4" />
        <AlertTitle>Service-area address validation unavailable</AlertTitle>
        <AlertDescription className="text-xs space-y-1">
          <p>The Google Geocoding API is not authorized for the server-side key, so addresses cannot be automatically validated.</p>
          <p><strong>Required action:</strong> enable and authorize the Geocoding API for the server-side Google Maps key.</p>
          <p><strong>Booking impact:</strong> affected addresses fall back to manual review — the AI never guesses eligibility.</p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="w-4 h-4" /> System Health</CardTitle>
          <CardDescription>Open operational issues that may need attention.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {issues.map((i) => (
            <div key={i.id} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
                  {i.issue_type.replace(/_/g, ' ')}
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant={SEV_VARIANT[i.severity] ?? 'outline'} className="text-[10px] capitalize">{i.severity}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{i.occurrence_count}×</Badge>
                </div>
              </div>
              {i.suggested_action && <p className="text-xs text-muted-foreground">{i.suggested_action}</p>}
              <div className="text-[11px] text-muted-foreground">
                First {new Date(i.first_seen_at).toLocaleString()} · Latest {new Date(i.last_seen_at).toLocaleString()}
                {i.associated_ref ? ` · ${i.associated_ref}` : ''}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setStatus(i, 'acknowledged')}>Acknowledge</Button>
                <Button size="sm" variant="ghost" onClick={() => setStatus(i, 'resolved')}>Resolve</Button>
              </div>
            </div>
          ))}
          {issues.length === 0 && <p className="text-sm text-muted-foreground">No open operational issues.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
