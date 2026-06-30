import { useBookingSettings } from '@/components/admin/BookingSettings';
import { SmartScheduler, type SchedulerSlot } from '@/components/scheduling/SmartScheduler';

export interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  displayTime?: string;
  durationMinutes: number;
  isRecommended?: boolean;
  routeDensityScore?: number;
  routeDensityLabel?: string;
  nearbyJobCount?: number;
  whyLabel?: string;
}

interface ServiceForAvailability {
  service: string;
  price: number;
}

interface TimeSlotPickerProps {
  services: ServiceForAvailability[];
  onSelectSlot: (slot: TimeSlot) => void;
  selectedSlot: TimeSlot | null;
  customerAddress?: string;
  bidLink?: string;
  bidReference?: string;
  customerName?: string;
}

export function TimeSlotPicker({ services, onSelectSlot, selectedSlot, customerAddress, bidLink, bidReference, customerName }: TimeSlotPickerProps) {
  const { data: bookingSettings } = useBookingSettings();
  const horizonDays = bookingSettings?.bookingHorizonDays || 365;

  return (
    <SmartScheduler
      services={services}
      customerAddress={customerAddress}
      selectedSlot={selectedSlot}
      onSelectSlot={(slot: SchedulerSlot) => onSelectSlot(slot as unknown as TimeSlot)}
      horizonDays={horizonDays}
      compact
      showHelpContact
      bidLink={bidLink}
      bidReference={bidReference}
      customerName={customerName}
    />
  );
}
