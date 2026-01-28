import { format, parseISO } from 'date-fns';
import { Calendar, Clock, User, Check, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimeSlot } from './TimeSlotPicker';

interface Service {
  service: string;
  name: string;
  price: number;
}

interface SelectedAppointmentSummaryProps {
  slot: TimeSlot;
  services: Service[];
  className?: string;
}

export function SelectedAppointmentSummary({ 
  slot, 
  services,
  className 
}: SelectedAppointmentSummaryProps) {
  const slotDate = parseISO(slot.startTime);
  const durationHrs = Math.round(slot.durationMinutes / 60 * 10) / 10;
  
  // Service icons based on type
  const getServiceIcon = (serviceType: string) => {
    switch (serviceType) {
      case 'windows_exterior':
      case 'windows_interior':
        return '🪟';
      case 'gutters':
        return '🏠';
      case 'house_wash':
        return '🧼';
      case 'roof_wash':
        return '🏗️';
      case 'driveway':
        return '🚗';
      case 'pressure_wash_addon':
        return '💧';
      default:
        return '✓';
    }
  };

  // Get unique service types for display
  const uniqueServices = services.reduce((acc, s) => {
    const key = s.service;
    if (!acc.find(x => x.service === key)) {
      acc.push(s);
    }
    return acc;
  }, [] as Service[]);

  return (
    <div 
      className={cn(
        "p-4 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-2 border-primary/30",
        "shadow-lg backdrop-blur-sm",
        className
      )}
    >
      {/* Header with confidence message */}
      <div className="flex items-center gap-2 mb-3 text-primary">
        <Check className="w-4 h-4" />
        <span className="text-sm font-medium">Appointment Selected</span>
      </div>
      
      {/* Main appointment details */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Date */}
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="text-xs text-muted-foreground">Date</div>
            <div className="font-semibold text-sm">{format(slotDate, 'EEE, MMM d')}</div>
          </div>
        </div>
        
        {/* Time */}
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="text-xs text-muted-foreground">Start Time</div>
            <div className="font-semibold text-sm">{slot.displayTime || format(slotDate, 'h:mm a')}</div>
          </div>
        </div>
        
        {/* Technician */}
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="text-xs text-muted-foreground">Technician</div>
            <div className="font-semibold text-sm">{slot.technicianName}</div>
          </div>
        </div>
        
        {/* Duration */}
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="text-xs text-muted-foreground">Duration</div>
            <div className="font-semibold text-sm">~{durationHrs} hr{durationHrs !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>
      
      {/* Services included */}
      <div className="pt-3 border-t border-border/50">
        <div className="text-xs text-muted-foreground mb-1.5">Services included:</div>
        <div className="flex flex-wrap gap-1.5">
          {uniqueServices.slice(0, 4).map((s, i) => (
            <span 
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background text-xs font-medium"
            >
              <span>{getServiceIcon(s.service)}</span>
              <span className="truncate max-w-[100px]">{s.name.replace(' Cleaning', '').replace(' (Exterior)', '').replace(' (Interior)', '')}</span>
            </span>
          ))}
          {uniqueServices.length > 4 && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
              +{uniqueServices.length - 4} more
            </span>
          )}
        </div>
      </div>
      
      {/* Confidence message */}
      <p className="text-xs text-muted-foreground mt-3 text-center italic">
        This time works best with our current schedule.
      </p>
    </div>
  );
}
