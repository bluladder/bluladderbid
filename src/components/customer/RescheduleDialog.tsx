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
import { Loader2, Calendar, Clock, AlertCircle, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, addDays, startOfWeek, addWeeks, subWeeks, isBefore, startOfDay, getDay, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useSmartAvailability, type DayGridSlot } from '@/hooks/useSmartAvailability';

interface RescheduleDialogProps {
  appointment: {
    id: string;
    reference_number: string;
    scheduled_start: string | null;
    duration_minutes: number;
    total: number;
    services_json: Array<{ name: string; price: number }>;
    home_details_json: Record<string, unknown>;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  // Admin override props
  isAdminOverride?: boolean;
  adminUserId?: string;
}

// Simplified slot picker using the real availability engine
function AvailabilitySlotPicker({ 
  onSelect, 
  services,
  homeDetails,
}: { 
  onSelect: (slot: DayGridSlot) => void;
  services: Array<{ name: string; price: number }>;
  homeDetails: Record<string, unknown>;
}) {
  const minDate = addDays(new Date(), 3); // 48 hours + buffer
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(minDate));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Convert services to the format the availability hook expects
  const servicePrices = services.map(s => ({
    service: s.name.toLowerCase().replace(/\s+/g, '_'),
    price: s.price,
  }));

  const {
    daySlots,
    isLoadingDaySlots,
    fetchDaySlots,
    error,
  } = useSmartAvailability({
    services: servicePrices,
    customerAddress: homeDetails.address as string | undefined,
    numStories: (homeDetails.stories as number) || 1,
  });

  const workDays = [1, 2, 3, 4, 5]; // Mon-Fri
  const workDaysSet = new Set(workDays);
  const today = startOfDay(new Date());

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  const isDateDisabled = (date: Date) => {
    if (isBefore(date, today)) return true;
    if (isBefore(date, startOfDay(minDate))) return true;
    if (!workDaysSet.has(getDay(date))) return true;
    return false;
  };

  const handleDateSelect = async (date: Date) => {
    setSelectedDate(date);
    await fetchDaySlots(date);
  };

  return (
    <div className="space-y-4">
      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))}
          disabled={isBefore(addDays(currentWeekStart, -1), minDate)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium">
          Week of {format(currentWeekStart, 'MMM d')}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day Selector */}
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((date) => {
          const disabled = isDateDisabled(date);
          const isSelected = selectedDate && isSameDay(date, selectedDate);
          return (
            <button
              key={format(date, 'yyyy-MM-dd')}
              onClick={() => !disabled && handleDateSelect(date)}
              disabled={disabled}
              className={cn(
                'p-2 rounded-lg text-center transition-all',
                disabled && 'opacity-40 cursor-not-allowed bg-muted/50',
                !disabled && 'hover:bg-accent cursor-pointer',
                isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              <div className="text-xs text-muted-foreground">{format(date, 'EEE')}</div>
              <div className="font-medium">{format(date, 'd')}</div>
            </button>
          );
        })}
      </div>

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Time Slots */}
      {selectedDate && !error && (
        <div className="space-y-2">
          <div className="text-sm font-medium">
            Available times for {format(selectedDate, 'EEEE, MMM d')}
          </div>
          {isLoadingDaySlots ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : daySlots.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">
              No available times on this date. Try another day.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {daySlots.map((slot, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  className="justify-start"
                  onClick={() => onSelect(slot)}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  {slot.displayTime || format(parseISO(slot.startTime), 'h:mm a')}
                  <span className="ml-auto text-xs text-muted-foreground truncate max-w-[80px]">
                    {slot.technicianName}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {!selectedDate && (
        <p className="text-center py-4 text-muted-foreground text-sm">
          Select a date to see available times
        </p>
      )}
    </div>
  );
}

export function RescheduleDialog({
  appointment,
  open,
  onOpenChange,
  onComplete,
  isAdminOverride,
  adminUserId,
}: RescheduleDialogProps) {
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [selectedSlot, setSelectedSlot] = useState<DayGridSlot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('select');
      setSelectedSlot(null);
    }
  }, [open]);

  const handleSlotSelect = (slot: DayGridSlot) => {
    setSelectedSlot(slot);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!selectedSlot) return;

    setIsSubmitting(true);
    try {
      // Call edge function for reschedule
      const { data, error } = await supabase.functions.invoke('customer-appointment-actions', {
        body: {
          action: 'reschedule',
          bookingId: appointment.id,
          newSlot: {
            startTime: selectedSlot.startTime,
            endTime: selectedSlot.endTime,
            technicianId: selectedSlot.technicianId,
            technicianIds: selectedSlot.teamTechnicianIds,
          },
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

      onComplete();
    } catch (err) {
      console.error('Failed to reschedule:', err);
      toast.error('Failed to reschedule appointment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Reschedule Appointment
          </DialogTitle>
          <DialogDescription>
            {appointment.reference_number} • Currently scheduled for{' '}
            {appointment.scheduled_start && format(parseISO(appointment.scheduled_start), 'MMM d, yyyy h:mm a')}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Your current time slot will be held until you confirm a new time.
              </AlertDescription>
            </Alert>

            <AvailabilitySlotPicker
              onSelect={handleSlotSelect}
              services={appointment.services_json}
              homeDetails={appointment.home_details_json}
            />

            <p className="text-xs text-center text-muted-foreground">
              Only times more than 48 hours from now are available
            </p>
          </div>
        )}

        {step === 'confirm' && selectedSlot && (
          <div className="space-y-4">
            <div className="bg-primary/5 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-primary font-medium">
                <Check className="w-4 h-4" />
                New Appointment Time
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Date:</span>
                  <p className="font-medium">{format(parseISO(selectedSlot.startTime), 'EEEE, MMMM d')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Time:</span>
                  <p className="font-medium">{selectedSlot.displayTime || format(parseISO(selectedSlot.startTime), 'h:mm a')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Technician:</span>
                  <p className="font-medium">{selectedSlot.technicianName}</p>
                </div>
              </div>
            </div>

            <Alert variant="default" className="bg-muted/50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Previous time:</strong>{' '}
                {appointment.scheduled_start && format(parseISO(appointment.scheduled_start), 'MMM d, yyyy h:mm a')}
                <br />
                This slot will be released for other customers.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'confirm' && (
            <Button variant="outline" onClick={() => setStep('select')}>
              Choose Different Time
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === 'confirm' && (
            <Button onClick={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Confirming...
                </>
              ) : (
                'Confirm Reschedule'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
