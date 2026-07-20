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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  onComplete: (outcome?: 'cancelled' | 'needs_attention') => void;
  // Admin override props
  isAdminOverride?: boolean;
  adminUserId?: string;
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
  isAdminOverride,
  adminUserId,
}: CancelDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Structured reason category (never free-text-only) so the campaign engine
  // can reason about the cancellation without leaking raw customer text.
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      // Call edge function for cancel
      const { data, error } = await supabase.functions.invoke('customer-appointment-actions', {
        body: {
          action: 'cancel',
          bookingId: appointment.id,
          isAdminOverride,
          adminUserId,
          cancellationReason: reason || null,
          cancellationNotes: notes.trim() ? notes.trim().slice(0, 500) : null,
        },
      });

      if (error) throw error;

      // Lockout / hard error paths (surface a friendly message, never a Jobber id).
      if (data?.error) {
        if (data.code === 'LOCKOUT') {
          toast.error(data.details || 'Appointments cannot be cancelled within 48 hours');
        } else {
          throw new Error(data.details || data.error);
        }
        return;
      }

      // Fail-closed: cancellation could not be confirmed with the scheduling
      // system. Show a pending message — NOT a success — and refresh.
      if (data?.needsAttention || data?.status === 'needs_attention') {
        toast.message(
          data?.message ||
            "We received your cancellation request, but it still needs to be confirmed by our team. We'll contact you shortly.",
        );
        onComplete('needs_attention');
        return;
      }

      // Confirmed cancellation (or idempotent replay of an already-cancelled one).
      toast.success(
        data?.status === 'already_cancelled'
          ? 'This appointment is already cancelled.'
          : 'Appointment cancelled.',
      );
      onComplete('cancelled');
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

              <div className="space-y-2">
                <Label htmlFor="cancel-reason">Reason for cancelling (optional)</Label>
                <Select value={reason || '__none__'} onValueChange={(v) => setReason(v === '__none__' ? '' : v)}>
                  <SelectTrigger id="cancel-reason">
                    <SelectValue placeholder="Choose a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Prefer not to say</SelectItem>
                    <SelectItem value="schedule_conflict">Schedule conflict</SelectItem>
                    <SelectItem value="no_longer_needed">No longer need the service</SelectItem>
                    <SelectItem value="price">Price</SelectItem>
                    <SelectItem value="booking_mistake">Booking mistake</SelectItem>
                    <SelectItem value="rebooking_later">Will rebook later</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea
                  id="cancel-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                  placeholder="Anything else you'd like us to know? (optional)"
                  rows={2}
                />
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
