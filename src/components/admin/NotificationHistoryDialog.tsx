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
import { 
  Loader2, 
  Bell, 
  BellOff, 
  Mail, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Calendar,
  Edit,
  User,
  ShieldAlert
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface NotificationEvent {
  id: string;
  event_type: string;
  triggered_by: string;
  triggered_by_id: string | null;
  channel: string;
  sent_at: string | null;
  suppressed: boolean;
  suppressed_reason: string | null;
  notification_content: {
    subject?: string;
    recipient?: string;
    requireConfirmation?: boolean;
    confirmationToken?: string;
    error?: string;
  } | null;
  customer_action: string | null;
  customer_action_at: string | null;
  created_at: string;
}

interface NotificationHistoryDialogProps {
  bookingId: string;
  referenceNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'scheduled': return <Calendar className="w-4 h-4" />;
    case 'rescheduled': return <Clock className="w-4 h-4" />;
    case 'cancelled': return <XCircle className="w-4 h-4" />;
    case 'services_modified': return <Edit className="w-4 h-4" />;
    default: return <Bell className="w-4 h-4" />;
  }
}

function getEventLabel(eventType: string) {
  switch (eventType) {
    case 'scheduled': return 'Scheduled';
    case 'rescheduled': return 'Rescheduled';
    case 'cancelled': return 'Cancelled';
    case 'services_modified': return 'Services Modified';
    case 'price_changed': return 'Price Changed';
    case 'tech_reassigned': return 'Tech Reassigned';
    default: return eventType;
  }
}

function getCustomerActionBadge(action: string | null) {
  if (!action) return null;
  switch (action) {
    case 'accepted':
      return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Accepted</Badge>;
    case 'declined':
      return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Declined</Badge>;
    case 'pending':
      return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    default:
      return null;
  }
}

export function NotificationHistoryDialog({
  bookingId,
  referenceNumber,
  open,
  onOpenChange,
}: NotificationHistoryDialogProps) {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (open) {
      loadEvents();
    }
  }, [open, bookingId]);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_events')
        .select('*')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEvents((data || []) as NotificationEvent[]);
    } catch (err) {
      console.error('Failed to load notification events:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notification History
          </DialogTitle>
          <DialogDescription>
            All notifications sent for {referenceNumber}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BellOff className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No notifications sent yet</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              {events.map((event, idx) => (
                <div key={event.id}>
                  {idx > 0 && <Separator className="mb-4" />}
                  
                  <div className="space-y-2">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getEventIcon(event.event_type)}
                        <span className="font-medium">{getEventLabel(event.event_type)}</span>
                        {event.suppressed ? (
                          <Badge variant="outline" className="text-xs">
                            <BellOff className="w-3 h-3 mr-1" />
                            Not Sent
                          </Badge>
                        ) : event.sent_at ? (
                          <Badge className="bg-green-100 text-green-800 text-xs">
                            <Mail className="w-3 h-3 mr-1" />
                            Sent
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Pending</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(event.created_at), 'MMM d, h:mm a')}
                      </span>
                    </div>

                    {/* Triggered By */}
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      {event.triggered_by === 'admin' ? (
                        <ShieldAlert className="w-3 h-3" />
                      ) : (
                        <User className="w-3 h-3" />
                      )}
                      <span>Triggered by: {event.triggered_by}</span>
                    </div>

                    {/* Recipient */}
                    {event.notification_content?.recipient && (
                      <div className="text-sm text-muted-foreground">
                        To: {event.notification_content.recipient}
                      </div>
                    )}

                    {/* Subject */}
                    {event.notification_content?.subject && (
                      <div className="bg-muted/50 rounded-lg p-2 text-sm">
                        <span className="text-muted-foreground">Subject:</span>{' '}
                        {event.notification_content.subject}
                      </div>
                    )}

                    {/* Suppressed Reason */}
                    {event.suppressed && event.suppressed_reason && (
                      <div className="text-sm text-amber-600">
                        Reason: {event.suppressed_reason}
                      </div>
                    )}

                    {/* Error */}
                    {event.notification_content?.error && (
                      <div className="text-sm text-destructive">
                        Error: {event.notification_content.error}
                      </div>
                    )}

                    {/* Customer Action */}
                    {event.customer_action && (
                      <div className="flex items-center gap-2">
                        {getCustomerActionBadge(event.customer_action)}
                        {event.customer_action_at && (
                          <span className="text-xs text-muted-foreground">
                            at {format(parseISO(event.customer_action_at), 'MMM d, h:mm a')}
                          </span>
                        )}
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
