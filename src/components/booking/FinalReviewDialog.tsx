import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Clock, MapPin, User, Users, Mail, Phone, Loader2, ArrowLeft } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { CustomerInfo } from './CustomerInfoForm';
import type { TimeSlot } from './TimeSlotPicker';

function fmtPrice(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

interface ServiceItem { name: string; price: number }

export interface FinalReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerInfo;
  services: ServiceItem[];
  subtotal: number;
  discountAmount: number;
  discountCode?: string | null;
  total: number;
  slot: TimeSlot | null;
  estimatedDurationMinutes: number;
  onEditDetails: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}

/**
 * Final "Confirm your details" dialog shown before the booking is actually
 * written. Fully opaque background over a dark overlay so page content
 * cannot bleed through. The dialog body scrolls when content overflows on
 * small screens; the actions stay pinned at the bottom.
 */
export function FinalReviewDialog(props: FinalReviewDialogProps) {
  const {
    open, onOpenChange, customer, services, subtotal, discountAmount, discountCode,
    total, slot, estimatedDurationMinutes, onEditDetails, onConfirm, isSubmitting,
  } = props;

  const start = slot ? parseISO(slot.startTime) : null;
  const end = slot ? parseISO(slot.endTime) : null;
  const durHrs = end && start ? Math.round(((end.getTime() - start.getTime()) / 3600000) * 10) / 10 : Math.round((estimatedDurationMinutes / 60) * 10) / 10;
  const isTeam = !!(slot && (slot as unknown as { isTeamJob?: boolean }).isTeamJob);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Opaque background (bg-background), max height with vertical scroll, and
        an explicit stacking level so the modal always sits above the sticky
        booking CTA bar. Dialog primitive already renders a dark bg-black/80
        overlay behind this content.
      */}
      <DialogContent
        className="bg-background max-w-lg p-0 gap-0 max-h-[92vh] flex flex-col overflow-hidden z-[100] border shadow-2xl"
        onPointerDownOutside={(e) => { if (isSubmitting) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (isSubmitting) e.preventDefault(); }}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b bg-background">
          <DialogTitle className="text-lg">Confirm your details</DialogTitle>
          <DialogDescription>
            Please review everything below. We'll only book your appointment when you tap "Confirm and Book".
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5 bg-background text-foreground">
          {/* Contact Details */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Contact Details</h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" />{customer.firstName} {customer.lastName}</div>
              <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" />{customer.email}</div>
              <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" />{customer.phone}</div>
            </div>
          </section>

          {/* Service Address */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Service Address</h4>
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span>{customer.address}</span>
            </div>
          </section>

          {/* Services */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Services</h4>
            <ul className="space-y-1.5">
              {services.map((s, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <span className="flex items-start gap-2 min-w-0">
                    <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="font-medium tabular-nums">{fmtPrice(s.price)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{fmtPrice(subtotal)}</span></div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-green-700 dark:text-green-400">
                  <span>Discount{discountCode ? ` (${discountCode})` : ''}</span>
                  <span className="tabular-nums">-{fmtPrice(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1">
                <span>Total</span>
                <span className="text-primary tabular-nums">{fmtPrice(total)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Payment is collected after service is complete.</p>
            </div>
          </section>

          {/* Appointment */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Appointment</h4>
            {slot ? (
              <div className="space-y-1.5 text-sm">
                <div>{format(parseISO(slot.startTime), 'EEEE, MMMM d, yyyy')}</div>
                <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" />{slot.displayTime || format(parseISO(slot.startTime), 'h:mm a')}</div>
                <div className="flex items-center gap-2">{isTeam ? <Users className="w-4 h-4 text-muted-foreground" /> : <User className="w-4 h-4 text-muted-foreground" />}<span>{isTeam ? 'Crew' : 'Technician'}: <span className="font-medium">{slot.technicianName}</span></span></div>
                <div className="text-muted-foreground text-xs">Estimated duration: ~{durHrs} hrs</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No time selected.</div>
            )}
          </section>
        </div>

        <DialogFooter className="px-5 py-4 border-t bg-background gap-2 sm:gap-2 flex-col-reverse sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => { onOpenChange(false); onEditDetails(); }}
            disabled={isSubmitting}
            className="sm:w-auto w-full"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Edit Details
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!slot || isSubmitting}
            className="sm:w-auto w-full h-11 font-bold shadow-md"
            size="lg"
          >
            {isSubmitting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Booking…</>) : (<>Confirm and Book • {fmtPrice(total)}<Check className="w-4 h-4 ml-1.5" /></>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}