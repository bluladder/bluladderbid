import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Check, User, CheckCircle, CalendarCheck, Phone, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerInfoForm, type CustomerInfo } from './CustomerInfoForm';
import type { ServicePrices, AdditionalServices, HomeDetails, BundleTier } from '@/types/homeowner';
import type { TierCustomizations } from '@/hooks/usePlanCustomizations';

type RequestStep = 'info';

interface RecurringServiceRequestFlowProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  homeDetails: HomeDetails;
  selectedBundle: BundleTier;
  /** Canonical engine/rule versions the customer's displayed price came from. */
  engineVersion: string | null;
  ruleVersion: number | null;
  customizations?: TierCustomizations;
  onCancel: () => void;
  prefillCustomerInfo?: CustomerInfo | null;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

// Map the homeowner HomeDetails to the structural engine shape (NO pricing).
// Identical field set to useServerBundleTiers.toPayload so the server recompute
// reproduces the exact tier the customer saw.
function toEngineHome(h: HomeDetails) {
  return {
    squareFootage: h.squareFootage,
    stories: h.stories,
    windowCleaningType: h.windowCleaningType,
    condition: h.condition,
    showAdvanced: h.showAdvanced,
    hardWaterStains: h.hardWaterStains,
    hardWaterPercent: h.hardWaterPercent,
    frenchPanes: h.frenchPanes,
    frenchPanesPercent: h.frenchPanesPercent,
    solarScreens: h.solarScreens,
    solarScreensPercent: h.solarScreensPercent,
    ladderWork: h.ladderWork,
    ladderWorkCount: h.ladderWorkCount,
    sunroom: h.sunroom,
  };
}

interface PricingChange {
  annualTotal: number;
  monthlyPayment: number;
  engineVersion: string | null;
  ruleVersion: number | null;
}

