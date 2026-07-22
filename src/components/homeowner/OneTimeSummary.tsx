import { useState, useEffect, useRef } from 'react';
import { Calendar, Download, Check, Sparkles, Loader2, Info, HelpCircle, Bookmark, Mail, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { DiscountCodeInput } from './DiscountCodeInput';
import { BookingFlow } from '@/components/booking/BookingFlow';
import { BookingHelpContact } from '@/components/booking/BookingHelpContact';
import { useServerQuoteCalculation } from '@/hooks/useServerQuoteCalculation';
import { toQuoteInput, hasAnyServiceSelected } from '@/lib/pricing/toQuoteInput';
import { useWindowPromoConfig } from '@/hooks/useWindowPromoConfig';
import { deriveQuoteId, fireLead } from '@/lib/attribution/metaPixel';
import { bridgeFireQuoteSubmitted } from '@/lib/bridge/bluladderBidPostMessage';
import { getOrCreateSourceSessionId, readAttribution } from '@/lib/attribution/attribution';
import type { ServicePrices, AdditionalServices, HomeDetails } from '@/types/homeowner';
import type { ValidatedDiscount } from '@/hooks/useDiscountCodes';
import type { CustomerInfo } from '@/components/booking/CustomerInfoForm';

interface OneTimeSummaryProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  homeDetails: HomeDetails;
  onDownloadPDF: () => void;
  onGetStarted: () => void;
  prefillCustomerInfo?: CustomerInfo | null;
  /** Notifies the page when the full booking flow opens/closes so it can widen the layout. */
  onBookingActiveChange?: (active: boolean) => void;
  /** Enables in-flow upsells that mutate parent selection state (presentation only). */
  onAdditionalServicesChange?: (updater: (prev: AdditionalServices) => AdditionalServices) => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

// Local helpers — SMS destination normalization + PII masking for success UI.
// Kept in-file to avoid growing the shared surface for a single delivery flow.
function normalizePhoneForBid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
function maskPhone(e164: string): string {
  const digits = e164.replace(/\D+/g, '').slice(-10);
  if (digits.length !== 10) return '••• ••• ••••';
  return `(${digits.slice(0, 3)}) •••-${digits.slice(6)}`;
}
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '•••@•••';
  const head = user.slice(0, Math.min(2, user.length));
  return `${head}${'•'.repeat(Math.max(1, user.length - head.length))}@${domain}`;
}

/** Human-readable prompts for the fields the pricing engine says are missing. */
const MISSING_LABELS: Record<string, string> = {
  squareFootage: 'Enter your home square footage',
  stories: 'Tell us how many stories your home has',
  services: 'Select at least one service',
};

