import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  RefreshCw, 
  Clock, 
  Calendar,
  Database,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Zap
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow, addMinutes, addDays } from 'date-fns';

interface AutosyncConfig {
  id: string;
  enabled: boolean;
  near_term_horizon_days: number;
  near_term_interval_minutes: number;
  far_term_current_horizon_days: number;
  far_term_max_horizon_days: number;
  far_term_daily_chunk_days: number;
  last_near_term_sync: string | null;
  last_far_term_sync: string | null;
  lock_holder_id: string | null;
  lock_acquired_at: string | null;
  last_run_status: string;
  last_run_error: string | null;
  total_blocks_synced: number;
  earliest_coverage_date: string | null;
  latest_coverage_date: string | null;
  updated_at: string;
}

interface CoverageStats {
  totalBlocks: number;
  earliestDate: Date | null;
  latestDate: Date | null;
  coverageDays: number;
}

export function AutosyncStatus() {
  const [config, setConfig] = useState<AutosyncConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('autosync_config')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();
      
      if (error) throw error;
      
      // Cast to our interface since types may not be updated yet
      setConfig(data as unknown as AutosyncConfig);
    } catch (error) {
      console.error('Failed to fetch autosync config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchConfig, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleEnabled = async (enabled: boolean) => {
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from('autosync_config')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      
      if (error) throw error;
      
      setConfig(prev => prev ? { ...prev, enabled } : null);
      toast.success(enabled ? 'Autopilot enabled' : 'Autopilot disabled');
    } catch (error) {
      console.error('Failed to toggle autosync:', error);
      toast.error('Failed to update setting');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-autosync', {
        body: { force: true }
      });
      
      if (error) throw error;
      
      if (data?.skipped) {
        toast.info(data.message || 'Sync skipped');
      } else if (data?.success) {
        const nearTermVisits = data.nearTerm?.totalVisits || 0;
        const farTermVisits = data.farTerm?.totalVisits || 0;
        toast.success(`Synced ${nearTermVisits + farTermVisits} visits`);
      } else {
        toast.warning(data?.message || 'Sync completed with warnings');
      }
      
      // Refresh config after sync
      await fetchConfig();
    } catch (error: any) {
      console.error('Sync failed:', error);
      toast.error(error?.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusBadge = () => {
    if (!config) return null;
    
    const isRunning = config.lock_holder_id !== null;
    const status = config.last_run_status;
    
    if (isRunning) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </Badge>
      );
    }
    
    switch (status) {
      case 'completed':
        return (
          <Badge variant="default" className="flex items-center gap-1 bg-green-600">
            <CheckCircle className="w-3 h-3" />
            Healthy
          </Badge>
        );
      case 'throttled':
        return (
          <Badge variant="secondary" className="flex items-center gap-1 bg-yellow-600">
            <AlertTriangle className="w-3 h-3" />
            Throttled
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Idle
          </Badge>
        );
    }
  };

  const getCoverageStats = (): CoverageStats => {
    if (!config) {
      return { totalBlocks: 0, earliestDate: null, latestDate: null, coverageDays: 0 };
    }
    
    const earliestDate = config.earliest_coverage_date 
      ? new Date(config.earliest_coverage_date) 
      : null;
    const latestDate = config.latest_coverage_date 
      ? new Date(config.latest_coverage_date) 
      : null;
    
    let coverageDays = 0;
    if (latestDate) {
      const now = new Date();
      coverageDays = Math.ceil((latestDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
    
    return {
      totalBlocks: config.total_blocks_synced || 0,
      earliestDate,
      latestDate,
      coverageDays: Math.max(0, coverageDays),
    };
  };

  const getNextScheduledRun = (): Date | null => {
    if (!config?.last_near_term_sync) return null;
    const lastSync = new Date(config.last_near_term_sync);
    return addMinutes(lastSync, config.near_term_interval_minutes || 15);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const coverageStats = getCoverageStats();
  const nextRun = getNextScheduledRun();
  const isRunning = config?.lock_holder_id !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Autopilot Schedule Sync
            </CardTitle>
            <CardDescription>
              Automatically keeps calendar synced with Jobber
            </CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
          <div className="space-y-0.5">
            <Label htmlFor="autopilot-toggle" className="text-base font-medium">
              Autopilot Mode
            </Label>
            <p className="text-sm text-muted-foreground">
              Auto-sync every {config?.near_term_interval_minutes || 15} minutes
            </p>
          </div>
          <Switch
            id="autopilot-toggle"
            checked={config?.enabled ?? false}
            onCheckedChange={handleToggleEnabled}
            disabled={isUpdating}
          />
        </div>

        {/* Last/Next Sync Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="w-4 h-4" />
              Last Sync
            </div>
            <p className="font-medium">
              {config?.last_near_term_sync 
                ? formatDistanceToNow(new Date(config.last_near_term_sync), { addSuffix: true })
                : 'Never'
              }
            </p>
            {config?.last_near_term_sync && (
              <p className="text-xs text-muted-foreground mt-1">
                {format(new Date(config.last_near_term_sync), 'MMM d, h:mm a')}
              </p>
            )}
          </div>
          
          <div className="p-4 rounded-lg border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Calendar className="w-4 h-4" />
              Next Run
            </div>
            <p className="font-medium">
              {nextRun && config?.enabled
                ? formatDistanceToNow(nextRun, { addSuffix: true })
                : config?.enabled ? 'Pending' : 'Disabled'
              }
            </p>
            {nextRun && config?.enabled && (
              <p className="text-xs text-muted-foreground mt-1">
                {format(nextRun, 'MMM d, h:mm a')}
              </p>
            )}
          </div>
        </div>

        {/* Coverage Stats */}
        <div className="p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <Database className="w-4 h-4" />
            Mirror Coverage
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{coverageStats.totalBlocks}</p>
              <p className="text-xs text-muted-foreground">Total Blocks</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{coverageStats.coverageDays}</p>
              <p className="text-xs text-muted-foreground">Days Ahead</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {config?.far_term_current_horizon_days || 0}/{config?.far_term_max_horizon_days || 365}
              </p>
              <p className="text-xs text-muted-foreground">Horizon</p>
            </div>
          </div>
          {coverageStats.earliestDate && coverageStats.latestDate && (
            <p className="text-xs text-muted-foreground text-center mt-3">
              {format(coverageStats.earliestDate, 'MMM d')} → {format(coverageStats.latestDate, 'MMM d, yyyy')}
            </p>
          )}
        </div>

        {/* Error Alert */}
        {config?.last_run_status === 'failed' && config?.last_run_error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              Last sync failed: {config.last_run_error}
            </AlertDescription>
          </Alert>
        )}

        {config?.last_run_status === 'throttled' && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Sync was throttled by Jobber. Will retry on next scheduled run.
            </AlertDescription>
          </Alert>
        )}

        {/* Manual Sync Button */}
        <Button 
          onClick={handleSyncNow} 
          disabled={isSyncing || isRunning}
          className="w-full"
          variant="outline"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing || isRunning ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : isRunning ? 'Sync in Progress...' : 'Sync Now'}
        </Button>

        {/* Verification Query Results */}
        <div className="text-xs text-muted-foreground border-t pt-4 mt-4">
          <p className="font-medium mb-2">Sync Schedule:</p>
          <ul className="space-y-1">
            <li>• Near-term: Every {config?.near_term_interval_minutes || 15} min (next {config?.near_term_horizon_days || 30} days)</li>
            <li>• Far-term: Daily at 2:30am (extending to {config?.far_term_max_horizon_days || 365} days)</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
