import { RefreshCw, Cloud, Info, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ScheduleSourceIndicatorProps {
  lastSyncTime?: string | null;
  isConnected?: boolean;
  showDetails?: boolean;
}

export function ScheduleSourceIndicator({ 
  lastSyncTime, 
  isConnected = true,
  showDetails = true 
}: ScheduleSourceIndicatorProps) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-muted">
        <Cloud className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Schedule Source</span>
            {isConnected ? (
              <Badge variant="secondary" className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                <CheckCircle className="w-3 h-3 mr-1" />
                Synced from Jobber
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                <XCircle className="w-3 h-3 mr-1" />
                Disconnected
              </Badge>
            )}
          </div>
          
          {showDetails && (
            <div className="mt-1.5 space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="w-3 h-3" />
                Busy blocks include <span className="font-medium">scheduled</span> and <span className="font-medium">in-progress</span> jobs
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-green-600" />
                Cancelled jobs do <span className="font-medium">not</span> block availability
              </p>
            </div>
          )}
        </div>

        {lastSyncTime && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="w-3 h-3" />
                <span className="hidden sm:inline">Last sync:</span>
                <span className="font-mono">{lastSyncTime}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Schedule data is kept in sync automatically</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