export function OneTimeSummary({ 
  servicePrices, 
  additionalServices,
  homeDetails,
  onDownloadPDF,
  onGetStarted,
  prefillCustomerInfo,
  onBookingActiveChange,
  onAdditionalServicesChange,
}: OneTimeSummaryProps) {
  const [appliedDiscount, setAppliedDiscount] = useState<ValidatedDiscount | null>(null);
  const [showBookingFlow, setShowBookingFlow] = useState(false);
  const [saveDialogAction, setSaveDialogAction] = useState<null | 'save' | 'email' | 'text'>(null);
  const [saveEmail, setSaveEmail] = useState(prefillCustomerInfo?.email ?? '');
  const [saveFirstName, setSaveFirstName] = useState(prefillCustomerInfo?.firstName ?? '');
  const [savePhone, setSavePhone] = useState(prefillCustomerInfo?.phone ?? '');
  const [saveSubmitting, setSaveSubmitting] = useState(false);
  const [savedQuoteUrl, setSavedQuoteUrl] = useState<string | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<null | { channel: 'email' | 'text'; masked: string }>(null);
  // Idempotency guard: remember exact (channel, normalized destination) pairs
  // already delivered for this quote so retries don't fire duplicate sends.
  const [deliveredKeys, setDeliveredKeys] = useState<Set<string>>(() => new Set());

  // Let the page know whether the booking flow is taking over the view.
  useEffect(() => {
    onBookingActiveChange?.(showBookingFlow);
    return () => onBookingActiveChange?.(false);
  }, [showBookingFlow, onBookingActiveChange]);

  // AUTHORITATIVE pricing — every dollar shown here comes from the deployed
  // calculate-quote Edge Function. No local pricing math or fallback estimate.
  const hasServices = hasAnyServiceSelected(additionalServices);
  const { promo: windowPromo } = useWindowPromoConfig();
  const promoRequest =
    windowPromo && homeDetails.windowCleaningType === 'promo_99'
      ? { id: windowPromo.promoId, windowCount: windowPromo.maxWindows }
      : null;
  const quoteState = useServerQuoteCalculation(
    hasServices ? toQuoteInput(homeDetails, additionalServices, appliedDiscount, promoRequest) : null,
    { enabled: hasServices },
  );
  const { quote, total, isFirm, loading, isMissingInfo, isManualReview, isUnavailable } = quoteState;

  const serverDiscountAmount = quote?.discount?.amount ?? 0;
  const canBook = isFirm && typeof total === 'number';

  const handleDelivery = async () => {
    if (!saveDialogAction || !quote || typeof total !== 'number') return;
    const email = saveEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error('Please enter a valid email address.');
      return;
    }
    // For SMS delivery we require a mobile number; validate before persisting.
    let normalizedPhone: string | null = null;
    if (saveDialogAction === 'text') {
      normalizedPhone = normalizePhoneForBid(savePhone);
      if (!normalizedPhone) {
        toast.error('Please enter a valid 10-digit mobile number.');
        return;
      }
    }

    const dedupeKey =
      saveDialogAction === 'text' ? `text:${normalizedPhone}`
      : saveDialogAction === 'email' ? `email:${email}`
      : null;
    if (dedupeKey && deliveredKeys.has(dedupeKey)) {
      // Same destination already delivered for this quote — no duplicate send.
      toast.info(saveDialogAction === 'text'
        ? 'Bid already texted to that number.'
        : 'Bid already emailed to that address.');
      setSaveDialogAction(null);
      return;
    }

    setSaveSubmitting(true);
    try {
      const attribution = readAttribution();
      const services = quote.lineItems.map((li) => ({ key: li.key, name: li.label, amount: li.amount }));
      // 'text' action reuses the save persistence path so we get the SAME
      // quote row + resume token as email; SMS delivery is a follow-up
      // invocation of the existing transactional sender.
      const saveAction: 'save' | 'email' = saveDialogAction === 'email' ? 'email' : 'save';
      const { data, error } = await supabase.functions.invoke('save-quote', {
        body: {
          action: saveAction,
          email,
          firstName: saveFirstName || prefillCustomerInfo?.firstName || null,
          lastName: prefillCustomerInfo?.lastName || null,
          phone: normalizedPhone || prefillCustomerInfo?.phone || null,
          total,
          subtotal: quote.subtotal,
          services,
          homeDetails,
          sourceSessionId: getOrCreateSourceSessionId(),
          utmParams: attribution.last_touch ?? attribution.first_touch ?? null,
          attribution,
          ruleVersion: quoteState.ruleVersion,
          engineVersion: quoteState.engineVersion,
          lineItems: quote.lineItems,
          promotion: promoRequest,
        },
      });
      if (error) throw error;
      const resp = data as {
        quoteId?: string;
        quoteUrl?: string;
        emailStatus?: 'accepted' | 'failed' | 'suppressed' | 'skipped' | 'sent';
        emailFailureReason?: string | null;
      } | null;
      setSavedQuoteUrl(resp?.quoteUrl ?? null);

      if (saveDialogAction === 'text' && resp?.quoteId && normalizedPhone) {
        const { error: smsErr } = await supabase.functions.invoke('send-sms', {
          body: { eventType: 'quote_created', quoteId: resp.quoteId },
        });
        if (smsErr) throw smsErr;
        const masked = maskPhone(normalizedPhone);
        setDeliveryStatus({ channel: 'text', masked });
        setDeliveredKeys((prev) => new Set(prev).add(dedupeKey!));
        toast.success(`Bid texted to ${masked}.`);
      } else if (saveDialogAction === 'email') {
        const masked = maskEmail(email);
        // "accepted" = Resend acknowledged with a provider id; delivery is
        // NOT yet confirmed. Don't claim "delivered" or "sent" here — that
        // only happens when the resend-webhook flips the attempt.
        if (resp?.emailStatus === 'accepted' || resp?.emailStatus === 'sent') {
          setDeliveryStatus({ channel: 'email', masked });
          setDeliveredKeys((prev) => new Set(prev).add(dedupeKey!));
          toast.success(`Quote email accepted for delivery to ${masked}.`);
        } else if (resp?.emailStatus === 'suppressed') {
          // Provider already refuses this address — don't add to dedupe set
          // so the customer can correct the destination and retry.
          toast.error(
            `We can't send email to ${masked} — that address is blocked by our email provider. Please use a different address.`
          );
        } else {
          toast.error(
            "We couldn't send the email to that address. Please verify the address or use a different one."
          );
        }
      } else {
        toast.success('Bid saved for 30 days.');
      }
      setSaveDialogAction(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong sending this bid. Please retry.');
    } finally {
      setSaveSubmitting(false);
    }
  };

  // Fire Meta Pixel "Lead" ONLY after the canonical server quote returns firm.
  // The event id is deterministic per canonical fingerprint, so refreshes,
  // rerenders, and repeated identical quotes all dedupe to a single Lead.
  const leadFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFirm || typeof total !== 'number' || !quote) return;
    const services = Object.entries(additionalServices)
      .filter(([, v]) => (typeof v === 'boolean' ? v : Boolean(v)))
      .map(([k]) => k);
    const quoteId = deriveQuoteId({
      ruleVersion: quoteState.ruleVersion,
      engineVersion: quoteState.engineVersion,
      total,
      services,
      session: getOrCreateSourceSessionId(),
    });
    if (leadFiredRef.current === quoteId) return;
    leadFiredRef.current = quoteId;
    fireLead({
      id: quoteId,
      quoted_total: total,
      service_count: services.length,
      services_selected: services,
      firm: true,
    });
    // Mirror the firm-quote signal to the marketing overlay. This shares the
    // same firm-quote gate as fireLead and is sender-side-deduped, so
    // reopening the summary / React rerenders do not resend it. This does
    // NOT create a second Meta Lead — Meta ownership stays with fireLead.
    bridgeFireQuoteSubmitted({
      id: quoteId,
      total,
      serviceSlugs: services,
    });
  }, [isFirm, total, quote, additionalServices, quoteState.ruleVersion, quoteState.engineVersion]);

  // Show booking flow — only reachable with a current, firm server quote.
  if (showBookingFlow) {
    return (
      <BookingFlow
        servicePrices={servicePrices}
        additionalServices={additionalServices}
        homeDetails={homeDetails}
        appliedDiscount={appliedDiscount}
        discountAmount={serverDiscountAmount}
        onCancel={() => setShowBookingFlow(false)}
        prefillCustomerInfo={prefillCustomerInfo}
        promotion={promoRequest}
        onAdditionalServicesChange={onAdditionalServicesChange}
      />
    );
  }
  
  return (
    <Card className="card-summary">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="section-icon bg-accent">
            <Sparkles className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">One-Time Service Quote</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {homeDetails.squareFootage.toLocaleString()} sq ft • {homeDetails.stories} {homeDetails.stories === 1 ? 'story' : 'stories'}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ---------------------------------------------------------------- */}
        {/* No services selected */}
        {/* ---------------------------------------------------------------- */}
        {!hasServices && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Select a service to see your price.</p>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Loading — never flash an old or fallback price */}
        {/* ---------------------------------------------------------------- */}
        {hasServices && loading && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mb-3 text-primary" />
            <p className="text-sm">Calculating your price…</p>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Missing information — ask the specific questions, no total */}
        {/* ---------------------------------------------------------------- */}
        {hasServices && isMissingInfo && (
          <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-2">
            <div className="flex items-center gap-2 text-foreground font-medium text-sm">
              <Info className="w-4 h-4 text-primary" />
              A little more information is needed
            </div>
            <ul className="text-sm text-muted-foreground list-disc pl-8 space-y-1">
              {quoteState.missing.map((m) => (
                <li key={m}>{MISSING_LABELS[m] ?? m}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Manual review required */}
        {/* ---------------------------------------------------------------- */}
        {hasServices && isManualReview && (
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-muted/50 border border-border flex items-start gap-2">
              <HelpCircle className="w-4 h-4 text-primary mt-0.5" />
              <p className="text-sm text-muted-foreground">
                This service needs a customized quote. Share your details and our team will follow up.
              </p>
            </div>
            <BookingHelpContact variant="quote" />
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Pricing temporarily unavailable — no error details, no estimate */}
        {/* ---------------------------------------------------------------- */}
        {hasServices && isUnavailable && (
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-muted/50 border border-border flex items-start gap-2">
              <Info className="w-4 h-4 text-primary mt-0.5" />
              <p className="text-sm text-muted-foreground">
                We're temporarily unable to calculate this price. You can request a quote and our team will follow up.
              </p>
            </div>
            <BookingHelpContact variant="quote" />
            <Button variant="outline" className="w-full" onClick={quoteState.refetch}>
              Try again
            </Button>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Firm quote */}
        {/* ---------------------------------------------------------------- */}
        {hasServices && isFirm && quote && (
          <>
            {/* Total Price */}
            <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
              <div className="flex items-center justify-between mb-2">
                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-accent/20 text-accent-foreground">
                  One-Time
                </span>
                <span className="text-sm font-medium text-accent">Single Appointment</span>
              </div>
              <div className="text-3xl price-display text-foreground">
                {serverDiscountAmount > 0 ? (
                  <>
                    <span className="line-through text-muted-foreground text-xl mr-2">
                      {formatPrice(quote.subtotal)}
                    </span>
                    {formatPrice(quote.total)}
                  </>
                ) : (
                  formatPrice(quote.total)
                )}
                <span className="text-base font-normal text-muted-foreground"> total</span>
              </div>
              {serverDiscountAmount > 0 && (
                <p className="text-sm text-green-600 mt-1">
                  You save {formatPrice(serverDiscountAmount)}!
                </p>
              )}
            </div>

            {/* Discount Code */}
            <DiscountCodeInput onApply={setAppliedDiscount} appliedDiscount={appliedDiscount} />

            {/* Service Breakdown — rendered from the AUTHORITATIVE server line items */}
            <div className="space-y-3">
              <h4 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                Services Included
              </h4>
              <div className="space-y-2 text-sm">
                {quote.lineItems.map((li) => (
                  <div key={li.key} className="space-y-1">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-success" />
                        {li.label}
                      </span>
                      <span className="font-medium">{formatPrice(li.amount)}</span>
                    </div>
                    {li.adjustments.map((adj, i) => (
                      <div key={i} className="flex justify-between text-muted-foreground pl-6 text-xs">
                        <span>• {adj.label}</span>
                        {adj.amount > 0 && <span>+{formatPrice(adj.amount)}</span>}
                      </div>
                    ))}
                    {li.minimumApplied && (
                      <div className="text-muted-foreground pl-6 text-xs">• Service minimum applied</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Summary */}
            <div className="space-y-3">
              {serverDiscountAmount > 0 && (
                <>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatPrice(quote.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount{quote.discount?.code ? ` (${quote.discount.code})` : ''}</span>
                    <span>-{formatPrice(serverDiscountAmount)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-lg font-semibold">
                <span>Total Due</span>
                <span className="price-display text-accent">{formatPrice(quote.total)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                All services completed in a single appointment
              </p>
            </div>

            {/* Disclaimer */}
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Firm quote based on the information provided. Final pricing may adjust only if
                on-site conditions differ from what was entered.
                {quote.ruleVersion != null && (
                  <span className="block mt-1 opacity-70">Pricing version {quote.ruleVersion}</span>
                )}
              </p>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="space-y-3 pt-2">
          <Button
            className="w-full btn-primary h-12 text-base"
            onClick={() => setShowBookingFlow(true)}
            disabled={!canBook}
          >
            <Calendar className="w-5 h-5 mr-2" />
            Book Now
          </Button>

          <Button
            variant="outline"
            className="w-full btn-secondary"
            onClick={onDownloadPDF}
            disabled={!canBook}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Quote PDF
          </Button>

          {/* Secondary quote actions — Book Now above stays primary. Compact
              labels with truncation guards so they never wrap or clip. */}
          <div className="grid grid-cols-3 gap-2" data-testid="secondary-quote-actions">
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 whitespace-nowrap"
              onClick={() => setSaveDialogAction('save')}
              disabled={!canBook}
            >
              <Bookmark className="w-4 h-4 mr-1.5 shrink-0" />
              <span className="truncate">Save</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 whitespace-nowrap"
              onClick={() => setSaveDialogAction('email')}
              disabled={!canBook}
            >
              <Mail className="w-4 h-4 mr-1.5 shrink-0" />
              <span className="truncate">Email</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 whitespace-nowrap"
              onClick={() => setSaveDialogAction('text')}
              disabled={!canBook}
            >
              <MessageSquare className="w-4 h-4 mr-1.5 shrink-0" />
              <span className="truncate">Text</span>
            </Button>
          </div>
          {deliveryStatus && (
            <p className="text-xs text-center text-success" data-testid="delivery-success">
              {deliveryStatus.channel === 'email'
                ? `Quote email accepted for delivery to ${deliveryStatus.masked}. We'll confirm delivery in your inbox.`
                : `Bid texted to ${deliveryStatus.masked}.`}
            </p>
          )}
          {savedQuoteUrl && (
            <p className="text-xs text-center text-muted-foreground">
              Bid saved. <a href={savedQuoteUrl} className="underline text-primary">View your saved bid</a> — held for 30 days.
            </p>
          )}
        </div>
      </CardContent>

      <Dialog open={saveDialogAction !== null} onOpenChange={(o) => !o && setSaveDialogAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {saveDialogAction === 'email' ? 'Email me this bid'
                : saveDialogAction === 'text' ? 'Text me this bid'
                : 'Save this bid'}
            </DialogTitle>
            <DialogDescription>
              We'll hold this exact price for 30 days. No payment or commitment.
              {saveDialogAction === 'text' && ' We\u2019ll text a secure link — reply STOP to opt out anytime.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="save-first">First name (optional)</Label>
              <Input id="save-first" value={saveFirstName} onChange={(e) => setSaveFirstName(e.target.value)} placeholder="Jane" />
            </div>
            <div>
              <Label htmlFor="save-email">Email</Label>
              <Input
                id="save-email"
                type="email"
                value={saveEmail}
                onChange={(e) => setSaveEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus={saveDialogAction !== 'text'}
              />
            </div>
            {saveDialogAction === 'text' && (
              <div>
                <Label htmlFor="save-phone">Mobile number</Label>
                <Input
                  id="save-phone"
                  type="tel"
                  inputMode="tel"
                  value={savePhone}
                  onChange={(e) => setSavePhone(e.target.value)}
                  placeholder="(469) 555-0123"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Msg & data rates may apply. Reply STOP to opt out.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogAction(null)} disabled={saveSubmitting}>Cancel</Button>
            <Button
              onClick={handleDelivery}
              disabled={saveSubmitting || !saveEmail || (saveDialogAction === 'text' && !savePhone)}
            >
              {saveSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {saveDialogAction === 'email' ? 'Email me the bid'
                : saveDialogAction === 'text' ? 'Text me the bid'
                : 'Save my bid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
