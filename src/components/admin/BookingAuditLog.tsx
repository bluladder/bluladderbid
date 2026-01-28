import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Loader2, History, User, ShieldAlert, Calendar, Edit, XCircle, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface AuditEntry {
  id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_by: string;
  changed_by_id: string | null;
  is_admin_override: boolean;
  created_at: string;
}

interface BookingAuditLogProps {
  bookingId: string;
  referenceNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getActionIcon(action: string) {
  switch (action) {
    case 'reschedule': return <Calendar className="w-4 h-4" />;
    case 'modify_services': return <Edit className="w-4 h-4" />;
    case 'cancel': return <XCircle className="w-4 h-4" />;
    default: return <RotateCcw className="w-4 h-4" />;
  }
}

function getActionLabel(action: string) {
  switch (action) {
    case 'reschedule': return 'Rescheduled';
    case 'modify_services': return 'Services Modified';
    case 'cancel': return 'Cancelled';
    default: return action;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T/)) {
    try {
      return format(parseISO(value), 'MMM d, yyyy h:mm a');
    } catch {
      return value;
    }
  }
  return String(value);
}

export function BookingAuditLog({
  bookingId,
  referenceNumber,
  open,
  onOpenChange,
}: BookingAuditLogProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (open) {
      loadAuditLog();
    }
  }, [open, bookingId]);

  const loadAuditLog = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('booking_audit_log')
        .select('*')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEntries((data || []) as AuditEntry[]);
    } catch (err) {
      console.error('Failed to load audit log:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Change History
          </DialogTitle>
          <DialogDescription>
            Audit trail for {referenceNumber}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No changes recorded yet</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              {entries.map((entry, idx) => (
                <div key={entry.id}>
                  {idx > 0 && <Separator className="mb-4" />}
                  
                  <div className="space-y-2">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getActionIcon(entry.action)}
                        <span className="font-medium">{getActionLabel(entry.action)}</span>
                        {entry.is_admin_override && (
                          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                            <ShieldAlert className="w-3 h-3 mr-1" />
                            Admin Override
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(entry.created_at), 'MMM d, yyyy h:mm a')}
                      </span>
                    </div>

                    {/* Changed By */}
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span>By: {entry.changed_by === 'admin' ? 'Admin' : 'Customer'}</span>
                    </div>

                    {/* Changes Detail */}
                    {entry.new_values && (
                      <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                        {Object.entries(entry.new_values)
                          .filter(([key]) => !['action', 'requiresReschedule'].includes(key))
                          .map(([key, value]) => {
                            const oldValue = entry.old_values?.[key];
                            const displayKey = key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
                            
                            return (
                              <div key={key} className="flex flex-wrap gap-1">
                                <span className="text-muted-foreground capitalize">{displayKey}:</span>
                                {oldValue !== undefined && oldValue !== value && (
                                  <span className="line-through text-muted-foreground">
                                    {formatValue(oldValue)}
                                  </span>
                                )}
                                <span className="font-medium">{formatValue(value)}</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
