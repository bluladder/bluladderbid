// ============================================================================
// QuoteBookingView — the "Accept & Book This Bid" screen for a resumed quote.
// Hydrates the saved proposal (customer, home details, selected services) via
// the token-scoped `quote-resume` Edge Function, then renders the standard
// BookingFlow starting on the Service Review step. Never re-collects data the
// customer already provided and preserves the original quote ID by reusing
// the saved source_session_id so `jobber-create-booking` links the resulting
// booking to this exact quote row.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldCheck, CalendarCheck, AlertCircle } from 'lucide-react';
import { CustomerHeader } from '@/components/CustomerHeader';
import { BookingFlow } from '@/components/booking/BookingFlow';
import { useServerQuoteCalculation } from '@/hooks/useServerQuoteCalculation';
import { fromQuoteResult } from '@/lib/pricing/fromQuoteResult';
import { toQuoteInput } from '@/lib/pricing/toQuoteInput';
import {
  DEFAULT_ADDITIONAL_SERVICES,
  DEFAULT_HOME_DETAILS,
  type AdditionalServices,
  type HomeDetails,
} from '@/types/homeowner';
import type { CustomerInfo } from '@/components/booking/CustomerInfoForm';

interface HydrationCustomer {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}
interface HydrationPayload {
  customer: HydrationCustomer;
  homeDetails: Record<string, unknown>;
  additionalServices: Record<string, unknown> | null;
  sourceSessionId: string | null;
}
interface ResumeBooking {
  id: string;
  referenceNumber: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: string | null;
}
interface ResumeResponse {
  ok: boolean;
  quote?: {
    quoteId: string;
    status: string;
    isExpired: boolean;
    isDeclined: boolean;
    isConverted: boolean;
    serviceAddress: {
      street: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
    } | null;
  };
  hydration?: HydrationPayload;
  booking?: ResumeBooking | null;
  message?: string;
  verificationUrl?: string;
}

const SESSION_ID_KEY = 'bluladder_source_session_id';

function composeAddress(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const stateZip = [parts.state ?? '', parts.zip ?? ''].filter(Boolean).join(' ');
  return [parts.street ?? '', parts.city ?? '', stateZip].filter(Boolean).join(', ');
}

