import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle, XCircle, RefreshCw, Link as LinkIcon, ExternalLink, Calendar, Database } from 'lucide-react';
import { toast } from 'sonner';

export function JobberIntegration() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedSince, setConnectedSince] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncHorizon, setSyncHorizon] = useState<string>("60");
  const [syncState, setSyncState] = useState<{
    lastBackfillAt: string | null;
    backfillInProgress: boolean;
  } | null>(null);

  const checkConnection = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-connection-status');
      if (error) throw error;
      setIsConnected(data.connected);
      setConnectedSince(data.connectedSince);
    } catch (error) {
      console.error('Failed to check Jobber connection:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSyncState = async () => {
    const { data } = await (supabase as any)
      .from('jobber_sync_state')
      .select('last_backfill_at, backfill_in_progress')
      .eq('id', 'default')
      .maybeSingle();
    
    if (data) {
      setSyncState({
        lastBackfillAt: data.last_backfill_at,
        backfillInProgress: data.backfill_in_progress,
      });
    }
  };

  useEffect(() => {
    checkConnection();
    fetchSyncState();
    
    const params = new URLSearchParams(window.location.search);
    if (params.get('jobber_success') === 'true') {
      toast.success('Jobber connected successfully!');
      window.history.replaceState({}, '', window.location.pathname);
      checkConnection();
    } else if (params.get('jobber_error')) {
      toast.error(`Jobber connection failed: ${params.get('jobber_error')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-oauth-url');
      if (error) throw new Error(error.message || 'Failed to get authorization URL');
      if (!data?.authUrl) throw new Error('No authorization URL returned');
      
      const popup = window.open(data.authUrl, '_blank', 'width=600,height=700');
      if (!popup) window.open(data.authUrl, '_blank');
      toast.info('Complete the authorization in the popup window, then refresh this page.');
    } catch (error) {
      console.error('Failed to initiate Jobber connection:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to connect to Jobber');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Jobber?')) return;
    try {
      const { error } = await supabase
        .from('jobber_oauth_tokens')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
      setIsConnected(false);
      setConnectedSince(null);
      toast.success('Jobber disconnected');
    } catch (error) {
      console.error('Failed to disconnect Jobber:', error);
      toast.error('Failed to disconnect Jobber');
    }
  };

  const handleSyncSchedule = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-sync-schedule', {
        body: { horizonDays: parseInt(syncHorizon) }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      toast.success(`Synced ${data.visitsProcessed} visits (${data.blocksInserted} blocks created)`);
      fetchSyncState();
    } catch (error: any) {
      console.error('Sync failed:', error);
      toast.error(error?.message || 'Failed to sync schedule');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="w-5 h-5" />
                Jobber Integration
              </CardTitle>
              <CardDescription>Connect to Jobber for instant booking</CardDescription>
            </div>
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isLoading ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : isConnected ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
              {isLoading ? 'Checking...' : isConnected ? 'Connected' : 'Not Connected'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <>
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Jobber is connected.
                  {connectedSince && <span className="block text-xs text-muted-foreground mt-1">Since: {new Date(connectedSince).toLocaleDateString()}</span>}
                </AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button variant="outline" onClick={checkConnection} disabled={isLoading}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button variant="destructive" onClick={handleDisconnect}>Disconnect</Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button onClick={handleConnect} disabled={isLoading}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Connect to Jobber
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Schedule Mirror
            </CardTitle>
            <CardDescription>Sync Jobber schedule to local database for fast availability</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {syncState?.lastBackfillAt ? (
              <Alert>
                <Calendar className="h-4 w-4" />
                <AlertDescription>
                  Last synced: {new Date(syncState.lastBackfillAt).toLocaleString()}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertDescription>
                  Schedule not synced yet. Run initial sync to enable availability.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-3">
              <Select value={syncHorizon} onValueChange={setSyncHorizon}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleSyncSchedule} disabled={isSyncing || syncState?.backfillInProgress}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Schedule'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}