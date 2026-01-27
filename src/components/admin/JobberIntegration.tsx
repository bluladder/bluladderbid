import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, XCircle, RefreshCw, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { AutosyncStatus } from './AutosyncStatus';

export function JobberIntegration() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedSince, setConnectedSince] = useState<string | null>(null);

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

  useEffect(() => {
    checkConnection();
    
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="w-5 h-5" />
                Jobber Connection
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

      {/* Autopilot Sync Status - only show when connected */}
      {isConnected && <AutosyncStatus />}
    </div>
  );
}