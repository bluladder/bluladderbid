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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Calendar, Clock, AlertTriangle, Check, Users, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, addMinutes } from 'date-fns';

interface Technician {
  id: string;
  name: string;
  jobber_user_id: string;
  is_active: boolean;
}

interface AdminRescheduleDialogProps {
  appointment: {
    id: string;
    reference_number: string;
    scheduled_start: string | null;
    scheduled_end: string | null;
    duration_minutes: number;
    total: number;
    services_json: Array<{ name: string; price: number }>;
    home_details_json: Record<string, unknown>;
    technician?: { name: string } | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  adminUserId: string;
}

export function AdminRescheduleDialog({
  appointment,
  open,
  onOpenChange,
  onComplete,
  adminUserId,
}: AdminRescheduleDialogProps) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [forceOverride, setForceOverride] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadTechnicians();
      // Pre-fill current values
      if (appointment.scheduled_start) {
        const start = parseISO(appointment.scheduled_start);
        setSelectedDate(format(start, 'yyyy-MM-dd'));
        setSelectedTime(format(start, 'HH:mm'));
      }
      setForceOverride(false);
      setConflictWarning(null);
    }
  }, [open, appointment]);

  const loadTechnicians = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('technicians')
        .select('id, name, jobber_user_id, is_active')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTechnicians(data || []);
    } catch (err) {
      console.error('Failed to load technicians:', err);
      toast.error('Failed to load technicians');
    } finally {
      setIsLoading(false);
    }
  };

  const checkConflicts = async () => {
    if (!selectedTechId || !selectedDate || !selectedTime) return;

    try {
      const startTime = `${selectedDate}T${selectedTime}:00`;
      const endTime = format(
        addMinutes(new Date(startTime), appointment.duration_minutes),
        "yyyy-MM-dd'T'HH:mm:ss"
      );

      // Check local busy blocks for conflicts
      const { data: blocks, error } = await supabase
        .from('jobber_busy_blocks')
        .select('id, start_at, end_at, client_name')
        .eq('crew_id', selectedTechId)
        .lte('start_at', endTime)
        .gte('end_at', startTime);

      if (error) throw error;

      if (blocks && blocks.length > 0) {
        const conflictDetails = blocks.map(b => 
          `${b.client_name || 'Appointment'} (${format(parseISO(b.start_at), 'h:mm a')} - ${format(parseISO(b.end_at), 'h:mm a')})`
        ).join(', ');
        setConflictWarning(`Conflict detected: ${conflictDetails}`);
      } else {
        setConflictWarning(null);
      }
    } catch (err) {
      console.error('Conflict check failed:', err);
    }
  };

  useEffect(() => {
    if (selectedTechId && selectedDate && selectedTime) {
      checkConflicts();
    }
  }, [selectedTechId, selectedDate, selectedTime]);

  const handleConfirm = async () => {
    if (!selectedTechId || !selectedDate || !selectedTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (conflictWarning && !forceOverride) {
      toast.error('Please acknowledge the conflict by checking "Force Override"');
      return;
    }

    setIsSubmitting(true);
    try {
      const startTime = `${selectedDate}T${selectedTime}:00`;
      const endTime = format(
        addMinutes(new Date(startTime), appointment.duration_minutes),
        "yyyy-MM-dd'T'HH:mm:ss"
      );

      // Call edge function with admin override
      const { data, error } = await supabase.functions.invoke('customer-appointment-actions', {
        body: {
          action: 'reschedule',
          bookingId: appointment.id,
          newSlot: {
            startTime,
            endTime,
            technicianId: selectedTechId,
          },
          isAdminOverride: true,
          adminUserId,
        },
      });

      if (error) throw error;
      
      if (data?.error) {
        throw new Error(data.details || data.error);
      }

      toast.success('Appointment rescheduled successfully');
      onComplete();
    } catch (err) {
      console.error('Failed to reschedule:', err);
      toast.error('Failed to reschedule appointment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
            Admin Reschedule
          </DialogTitle>
          <DialogDescription>
            {appointment.reference_number} • Override mode (no restrictions)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Info */}
          {appointment.scheduled_start && (
            <Alert>
              <Calendar className="h-4 w-4" />
              <AlertDescription>
                <strong>Current:</strong>{' '}
                {format(parseISO(appointment.scheduled_start), 'MMM d, yyyy h:mm a')}
                {appointment.technician && ` with ${appointment.technician.name}`}
              </AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Technician Selection */}
              <div className="space-y-2">
                <Label>Assign Technician *</Label>
                <Select value={selectedTechId} onValueChange={setSelectedTechId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select technician" />
                  </SelectTrigger>
                  <SelectContent>
                    {technicians.map(tech => (
                      <SelectItem key={tech.id} value={tech.id}>
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          {tech.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date *</Label>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Time *</Label>
                  <Input
                    type="time"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Duration Info */}
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Duration: {Math.floor(appointment.duration_minutes / 60)}h {appointment.duration_minutes % 60}m
              </div>

              {/* Conflict Warning */}
              {conflictWarning && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Scheduling Conflict!</strong>
                    <p className="text-sm mt-1">{conflictWarning}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Checkbox
                        id="force-override"
                        checked={forceOverride}
                        onCheckedChange={(checked) => setForceOverride(checked === true)}
                      />
                      <label htmlFor="force-override" className="text-sm font-medium">
                        Force override (I understand the conflict)
                      </label>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={isSubmitting || isLoading || !selectedTechId || !selectedDate || !selectedTime}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Confirm Reschedule
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