export default function QuoteBookingView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const resumeToken = searchParams.get('resume') ?? '';
  const [isLoading, setIsLoading] = useState(true);
  const [response, setResponse] = useState<ResumeResponse | null>(null);
  const [unauthorized, setUnauthorized] = useState<null | { message: string; verificationUrl: string }>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id || !resumeToken) {
      setIsLoading(false);
      setUnauthorized({
        message:
          'For your security, this link requires verification. Verify your identity to view your quote.',
        verificationUrl: `${window.location.origin}/verify`,
      });
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('quote-resume', {
          body: { quoteId: id, token: resumeToken },
        });
        if (cancelled) return;
        if (error || !data || !data.ok) {
          setUnauthorized({
            message: data?.message || 'This link is no longer valid.',
            verificationUrl: data?.verificationUrl || `${window.location.origin}/verify`,
          });
          return;
        }
        // Preserve the ORIGINAL quote's source_session_id in this browser so
        // jobber-create-booking links the resulting booking back to this
        // exact quote row instead of starting a new attribution journey.
        try {
          const sid = data.hydration?.sourceSessionId;
          if (sid && typeof window !== 'undefined') {
            window.localStorage.setItem(SESSION_ID_KEY, sid);
          }
        } catch { /* non-blocking */ }
        setResponse(data as ResumeResponse);
      } catch {
        if (cancelled) return;
        setUnauthorized({
          message: 'We could not load this quote securely. Please verify your identity to continue.',
          verificationUrl: `${window.location.origin}/verify`,
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, resumeToken]);

  // Reconstruct BookingFlow inputs from the hydrated saved quote.
  const homeDetails: HomeDetails = useMemo(() => {
    const h = (response?.hydration?.homeDetails ?? {}) as Partial<HomeDetails>;
    return { ...DEFAULT_HOME_DETAILS, ...h };
  }, [response]);

  const additionalServices: AdditionalServices = useMemo(() => {
    const a = (response?.hydration?.additionalServices ?? {}) as Partial<AdditionalServices>;
    return { ...DEFAULT_ADDITIONAL_SERVICES, ...a };
  }, [response]);

  // If the saved quote used the $99 promo, forward that promotion so the
  // server recomputes via the promotion branch (not per-sqft) on booking.
  const promotion = useMemo(() => {
    if (homeDetails.windowCleaningType === 'promo_99') {
      return { id: 'window_promo_99', windowCount: 10 };
    }
    return null;
  }, [homeDetails.windowCleaningType]);

  const quoteInput = useMemo(
    () => (response?.ok
      ? toQuoteInput(homeDetails, additionalServices, null, promotion)
      : null),
    [response, homeDetails, additionalServices, promotion],
  );
  const quoteState = useServerQuoteCalculation(quoteInput);
  const servicePrices = fromQuoteResult(quoteState.quote);

  const prefillCustomerInfo: CustomerInfo | null = useMemo(() => {
    const c = response?.hydration?.customer;
    const a = response?.quote?.serviceAddress ?? null;
    if (!c) return null;
    return {
      firstName: c.firstName ?? '',
      lastName: c.lastName ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      address: composeAddress(a ?? {}),
    };
  }, [response]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading your bid…</div>
      </div>
    );
  }

  if (unauthorized || !response?.ok || !response.quote || !response.hydration) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <ShieldCheck className="w-12 h-12 mx-auto mb-4 text-primary" />
            <h2 className="text-xl font-semibold mb-2">Verification required</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              {unauthorized?.message ?? 'This link is no longer valid.'}
            </p>
            <Button asChild className="w-full">
              <a href={unauthorized?.verificationUrl ?? `${window.location.origin}/verify`}>
                Verify to continue
              </a>
            </Button>
            <Button variant="ghost" className="w-full mt-2" asChild>
              <Link to="/">Start a new quote</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const quote = response.quote;
  const booking = response.booking;

  // Terminal states — do NOT drop the customer into a blank form.
  if (booking && booking.scheduledStart) {
    const when = new Date(booking.scheduledStart);
    return (
      <div className="min-h-screen bg-background">
        <CustomerHeader />
        <div className="max-w-2xl mx-auto px-4 py-12">
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <CalendarCheck className="w-12 h-12 mx-auto text-primary" />
              <h1 className="text-2xl font-bold">Your service is already scheduled</h1>
              <p className="text-muted-foreground">
                {when.toLocaleString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </p>
              {booking.referenceNumber && (
                <p className="text-sm font-mono">
                  Reference: <span className="font-semibold">{booking.referenceNumber}</span>
                </p>
              )}
              <Button asChild className="w-full">
                <Link to="/my-appointments">Manage this appointment</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (quote.isDeclined || quote.isExpired || quote.isConverted) {
    const label = quote.isDeclined
      ? 'This bid was declined.'
      : quote.isExpired
      ? 'This bid has expired.'
      : 'This bid has already been converted to a booking.';
    return (
      <div className="min-h-screen bg-background">
        <CustomerHeader />
        <div className="max-w-2xl mx-auto px-4 py-12">
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground" />
              <h1 className="text-2xl font-bold">Bid no longer available</h1>
              <p className="text-muted-foreground">{label}</p>
              <Button asChild className="w-full">
                <Link to="/">Request a fresh bid</Link>
              </Button>
              <Button variant="ghost" asChild className="w-full">
                <Link to={`/quote/${quote.quoteId}?resume=${encodeURIComponent(resumeToken)}`}>
                  View original bid
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Waiting on authoritative pricing — never let the customer proceed without
  // a firm total. The saved quote's price is only re-verified here so booking
  // uses the SAME authoritative engine as the rest of the app.
  if (!quoteState.isFirm && !quoteState.isEstimated) {
    return (
      <div className="min-h-screen bg-background">
        <CustomerHeader />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center text-muted-foreground">
          Loading your saved bid…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <BookingFlow
          servicePrices={servicePrices}
          additionalServices={additionalServices}
          homeDetails={homeDetails}
          prefillCustomerInfo={prefillCustomerInfo}
          promotion={promotion}
          onCancel={() => {
            window.location.href = `/quote/${quote.quoteId}?resume=${encodeURIComponent(resumeToken)}`;
          }}
        />
      </main>
    </div>
  );
}