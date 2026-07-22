import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, LifeBuoy, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PRIMARY_PUBLIC_PHONE, SUPPORT_EMAIL } from '@/config/contact';

interface BookingHelpContactProps {
  bidLink?: string;
  bidReference?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  propertyAddress?: string;
  quoteId?: string;
  bookingId?: string;
  services?: Array<{ name?: string; price?: number }> | null;
  total?: number | null;
  appointmentStatus?: string;
  variant?: 'scheduling' | 'quote';
  className?: string;
}

/**
 * Customer-initiated "Contact BluLadder" panel.
 *
 * Sends the full customer + quote/booking context directly to BluLadder via
 * the contact-request edge function — no mailto:/sms: drafts. Repeated clicks
 * are idempotent via a stable per-mount requestKey (server enforces the unique
 * constraint on contact_requests.request_key).
 */
export function BookingHelpContact({
  bidLink,
  bidReference,
  customerName,
  customerEmail,
  customerPhone,
  propertyAddress,
  quoteId,
  bookingId,
  services,
  total,
  appointmentStatus,
  variant = 'scheduling',
  className,
}: BookingHelpContactProps) {
  const requestKey = useMemo(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `contact_${crypto.randomUUID()}`;
    }
    return `contact_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }, []);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);

  const pageUrl =
    bidLink || (typeof window !== 'undefined' ? window.location.href : undefined);

  const submit = async () => {
    if (inFlight.current || sent) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('contact-request', {
        body: {
          requestKey,
          source: variant === 'quote' ? 'quote_help' : 'scheduling_help',
          customerName,
          customerEmail,
          customerPhone,
          propertyAddress,
          quoteId,
          bookingId,
          services: services ?? undefined,
          total: typeof total === 'number' ? total : undefined,
          appointmentStatus: appointmentStatus ?? (bidReference ? `Bid ${bidReference}` : undefined),
          note: note.trim() || undefined,
          pageUrl,
        },
      });
      if (error) throw error;
      const dedup = !!(data as { dedup?: boolean } | null)?.dedup;
      setSent(true);
      setOpen(false);
      toast.success(
        dedup
          ? "We already received your request — BluLadder will reach out shortly."
          : "Got it — BluLadder has been notified and will reach out shortly.",
      );
    } catch (e) {
      toast.error(
        `We couldn't send that just now. Please call ${PRIMARY_PUBLIC_PHONE.display} or email ${SUPPORT_EMAIL}.`,
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      className={
        'rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 ' +
        (className || '')
      }
    >
      <div className="flex items-start gap-2">
        <LifeBuoy className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            {variant === 'quote'
              ? 'Questions about your bid?'
              : 'Need a different time or day?'}
          </p>
          <p className="text-xs text-muted-foreground">
            Send BluLadder a quick note and we'll reach out to help — your bid
            details are included automatically.
          </p>
        </div>
      </div>

      {sent ? (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>Sent. BluLadder has been notified and will reach out shortly.</span>
        </div>
      ) : open ? (
        <div className="mt-3 space-y-2">
          <Textarea
            placeholder="Optional note (what would you like BluLadder to know?)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            aria-label="Optional note to BluLadder"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={submit}
              disabled={submitting}
              className="flex-1"
              aria-busy={submitting}
            >
              <Send className="mr-1.5 h-4 w-4" />
              {submitting ? 'Sending…' : 'Send to BluLadder'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
            <Send className="mr-1.5 h-4 w-4" />
            Contact BluLadder
          </Button>
        </div>
      )}

      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        {PRIMARY_PUBLIC_PHONE.display} · {SUPPORT_EMAIL}
      </p>
    </div>
  );
}
