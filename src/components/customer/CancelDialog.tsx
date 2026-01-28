import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Calendar, Clock, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

interface CancelDialogProps {
  appointment: {
    id: string;
    reference_number: string;
    scheduled_start: string | null;
    total: number;
    services_json: Array<{ name: string; price: number }>;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function CancelDialog({
  appointment,
  open,
  onOpenChange,
  onComplete,
}: CancelDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      // Update booking status to cancelled (don't delete - preserve for records)
      const { error } = await supabase
        .from('bookings')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointment.id);

      if (error) throw error;

      // Log the cancellation for audit
      console.log('Appointment cancelled by customer:', {
        bookingId: appointment.id,
        referenceNumber: appointment.reference_number,
        scheduledTime: appointment.scheduled_start,
        timestamp: new Date().toISOString(),
      });

      // TODO: Trigger Jobber sync to release the slot
      // This would be done via an edge function call

      onComplete();
    } catch (err) {
      console.error('Failed to cancel appointment:', err);
      toast.error('Failed to cancel appointment. Please try again or contact support.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Cancel Appointment?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                Are you sure you want to cancel this appointment? This action cannot be undone.
              </p>
              
              <div className="bg-muted rounded-lg p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{appointment.reference_number}</span>
                </div>
                {appointment.scheduled_start && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span>{format(parseISO(appointment.scheduled_start), 'EEEE, MMMM d, yyyy')} at {format(parseISO(appointment.scheduled_start), 'h:mm a')}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  <span>{formatPrice(appointment.total)}</span>
                </div>
              </div>

              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Your time slot will be released and may be booked by another customer.
                  If you change your mind, you'll need to book a new appointment.
                </AlertDescription>
              </Alert>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Keep Appointment</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={isSubmitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              'Yes, Cancel Appointment'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
