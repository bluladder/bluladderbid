import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  CheckCircle2, ArrowRight, CreditCard,
  Home, Clock, Copy, FileText, AlertCircle, XCircle, ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { BookingHelpContact } from '@/components/booking/BookingHelpContact';
import { DeclineQuoteDialog } from '@/components/quote/DeclineQuoteDialog';

// Typed customer-safe DTOs mirroring the quote-resume edge function response.
interface QuoteDtoBase {
  quoteId: string;
  createdAt: string;
  expiresAt: string | null;
  status: string;
  isExpired: boolean;
  isDeclined: boolean;
  isConverted: boolean;
  firstName: string | null;
  serviceAddress: {
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  home: { squareFootage: number | null; stories: number | null };
}
interface OneTimeQuoteDto extends QuoteDtoBase {
  quoteType: 'one_time';
  total: number;
  subtotal: number;
  lineItems: Array<{ label: string; amount: number; description?: string }>;
  promotion: { label?: string; amount?: number } | null;
  discount: { code?: string; amount?: number } | null;
}
interface RecurringQuoteDto extends QuoteDtoBase {
  quoteType: 'recurring_plan';
  annualTotal: number;
  monthlyPayment: number | null;
  downPayment: number | null;
  billingCadence: 'one_time' | 'monthly' | 'annual';
  services: Array<{
    name: string;
    frequency: number | null;
    pricePerVisit: number | null;
    annualTotal: number | null;
  }>;
  promotion: { label?: string; amount?: number } | null;
}
type QuoteDto = OneTimeQuoteDto | RecurringQuoteDto;

function money(n: number | null | undefined): string {
  if (!Number.isFinite(Number(n))) return '';
  return `$${Math.round(Number(n)).toLocaleString('en-US')}`;
}

export default function QuoteView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const resumeToken = searchParams.get('resume') ?? '';
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState<null | { message: string; verificationUrl: string }>(null);
  const [declineOpen, setDeclineOpen] = useState(false);

  const verifyUrl = useMemo(
    () => (unauthorized?.verificationUrl || `${window.location.origin}/verify`),
    [unauthorized],
  );

  useEffect(() => {
    let cancelled = false;
    if (!id || !resumeToken) {
      // Bare /quote/<uuid> — never fetch. Route into customer verification.
      setIsLoading(false);
      setUnauthorized({
        message:
          'For your security, this link requires verification. Verify your identity to view your quote.',
        verificationUrl: `${window.location.origin}/verify`,
      });
      return;
    }
    setIsLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('quote-resume', {
          body: { quoteId: id, token: resumeToken },
        });
        if (cancelled) return;
        if (error || !data) {
          setUnauthorized({
            message: 'This link is no longer valid. Verify your identity to continue securely.',
            verificationUrl: `${window.location.origin}/verify`,
          });
          return;
        }
        if (!data.ok) {
          setUnauthorized({
            message: data.message || 'This link is no longer valid.',
            verificationUrl: data.verificationUrl || `${window.location.origin}/verify`,
          });
          return;
        }
        setQuote(data.quote as QuoteDto);
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

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Link copied to clipboard!');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading quote…</div>
      </div>
    );
  }