export function RecurringServiceRequestFlow({
  servicePrices,
  additionalServices,
  homeDetails,
  selectedBundle,
  engineVersion,
  ruleVersion,
  customizations,
  onCancel,
  prefillCustomerInfo,
}: RecurringServiceRequestFlowProps) {
  const [step] = useState<RequestStep>('info');
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(prefillCustomerInfo || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [pricingChange, setPricingChange] = useState<PricingChange | null>(null);

  // One idempotency key per intended plan submission (stable across retries and
  // across a pricing-change reconfirmation) so no duplicate records are created.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const buildPayload = (info: CustomerInfo, confirmPricingChange: boolean) => ({
    customer: {
      email: info.email,
      firstName: info.firstName,
      lastName: info.lastName,
      phone: info.phone,
      address: info.address,
    },
    tier: selectedBundle.tier,
    homeDetails: toEngineHome(homeDetails),
    additionalServices,
    customizations: customizations ?? undefined,
    // Expected values are for MISMATCH DETECTION ONLY — never authoritative.
    expectedEngineVersion: engineVersion,
    expectedRuleVersion: ruleVersion,
    expectedAnnualTotal: selectedBundle.annualTotal,
    confirmPricingChange,
    idempotencyKey: idempotencyKeyRef.current,
    notes: info.notes,
  });

  const submit = async (info: CustomerInfo, confirmPricingChange: boolean) => {
    if (!info) {
      toast.error('Please provide your contact information');
      return;
    }
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-create-service-request', {
        body: buildPayload(info, confirmPricingChange),
      });
      if (error) throw new Error(error.message || 'Failed to submit request');

      const res = data as { status?: string; pricing_changed?: boolean; current?: { annualTotal: number; monthlyPayment: number; engineVersion: string | null; ruleVersion: number | null }; error?: string; missing?: string[]; reasons?: string[] };

      if (res.status === 'pricing_changed' && res.current) {
        // Do NOT book. Show the updated summary and require fresh confirmation.
        setPricingChange({
          annualTotal: res.current.annualTotal,
          monthlyPayment: res.current.monthlyPayment,
          engineVersion: res.current.engineVersion,
          ruleVersion: res.current.ruleVersion,
        });
        toast.warning('Pricing has been updated — please review and confirm the new plan.');
        return;
      }
      if (res.status === 'missing_information') {
        toast.error('More property information is needed before we can finalize this plan.');
        return;
      }
      if (res.status === 'manual_review_required') {
        toast.error('This plan needs a manual quote — our team will follow up with you.');
        return;
      }
      if (res.status === 'unknown_option' || res.status === 'pricing_unavailable' || res.status === 'error') {
        toast.error(res.error || 'We could not finalize this plan right now. Please try again.');
        return;
      }
      if (res.status !== 'ok') {
        toast.error('Unable to submit your plan request. Please try again.');
        return;
      }

      setPricingChange(null);
      setIsSuccess(true);
      toast.success('Your service plan request has been submitted!');
    } catch (err) {
      console.error('Submit request error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomerInfoSubmit = async (info: CustomerInfo) => {
    setCustomerInfo(info);
    await submit(info, false);
  };

  const handleConfirmNewPricing = async () => {
    if (!customerInfo) return;
    await submit(customerInfo, true);
  };

  const progress = 100;

  // Success state
  if (isSuccess) {
    return (
      <Card className="card-summary">
        <CardContent className="py-12 text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/20 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-success" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">Request Submitted!</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Thank you for your interest in our {selectedBundle.name} plan.
              A member of our team will contact you within 1 business day to schedule your first service.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 max-w-sm mx-auto">
            <div className="flex items-center gap-3 text-left">
              <Phone className="w-5 h-5 text-primary flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">What happens next?</p>
                <p className="text-sm text-muted-foreground">
                  We'll call to confirm your plan details and schedule your first appointment at a time that works for you.
                </p>
              </div>
            </div>
          </div>
          <Button onClick={onCancel} className="mt-6">Return to Quote</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-summary">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1 -ml-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Quote
          </Button>
        </div>
        <div className="space-y-2">
          <CardTitle className="text-xl flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-primary" />
            Request Service Plan
          </CardTitle>
          <CardDescription>
            Submit your information and we'll contact you to set up your recurring service
          </CardDescription>
        </div>
        <Progress value={progress} className="mt-4" />
        <div className="text-center text-xs text-muted-foreground mt-2">
          Enter Your Information to Submit Request
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Pricing changed — require explicit reconfirmation before booking. */}
        {pricingChange && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Pricing updated</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                Our pricing changed since you selected this plan. The current {selectedBundle.name} plan
                total is <strong>{formatPrice(pricingChange.annualTotal)}/year</strong>
                {' '}(<strong>{formatPrice(pricingChange.monthlyPayment)}/month</strong>).
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleConfirmNewPricing} disabled={isSubmitting}>
                  <Check className="w-4 h-4 mr-1" />
                  Confirm new price
                </Button>
                <Button size="sm" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                  Cancel
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Selected Plan Summary */}
        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
          <div className="flex items-center justify-between mb-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
              selectedBundle.tier === 'good'
                ? 'tier-badge-good'
                : selectedBundle.tier === 'better'
                  ? 'tier-badge-better'
                  : 'tier-badge-best'
            }`}>
              {selectedBundle.name}
            </span>
            <span className="text-sm font-medium text-primary">{selectedBundle.label}</span>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {formatPrice(pricingChange ? pricingChange.monthlyPayment : selectedBundle.monthlyPayment)}
            <span className="text-base font-normal text-muted-foreground">/month</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {formatPrice(pricingChange ? pricingChange.annualTotal : selectedBundle.annualTotal)} annually
            {!pricingChange && selectedBundle.savings > 0 && ` • Save ${formatPrice(selectedBundle.savings)}`}
          </p>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="w-4 h-4" />
            <span>We'll use this information to contact you</span>
          </div>

          <CustomerInfoForm
            onSubmit={handleCustomerInfoSubmit}
            initialData={customerInfo ?? undefined}
            isSubmitting={isSubmitting}
            submitButtonText="Submit Request"
          />

          <p className="text-xs text-center text-muted-foreground">
            By submitting, you're requesting information about our {selectedBundle.name} plan.
            No payment is required at this time.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
