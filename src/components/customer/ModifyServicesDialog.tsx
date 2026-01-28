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
import { Badge } from '@/components/ui/badge';
import { Loader2, Edit, AlertCircle, Check, ArrowRight, Clock } from 'lucide-react';
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
}

// Available services that can be added (simplified for customer self-service)
const AVAILABLE_SERVICES = [
  { id: 'windows_exterior', name: 'Exterior Windows', description: 'Professional exterior window cleaning' },
  { id: 'windows_interior', name: 'Interior + Exterior Windows', description: 'Complete window cleaning inside and out' },
  { id: 'gutters', name: 'Gutter Cleaning', description: 'Clear debris and flush downspouts' },
  { id: 'house_wash', name: 'House Wash', description: 'Soft wash exterior siding' },
  { id: 'roof_wash', name: 'Roof Cleaning', description: 'Soft wash roof treatment' },
  { id: 'driveway', name: 'Driveway Cleaning', description: 'Pressure wash driveway' },
];

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
}: ModifyServicesDialogProps) {
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsReschedule, setNeedsReschedule] = useState(false);

  // Initialize with current services
  useEffect(() => {
    if (open) {
      const currentServiceNames = appointment.services_json.map(s => s.name);
      setSelectedServices(currentServiceNames);
      setNeedsReschedule(false);
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

      // Update the booking
      const { error } = await supabase
        .from('bookings')
        .update({
          services_json: updatedServices,
          subtotal: newTotal,
          total: newTotal - (appointment.subtotal - appointment.total), // Preserve discount
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointment.id);

      if (error) throw error;

      // Log the change for audit
      console.log('Services modified:', {
        bookingId: appointment.id,
        oldServices: currentServices,
        newServices: updatedServices,
        timestamp: new Date().toISOString(),
      });

      onComplete();
    } catch (err) {
      console.error('Failed to modify services:', err);
      toast.error('Failed to update services. Please try again.');
    } finally {
      setIsSubmitting(false);
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
                  <div className={`flex justify-between text-sm font-medium ${totalChange > 0 ? 'text-amber-600' : 'text-success'}`}>
                    <span>Difference:</span>
                    <span>{totalChange > 0 ? '+' : ''}{formatPrice(totalChange)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Duration Warning */}
          {servicesChanged && (
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
            disabled={isSubmitting || !servicesChanged || selectedServices.length === 0}
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
