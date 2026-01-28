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
import { Badge } from '@/components/ui/badge';
import { Loader2, Calendar, Clock, AlertCircle, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, addDays, startOfWeek, addWeeks, subWeeks, isBefore, startOfDay, getDay, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';

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
}

interface TimeSlot {
  startTime: string;
  endTime: string;
  technicianId: string;
  technicianName: string;
  displayTime: string;
}

// Simplified slot picker for reschedule flow
function SimpleSlotPicker({ 
  onSelect, 
  minDate 
}: { 
  onSelect: (slot: TimeSlot) => void;
  minDate: Date;
}) {
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(minDate));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

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

  const fetchSlotsForDate = async (date: Date) => {
    setLoadingSlots(true);
    try {
      // For demo purposes, generate sample slots
      // In production, this would call the availability edge function
      const mockSlots: TimeSlot[] = [
        { startTime: `${format(date, 'yyyy-MM-dd')}T09:00:00`, endTime: `${format(date, 'yyyy-MM-dd')}T12:00:00`, technicianId: '1', technicianName: 'Team A', displayTime: '9:00 AM' },
        { startTime: `${format(date, 'yyyy-MM-dd')}T10:00:00`, endTime: `${format(date, 'yyyy-MM-dd')}T13:00:00`, technicianId: '1', technicianName: 'Team A', displayTime: '10:00 AM' },
        { startTime: `${format(date, 'yyyy-MM-dd')}T13:00:00`, endTime: `${format(date, 'yyyy-MM-dd')}T16:00:00`, technicianId: '2', technicianName: 'Team B', displayTime: '1:00 PM' },
        { startTime: `${format(date, 'yyyy-MM-dd')}T14:00:00`, endTime: `${format(date, 'yyyy-MM-dd')}T17:00:00`, technicianId: '2', technicianName: 'Team B', displayTime: '2:00 PM' },
      ];
      setSlots(mockSlots);
    } catch (err) {
      console.error('Failed to fetch slots:', err);
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    fetchSlotsForDate(date);
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

      {/* Time Slots */}
      {selectedDate && (
        <div className="space-y-2">
          <div className="text-sm font-medium">
            Available times for {format(selectedDate, 'EEEE, MMM d')}
          </div>
          {loadingSlots ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : slots.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">
              No available times on this date
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {slots.map((slot, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  className="justify-start"
                  onClick={() => onSelect(slot)}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  {slot.displayTime}
                  <span className="ml-auto text-xs text-muted-foreground">
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
}: RescheduleDialogProps) {
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('select');
      setSelectedSlot(null);
    }
  }, [open]);

  const handleSlotSelect = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!selectedSlot) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          scheduled_start: selectedSlot.startTime,
          scheduled_end: selectedSlot.endTime,
          technician_id: selectedSlot.technicianId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointment.id);

      if (error) throw error;
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

            <SimpleSlotPicker
              onSelect={handleSlotSelect}
              minDate={addDays(new Date(), 3)}
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
                  <p className="font-medium">{selectedSlot.displayTime}</p>
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
