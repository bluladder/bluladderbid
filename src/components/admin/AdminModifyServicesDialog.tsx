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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Edit, Check, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { NotificationControls } from './NotificationControls';

interface AdminModifyServicesDialogProps {
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

export function AdminModifyServicesDialog({
  appointment,
  open,
  onOpenChange,
  onComplete,
  adminUserId,
}: AdminModifyServicesDialogProps) {
  const [services, setServices] = useState<Array<{ name: string; price: number; enabled: boolean }>>([]);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Notification controls
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [showPriceChange, setShowPriceChange] = useState(true);
  const [adminNote, setAdminNote] = useState('');

  useEffect(() => {
    if (open) {
      // Initialize with current services, all enabled
      setServices(appointment.services_json.map(s => ({ ...s, enabled: true })));
      setNewServiceName('');
      setNewServicePrice('');
      // Reset notification controls
      setNotifyCustomer(true);
      setRequireConfirmation(false);
      setShowPriceChange(true);
      setAdminNote('');
    }
  }, [open, appointment]);

  const toggleService = (index: number) => {
    setServices(prev => prev.map((s, i) => 
      i === index ? { ...s, enabled: !s.enabled } : s
    ));
  };

  const updateServicePrice = (index: number, price: number) => {
    setServices(prev => prev.map((s, i) => 
      i === index ? { ...s, price } : s
    ));
  };

  const addService = () => {
    if (!newServiceName.trim() || !newServicePrice) {
      toast.error('Please enter service name and price');
      return;
    }
    const price = parseFloat(newServicePrice);
    if (isNaN(price) || price < 0) {
      toast.error('Please enter a valid price');
      return;
    }
    setServices(prev => [...prev, { name: newServiceName.trim(), price, enabled: true }]);
    setNewServiceName('');
    setNewServicePrice('');
  };

  const removeService = (index: number) => {
    setServices(prev => prev.filter((_, i) => i !== index));
  };

  const enabledServices = services.filter(s => s.enabled);
  const newTotal = enabledServices.reduce((sum, s) => sum + s.price, 0);
  const totalChange = newTotal - appointment.total;
  const hasChanges = JSON.stringify(enabledServices.map(s => ({ name: s.name, price: s.price }))) !== 
    JSON.stringify(appointment.services_json);

  const handleConfirm = async () => {
    if (enabledServices.length === 0) {
      toast.error('Please keep at least one service');
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedServices = enabledServices.map(({ name, price }) => ({ name, price }));

      // Call edge function with admin override
      const { data, error } = await supabase.functions.invoke('customer-appointment-actions', {
        body: {
          action: 'modify_services',
          bookingId: appointment.id,
          newServices: updatedServices,
          newSubtotal: newTotal,
          newTotal: newTotal,
          isAdminOverride: true,
          adminUserId,
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
            eventType: 'services_modified',
            triggeredBy: 'admin',
            triggeredById: adminUserId,
            notifyCustomer: true,
            requireConfirmation,
            showPriceChange,
            adminNote: adminNote || undefined,
            oldValues: { 
              services_json: appointment.services_json,
              total: appointment.total,
            },
            newValues: { 
              services_json: updatedServices,
              total: newTotal,
            },
          },
        });
      }

      if (data?.requiresReschedule) {
        toast.warning(`Services updated but appointment may need rescheduling: ${data.reason}`);
      } else {
        toast.success(requireConfirmation 
          ? 'Changes pending customer confirmation' 
          : 'Services updated successfully');
      }
      
      onComplete();
    } catch (err) {
      console.error('Failed to modify services:', err);
      toast.error('Failed to update services');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
            Admin Modify Services
          </DialogTitle>
          <DialogDescription>
            {appointment.reference_number} • {' '}
            {appointment.scheduled_start && format(parseISO(appointment.scheduled_start), 'MMM d, yyyy h:mm a')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Services */}
          <div>
            <div className="text-sm font-medium mb-2">Services</div>
            <div className="space-y-2">
              {services.map((service, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
                >
                  <Checkbox
                    checked={service.enabled}
                    onCheckedChange={() => toggleService(idx)}
                  />
                  <span className="text-sm flex-1">{service.name}</span>
                  <Input
                    type="number"
                    value={service.price}
                    onChange={(e) => updateServicePrice(idx, parseFloat(e.target.value) || 0)}
                    className="w-24 h-8 text-sm"
                    min="0"
                    step="1"
                  />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => removeService(idx)}
                    className="h-8 w-8 p-0 text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Add New Service */}
          <div>
            <div className="text-sm font-medium mb-2">Add Service</div>
            <div className="flex gap-2">
              <Input
                value={newServiceName}
                onChange={(e) => setNewServiceName(e.target.value)}
                placeholder="Service name"
                className="flex-1"
              />
              <Input
                type="number"
                value={newServicePrice}
                onChange={(e) => setNewServicePrice(e.target.value)}
                placeholder="Price"
                className="w-24"
                min="0"
              />
              <Button variant="outline" size="icon" onClick={addService}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Price Summary */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Original Total:</span>
              <span>{formatPrice(appointment.total)}</span>
            </div>
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
          </div>

          {/* Notification Controls */}
          <NotificationControls
            notifyCustomer={notifyCustomer}
            onNotifyCustomerChange={setNotifyCustomer}
            requireConfirmation={requireConfirmation}
            onRequireConfirmationChange={setRequireConfirmation}
            showPriceChange={showPriceChange}
            onShowPriceChangeChange={setShowPriceChange}
            adminNote={adminNote}
            onAdminNoteChange={setAdminNote}
          />

          <Alert>
            <Edit className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Changes will be logged in the audit trail. Jobber line items may need manual sync.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={isSubmitting || !hasChanges || enabledServices.length === 0}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
