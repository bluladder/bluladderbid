import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Calendar, 
  Clock, 
  Mail, 
  Phone, 
  Lock, 
  AlertCircle,
  Loader2,
  CalendarDays,
  Edit,
  X,
  RefreshCw
} from 'lucide-react';
import { format, parseISO, differenceInHours, isBefore } from 'date-fns';
import { toast } from 'sonner';
import { AppointmentCard } from '@/components/customer/AppointmentCard';
import { CustomerHeader } from '@/components/CustomerHeader';
import { RescheduleDialog } from '@/components/customer/RescheduleDialog';
import { ModifyServicesDialog } from '@/components/customer/ModifyServicesDialog';
import { CancelDialog } from '@/components/customer/CancelDialog';
import { MessagePreferencesCard } from '@/components/customer/MessagePreferencesCard';

interface CustomerAppointment {
  id: string;
  reference_number: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  duration_minutes: number;
  total: number;
  subtotal: number;
  discount_amount: number | null;
  discount_code: string | null;
  services_json: Array<{ name: string; price: number }>;
  home_details_json: Record<string, unknown>;
  technician?: { name: string } | null;
}

const LOCKOUT_HOURS = 48;

export default function MyAppointments() {
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [appointments, setAppointments] = useState<CustomerAppointment[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [hasLookedUp, setHasLookedUp] = useState(false);
  
  // Dialog states
  const [rescheduleAppointment, setRescheduleAppointment] = useState<CustomerAppointment | null>(null);
  const [modifyAppointment, setModifyAppointment] = useState<CustomerAppointment | null>(null);
  const [cancelAppointment, setCancelAppointment] = useState<CustomerAppointment | null>(null);

  // If user is logged in, auto-lookup their appointments
  useEffect(() => {
    if (user?.email && !hasLookedUp) {
      setEmail(user.email);
      handleLookup(user.email);
    }
  }, [user, hasLookedUp]);

  const handleLookup = async (lookupEmail?: string) => {
    const searchEmail = lookupEmail || email;
    if (!searchEmail) {
      toast.error('Please enter your email address');
      return;
    }

    setLookupLoading(true);
    try {
      // Use edge function proxy for secure customer lookup
      const { data: responseData, error: invokeError } = await supabase.functions.invoke('customer-lookup', {
        body: { email: searchEmail.toLowerCase().trim(), mode: 'appointments' },
      });

      if (invokeError) throw invokeError;

      if (!responseData?.customer) {
        toast.error('No appointments found for this email');
        setAppointments([]);
        setCustomerId(null);
        setHasLookedUp(true);
        return;
      }

      setCustomerId(responseData.customer.id);
      setAppointments((responseData.appointments || []) as unknown as CustomerAppointment[]);
      setHasLookedUp(true);
    } catch (err) {
      console.error('Failed to lookup appointments:', err);
      toast.error('Failed to load appointments');
    } finally {
      setLookupLoading(false);
    }
  };

  const isWithinLockout = (appointment: CustomerAppointment): boolean => {
    if (!appointment.scheduled_start) return true;
    const hoursUntil = differenceInHours(parseISO(appointment.scheduled_start), new Date());
    return hoursUntil < LOCKOUT_HOURS;
  };

  const refreshAppointments = () => {
    if (email) {
      handleLookup(email);
    }
  };

  const handleRescheduleComplete = () => {
    setRescheduleAppointment(null);
    refreshAppointments();
    toast.success('Appointment rescheduled successfully');
  };

  const handleModifyComplete = () => {
    setModifyAppointment(null);
    refreshAppointments();
    toast.success('Services updated successfully');
  };

  const handleCancelComplete = () => {
    setCancelAppointment(null);
    refreshAppointments();
    toast.success('Appointment cancelled');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <div className="container pt-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">
            My Appointments
          </h1>
          <p className="text-muted-foreground mt-1">Manage your upcoming services</p>
        </div>
      </div>

      <main className="container py-8 max-w-2xl mx-auto">
        {/* Email Lookup Form */}
        {!hasLookedUp && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5" />
                Find Your Appointments
              </CardTitle>
              <CardDescription>
                Enter the email you used when booking to view your appointments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); handleLookup(); }} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                  />
                </div>
                <Button type="submit" disabled={lookupLoading} className="w-full">
                  {lookupLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Looking up...
                    </>
                  ) : (
                    'Find My Appointments'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Appointments List */}
        {hasLookedUp && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {appointments.length > 0 
                  ? `${appointments.length} Upcoming Appointment${appointments.length > 1 ? 's' : ''}`
                  : 'No Upcoming Appointments'
                }
              </h2>
              <Button variant="outline" size="sm" onClick={refreshAppointments}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>

            {/* 48-hour policy notice */}
            <Alert className="mb-6">
              <Lock className="h-4 w-4" />
              <AlertDescription>
                <strong>48-Hour Policy:</strong> Changes can only be made more than 48 hours before your appointment. 
                For urgent changes, please contact us directly.
              </AlertDescription>
            </Alert>

            {appointments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CalendarDays className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground mb-4">
                    No upcoming appointments found for {email}
                  </p>
                  <Button asChild>
                    <Link to="/">Book a Service</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {appointments.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    isLocked={isWithinLockout(appointment)}
                    lockoutHours={LOCKOUT_HOURS}
                    onReschedule={() => setRescheduleAppointment(appointment)}
                    onModify={() => setModifyAppointment(appointment)}
                    onCancel={() => setCancelAppointment(appointment)}
                  />
                ))}
              </div>
            )}

            {/* Contact Info for locked appointments */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Need Help?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <a href="tel:+15127174452" className="text-primary hover:underline">
                    (512) 717-4452
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <a href="mailto:info@bluladder.com" className="text-primary hover:underline">
                    info@bluladder.com
                  </a>
                </div>
              </CardContent>
            </Card>

            {/* Notification preferences (texts + emails) */}
            {email && <MessagePreferencesCard email={email} />}
          </>
        )}
      </main>

      {/* Dialogs */}
      {rescheduleAppointment && (
        <RescheduleDialog
          appointment={rescheduleAppointment}
          open={!!rescheduleAppointment}
          onOpenChange={(open) => !open && setRescheduleAppointment(null)}
          onComplete={handleRescheduleComplete}
        />
      )}

      {modifyAppointment && (
        <ModifyServicesDialog
          appointment={modifyAppointment}
          open={!!modifyAppointment}
          onOpenChange={(open) => !open && setModifyAppointment(null)}
          onComplete={handleModifyComplete}
        />
      )}

      {cancelAppointment && (
        <CancelDialog
          appointment={cancelAppointment}
          open={!!cancelAppointment}
          onOpenChange={(open) => !open && setCancelAppointment(null)}
          onComplete={handleCancelComplete}
        />
      )}
    </div>
  );
}
