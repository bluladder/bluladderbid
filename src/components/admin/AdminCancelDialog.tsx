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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Loader2, AlertTriangle, Calendar, Clock, DollarSign, ShieldAlert, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

interface AdminCancelDialogProps {
  appointment: {
    id: string;
    reference_number: string;
    scheduled_start: string | null;
    total: number;
    services_json: Array<{ name: string; price: number }>;
    customer?: {
      first_name: string | null;
      last_name: string | null;
    } | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  adminUserId: string;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function AdminCancelDialog({
  appointment,
  open,
  onOpenChange,
  onComplete,
  adminUserId,
}: AdminCancelDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  const customerName = [appointment.customer?.first_name, appointment.customer?.last_name]
    .filter(Boolean).join(' ') || 'Customer';

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      // Call edge function for cancel with admin override
      const { data, error } = await supabase.functions.invoke('customer-appointment-actions', {
        body: {
          action: 'cancel',
          bookingId: appointment.id,
          isAdminOverride: true,
          adminUserId,
          reason,
        },
      });

      if (error) throw error;
      
      if (data?.error) {
        throw new Error(data.details || data.error);
      }

      // Send notification if requested
      if (notifyCustomer) {
        await supabase.functions.invoke('send-notification', {
          body: {
            bookingId: appointment.id,
            eventType: 'cancelled',
            triggeredBy: 'admin',
            triggeredById: adminUserId,
            notifyCustomer: true,
            requireConfirmation: false,
            showPriceChange: true,
            adminNote: reason || undefined,
            oldValues: { 
              scheduled_start: appointment.scheduled_start,
              total: appointment.total,
            },
            newValues: { status: 'cancelled' },
          },
        });
      }

      toast.success('Appointment cancelled');
      onComplete();
    } catch (err) {
      console.error('Failed to cancel appointment:', err);
      toast.error('Failed to cancel appointment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="w-5 h-5" />
            Admin Cancel Appointment
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                You are about to cancel this appointment as an admin. This bypasses the 48-hour lockout.
              </p>
              
              <div className="bg-muted rounded-lg p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{appointment.reference_number}</span>
                  <span className="text-muted-foreground">({customerName})</span>
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
                <Label htmlFor="cancel-reason">Cancellation Reason (optional)</Label>
                <Textarea
                  id="cancel-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter reason for cancellation..."
                  rows={2}
                />
              </div>

              <Separator />

              {/* Notify Customer */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="notify-customer-cancel"
                  checked={notifyCustomer}
                  onCheckedChange={(checked) => setNotifyCustomer(checked === true)}
                />
                <Label htmlFor="notify-customer-cancel" className="text-sm font-normal cursor-pointer flex items-center gap-1">
                  <Bell className="w-3 h-3" />
                  Notify customer of cancellation
                </Label>
              </div>

              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This will cancel the appointment in Jobber and release the time slot.
                  This action will be logged in the audit trail.
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
              'Cancel Appointment'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
