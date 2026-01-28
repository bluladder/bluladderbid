import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Calendar, 
  Clock, 
  Lock, 
  Edit, 
  X, 
  CalendarClock,
  User,
  Check
} from 'lucide-react';
import { format, parseISO, differenceInHours } from 'date-fns';

interface Service {
  name: string;
  price: number;
}

interface AppointmentCardProps {
  appointment: {
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
    services_json: Service[];
    technician?: { name: string } | null;
  };
  isLocked: boolean;
  lockoutHours: number;
  onReschedule: () => void;
  onModify: () => void;
  onCancel: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function AppointmentCard({
  appointment,
  isLocked,
  lockoutHours,
  onReschedule,
  onModify,
  onCancel,
}: AppointmentCardProps) {
  const hoursUntil = appointment.scheduled_start 
    ? differenceInHours(parseISO(appointment.scheduled_start), new Date())
    : 0;

  return (
    <Card className={isLocked ? 'border-amber-200 bg-amber-50/30' : ''}>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{appointment.reference_number}</span>
              <Badge variant={isLocked ? 'secondary' : 'outline'} className="text-xs">
                {isLocked ? (
                  <>
                    <Lock className="w-3 h-3 mr-1" />
                    Locked
                  </>
                ) : (
                  'Scheduled'
                )}
              </Badge>
            </div>
            {appointment.scheduled_start && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {format(parseISO(appointment.scheduled_start), 'EEEE, MMMM d, yyyy')}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {format(parseISO(appointment.scheduled_start), 'h:mm a')}
                </span>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{formatPrice(appointment.total)}</div>
            <div className="text-xs text-muted-foreground">
              ~{Math.round(appointment.duration_minutes / 60 * 10) / 10} hrs
            </div>
          </div>
        </div>

        <Separator />

        {/* Services */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Services
          </div>
          {appointment.services_json.map((service, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-success" />
                {service.name}
              </span>
              <span className="text-muted-foreground">{formatPrice(service.price)}</span>
            </div>
          ))}
          {appointment.discount_amount && appointment.discount_amount > 0 && (
            <div className="flex items-center justify-between text-sm text-success">
              <span>Discount {appointment.discount_code && `(${appointment.discount_code})`}</span>
              <span>-{formatPrice(appointment.discount_amount)}</span>
            </div>
          )}
        </div>

        {/* Technician */}
        {appointment.technician && (
          <>
            <Separator />
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Technician:</span>
              <span className="font-medium">{appointment.technician.name}</span>
            </div>
          </>
        )}

        <Separator />

        {/* Actions */}
        {isLocked ? (
          <div className="bg-amber-100/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-2 text-amber-800 mb-1">
              <Lock className="w-4 h-4" />
              <span className="font-medium text-sm">Changes Locked</span>
            </div>
            <p className="text-xs text-amber-700">
              Appointments cannot be modified within {lockoutHours} hours of service time.
              <br />
              <span className="font-medium">Contact us for urgent changes.</span>
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onReschedule}
              className="flex-1 min-w-[100px]"
            >
              <CalendarClock className="w-4 h-4 mr-1.5" />
              Reschedule
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onModify}
              className="flex-1 min-w-[100px]"
            >
              <Edit className="w-4 h-4 mr-1.5" />
              Modify Services
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onCancel}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <X className="w-4 h-4 mr-1.5" />
              Cancel
            </Button>
          </div>
        )}

        {/* Time remaining indicator */}
        {!isLocked && hoursUntil > 0 && (
          <p className="text-xs text-center text-muted-foreground">
            {hoursUntil > 72 
              ? `${Math.floor(hoursUntil / 24)} days until appointment`
              : `${hoursUntil} hours until appointment`
            }
          </p>
        )}
      </CardContent>
    </Card>
  );
}