  if (unauthorized || !quote) {
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
              <a href={unauthorized?.verificationUrl ?? verifyUrl}>Verify to continue</a>
            </Button>
            <Button variant="ghost" className="w-full mt-2" asChild>
              <Link to="/plan-builder">Start a new quote</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const addr = quote.serviceAddress;
  const canDecline = !quote.isExpired && !quote.isDeclined && !quote.isConverted;
  const displayName = quote.firstName ?? 'there';

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8 md:py-12">
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <FileText className="w-4 h-4" />
            {quote.quoteType === 'recurring_plan' ? 'Service Plan Quote' : 'Service Quote'}
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-2">
            Hi {displayName} — your bid is ready
          </h1>
          <p className="text-muted-foreground text-sm">
            Created {format(new Date(quote.createdAt), 'MMMM d, yyyy')}
          </p>
          {quote.isExpired && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" /> This quote has expired
            </div>
          )}
          {quote.isDeclined && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm">
              <XCircle className="w-4 h-4" /> You declined this bid. No further reminders will be sent.
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
          <div className="md:col-span-2 space-y-4 sm:space-y-6">
            <Card className="card-elevated">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Home className="w-5 h-5 text-primary" /> Property Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(quote.home.squareFootage || quote.home.stories) && (
                  <div>
                    <span className="text-muted-foreground">Home Size</span>
                    <p className="font-medium">
                      {quote.home.squareFootage
                        ? `${quote.home.squareFootage.toLocaleString()} sq ft`
                        : '—'}
                      {quote.home.stories
                        ? ` • ${quote.home.stories} ${quote.home.stories === 1 ? 'story' : 'stories'}`
                        : ''}
                    </p>
                  </div>
                )}
                {addr && (addr.street || addr.city) && (
                  <div className="pt-2 border-t">
                    <span className="text-sm text-muted-foreground">Service Address</span>
                    <p className="font-medium text-sm break-words">
                      {addr.street}
                      {addr.city && `, ${addr.city}`}
                      {addr.state && `, ${addr.state}`}
                      {addr.zip && ` ${addr.zip}`}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {quote.quoteType === 'one_time' ? (
              <Card className="card-elevated">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-primary" /> Included Services
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {quote.lineItems.map((li, i) => (
                      <li key={`${li.label}-${i}`} className="flex justify-between items-start gap-4 py-2 border-b last:border-0">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{li.label}</p>
                          {li.description && (
                            <p className="text-xs text-muted-foreground break-words">{li.description}</p>
                          )}
                        </div>
                        <span className="font-semibold text-foreground whitespace-nowrap">{money(li.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : (
              <Card className="card-elevated">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-primary" /> Included Services
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {quote.services.map((s, i) => (
                      <li key={`${s.name}-${i}`} className="flex justify-between items-start gap-4 py-2 border-b last:border-0">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{s.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.frequency ? `${s.frequency}x per year` : ''}
                            {s.pricePerVisit ? ` @ ${money(s.pricePerVisit)}/visit` : ''}
                          </p>
                        </div>
                        <span className="font-semibold text-foreground whitespace-nowrap">
                          {s.annualTotal ? `${money(s.annualTotal)}/yr` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <div className="mt-4">
              <BookingHelpContact variant="quote" bidLink={window.location.href} customerName={quote.firstName ?? undefined} />
            </div>
          </div>

          <div className="md:col-span-1">
            <Card className="card-elevated md:sticky md:top-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  {quote.quoteType === 'recurring_plan' ? 'Payment Plan' : 'Total'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {quote.quoteType === 'one_time' ? (
                  <>
                    <div className="text-center py-3 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Total</p>
                      <p className="text-3xl font-bold text-foreground">{money(quote.total)}</p>
                    </div>
                    {quote.promotion?.label && (
                      <p className="text-xs text-primary text-center">Promotion: {quote.promotion.label}</p>
                    )}
                    {quote.discount?.code && (
                      <p className="text-xs text-muted-foreground text-center">Discount: {quote.discount.code}</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-center py-3 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Annual Value</p>
                      <p className="text-3xl font-bold text-foreground">{money(quote.annualTotal)}</p>
                    </div>
                    <Separator />
                    <div className="space-y-3">
                      {quote.downPayment != null && (
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">1</div>
                          <div className="flex-1">
                            <p className="text-sm text-muted-foreground">Down Payment</p>
                            <p className="text-xl font-bold text-primary">{money(quote.downPayment)}</p>
                          </div>
                        </div>
                      )}
                      {quote.monthlyPayment != null && (
                        <>
                          <div className="flex items-center gap-2 text-muted-foreground text-sm pl-4">
                            <ArrowRight className="w-4 h-4" /><span>Then monthly payments</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-bold">2+</div>
                            <div className="flex-1">
                              <p className="text-sm text-muted-foreground">Monthly Payment</p>
                              <p className="text-xl font-bold text-foreground">{money(quote.monthlyPayment)}/mo</p>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}

                <Separator />

                <div className="space-y-2">
                  {!quote.isExpired && !quote.isDeclined && (
                    <Button className="w-full btn-primary" size="lg" asChild>
                      <Link to="/plan-builder">Accept &amp; Book</Link>
                    </Button>
                  )}
                  <Button variant="outline" className="w-full" onClick={handleCopyLink}>
                    <Copy className="w-4 h-4 mr-2" /> Copy Quote Link
                  </Button>
                  {canDecline && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground hover:text-destructive"
                      onClick={() => setDeclineOpen(true)}
                    >
                      Not interested? Decline this bid
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center">
                  <Clock className="w-3 h-3" /><span>Quote valid for 30 days</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Prices are estimates based on the information provided.
            Final pricing may adjust if on-site conditions differ.
          </p>
          <Button variant="ghost" asChild>
            <Link to="/plan-builder">Create a Different Plan</Link>
          </Button>
        </div>
      </div>
      <DeclineQuoteDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        quoteId={quote.quoteId}
        emailOnFile={null}
        resumeToken={resumeToken}
        onDeclined={() => setQuote((q) => (q ? { ...q, status: 'declined', isDeclined: true } : q))}
      />
    </div>
  );
}