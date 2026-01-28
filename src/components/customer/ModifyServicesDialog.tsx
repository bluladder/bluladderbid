import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Loader2, Edit, AlertCircle, Check, Clock, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

interface ModifyServicesDialogProps {
  appointment: {
    id: string;
    reference_number: string;
    scheduled_start: string | null;
    duration_minutes: number;
    total: number;
    subtotal: number;
    services_json: Array<{ name: string; price: number }>;
    home_details_json: Record<string, unknown>;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  // For triggering reschedule flow if needed
  onNeedsReschedule?: () => void;
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

export function ModifyServicesDialog({
  appointment,
  open,
  onOpenChange,
  onComplete,
  onNeedsReschedule,
  isAdminOverride,
  adminUserId,
}: ModifyServicesDialogProps) {
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requiresReschedule, setRequiresReschedule] = useState(false);
  const [rescheduleReason, setRescheduleReason] = useState('');

  // Initialize with current services
  useEffect(() => {
    if (open) {
      const currentServiceNames = appointment.services_json.map(s => s.name);
      setSelectedServices(currentServiceNames);
      setRequiresReschedule(false);
      setRescheduleReason('');
    }
  }, [open, appointment]);

  const currentServices = appointment.services_json;
  const newTotal = selectedServices.reduce((sum, name) => {
    const existing = currentServices.find(s => s.name === name);
    return sum + (existing?.price || 0);
  }, 0);

  const totalChange = newTotal - appointment.total;
  const servicesChanged = JSON.stringify(selectedServices.sort()) !== 
    JSON.stringify(currentServices.map(s => s.name).sort());

  const handleToggleService = (serviceName: string) => {
    setSelectedServices(prev => 
      prev.includes(serviceName)
        ? prev.filter(s => s !== serviceName)
        : [...prev, serviceName]
    );
    // Reset reschedule state when services change
    setRequiresReschedule(false);
    setRescheduleReason('');
  };

  const handleConfirm = async () => {
    if (selectedServices.length === 0) {
      toast.error('Please keep at least one service selected');
      return;
    }

    setIsSubmitting(true);
    try {
      // Build updated services array
      const updatedServices = selectedServices.map(name => {
        const existing = currentServices.find(s => s.name === name);
        return existing || { name, price: 0 }; // Keep existing prices
      });

      const newSubtotal = updatedServices.reduce((sum, s) => sum + s.price, 0);
      const discountAmount = appointment.subtotal - appointment.total;
      const finalTotal = newSubtotal - (discountAmount > 0 ? discountAmount : 0);

      // Call edge function
      const { data, error } = await supabase.functions.invoke('customer-appointment-actions', {
        body: {
          action: 'modify_services',
          bookingId: appointment.id,
          newServices: updatedServices,
          newSubtotal: newSubtotal,
          newTotal: finalTotal,
          // TODO: Calculate new duration based on pricing engine
          isAdminOverride,
          adminUserId,
        },
      });

      if (error) throw error;
      
      if (data?.error) {
        if (data.code === 'LOCKOUT') {
          toast.error(data.details || 'Changes cannot be made within 48 hours of appointment');
        } else {
          throw new Error(data.details || data.error);
        }
        return;
      }

      // Check if reschedule is required
      if (data?.requiresReschedule) {
        setRequiresReschedule(true);
        setRescheduleReason(data.reason || 'New services exceed current time slot');
        return;
      }

      onComplete();
    } catch (err) {
      console.error('Failed to modify services:', err);
      toast.error('Failed to update services. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReschedule = () => {
    onOpenChange(false);
    if (onNeedsReschedule) {
      onNeedsReschedule();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-5 h-5" />
            Modify Services
          </DialogTitle>
          <DialogDescription>
            {appointment.reference_number} • {' '}
            {appointment.scheduled_start && format(parseISO(appointment.scheduled_start), 'MMM d, yyyy h:mm a')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Reschedule Required Alert */}
          {requiresReschedule && (
            <Alert variant="default" className="border-amber-200 bg-amber-50">
              <CalendarClock className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm">
                <strong className="text-amber-800">Reschedule Required</strong>
                <p className="text-amber-700 mt-1">{rescheduleReason}</p>
                <Button 
                  size="sm" 
                  className="mt-2" 
                  onClick={handleReschedule}
                >
                  Choose New Time
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Current Services */}
          <div>
            <div className="text-sm font-medium mb-2">Current Services</div>
            <div className="space-y-2">
              {currentServices.map((service, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedServices.includes(service.name)}
                      onCheckedChange={() => handleToggleService(service.name)}
                    />
                    <span className="text-sm">{service.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatPrice(service.price)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Price Summary */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Original Total:</span>
              <span>{formatPrice(appointment.total)}</span>
            </div>
            {servicesChanged && (
              <>
                <div className="flex justify-between text-sm">
                  <span>New Total:</span>
                  <span className="font-medium">{formatPrice(newTotal)}</span>
                </div>
                {totalChange !== 0 && (
                  <div className={`flex justify-between text-sm font-medium ${totalChange > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                    <span>Difference:</span>
                    <span>{totalChange > 0 ? '+' : ''}{formatPrice(totalChange)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Duration Warning */}
          {servicesChanged && !requiresReschedule && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Changing services may affect appointment duration. If your current time slot can no longer 
                accommodate the new services, you may need to reschedule.
              </AlertDescription>
            </Alert>
          )}

          {/* Removed services notice */}
          {selectedServices.length < currentServices.length && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                You are removing {currentServices.length - selectedServices.length} service(s). 
                This change cannot be undone without contacting support.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={isSubmitting || !servicesChanged || selectedServices.length === 0 || requiresReschedule}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Confirm Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
