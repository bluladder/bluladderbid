import { useState } from 'react';
import { RefreshCw, Check, Sparkles, Star, Calendar, ChevronDown, ArrowRight, CreditCard, Zap, AlertCircle, Loader2, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { BundleTier, ServicePrices, AdditionalServices, HomeDetails } from '@/types/homeowner';
import { PlanCustomizeDrawer, type PlanCustomization } from './PlanCustomizeDrawer';
import { computePlanPaymentBreakdown } from '@/lib/pricing/planPaymentBreakdown';

interface PlanUpsellCardProps {
  oneTimeTotal: number;
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  bundles: BundleTier[];
  selectedTier: 'good' | 'better' | 'best' | null;
  onSelectTier: (tier: 'good' | 'better' | 'best') => void;
  onBookOneTime: () => void;
  onUpgradeAndBook: () => void;
  /**
   * Optional handler invoked when the customer saves changes in the customize
   * drawer. When provided along with `homeDetails`, PlanUpsellCard renders an
   * inline "Customize plan" button that opens the drawer.
   */
  onCustomizePlan?: (tier: 'good' | 'better' | 'best', customization: PlanCustomization) => void;
  /** Home details are required by the customize drawer for live pricing. */
  homeDetails?: HomeDetails;
  /** Used to show whether the displayed price is a starting estimate. */
  homeSquareFootage?: number;
  /** Live server-authoritative plan phase; drives fail-closed behavior. */
  planPhase?: 'idle' | 'loading' | 'ready' | 'missing_information' | 'manual_review_required' | 'unavailable';
  onRetryPlan?: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

// Cent-precise formatting for the exact payment schedule. Amounts shown to
// the customer here must match what the payment processor will charge.
function formatPriceCents(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

export function PlanUpsellCard({
  oneTimeTotal,
  servicePrices,
  additionalServices,
  bundles,
  selectedTier,
  onSelectTier,
  onBookOneTime,
  onUpgradeAndBook,
  onCustomizePlan,
  homeDetails,
  homeSquareFootage,
  planPhase,
  onRetryPlan,
}: PlanUpsellCardProps) {
  const [showAllPlans, setShowAllPlans] = useState(false);
  const hasServices = oneTimeTotal > 0;
  // When square footage hasn't been entered yet, the price is just a starting
  // minimum, so we label it clearly to avoid it reading as a final quote.
  const isEstimate = !homeSquareFootage || homeSquareFootage <= 0;
  
  // Default to "best" tier as recommended: 4 seasonal window visits — 2 exterior
  // only + 2 inside & out — matches the plan we actively upsell. When bundles
  // are unavailable this is intentionally undefined — we fail closed rather
  // than render $0.
  const recommendedBundle = bundles.find(b => b.tier === 'best') || bundles[bundles.length - 1];
  const currentBundle = selectedTier
    ? bundles.find(b => b.tier === selectedTier) || recommendedBundle
    : recommendedBundle;

  // Derive a fully reconciled 20%-deposit + 11-monthly-installment schedule
  // from the AUTHORITATIVE annual total. Zero-dollar plans must never render,
  // be selectable, or be bookable.
  const annualOneTimeValue = currentBundle
    ? oneTimeTotal * (currentBundle.windowFrequency || 2)
    : 0;
  const breakdown = currentBundle
    ? computePlanPaymentBreakdown({
        annualTotal: currentBundle.annualTotal,
        authoritativeSavings: currentBundle.savings,
        comparisonTotal: annualOneTimeValue,
      })
    : null;
  const hasValidPlan = !!currentBundle && !!breakdown;
  
  // Count enabled services based on selection state
  const enabledServices = [
    additionalServices.windowCleaning,
    additionalServices.houseWash,
    additionalServices.gutterCleaning,
    additionalServices.roofCleaning,
    additionalServices.drivewayCleaning.enabled,
    additionalServices.pressureWashing.enabled,
  ].filter(Boolean).length;

  // Reconciled figures from the shared breakdown helper.
  const deposit = breakdown?.depositAmount ?? 0;
  const monthlyPayment = breakdown?.monthlyPayment ?? 0;
  const annualSavings = breakdown?.savings ?? 0;
  const annualTotal = breakdown?.annualTotal ?? 0;
  const remainingPayments = breakdown?.remainingPayments ?? 11;
  const regularPaymentCount = breakdown?.regularPaymentCount ?? 10;
  const finalPayment = breakdown?.finalPayment ?? monthlyPayment;
  const hasFinalAdjustment = breakdown?.hasFinalAdjustment ?? false;
  
  if (!hasServices) {
    return (
      <Card className="card-gradient">
        <CardContent className="p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
            <span className="text-2xl">📋</span>
          </div>
          <h3 className="font-semibold text-foreground mb-2">
            Your Quote Summary
          </h3>
          <p className="text-sm text-muted-foreground">
            Select services above to see your instant pricing.
          </p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* One-Time Price Display */}
      <Card className="card-gradient overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" />
            <CardTitle className="text-lg">
              {isEstimate ? 'Estimated One-Time Price' : 'One-Time Service Price'}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-6">
          <div className="text-center mb-4">
            {isEstimate && (
              <span className="text-sm font-medium text-muted-foreground">Starting at</span>
            )}
            <div className="text-4xl font-bold price-display text-foreground">
              {formatPrice(oneTimeTotal)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {enabledServices} service{enabledServices !== 1 ? 's' : ''} • Single visit
            </p>
            {isEstimate && (
              <p className="text-xs text-muted-foreground mt-1">
                Enter your home's square footage above for exact pricing.
              </p>
            )}
          </div>
          
          {/* Service breakdown */}
          <div className="space-y-2 text-sm mb-4">
            {additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Window Cleaning
                </span>
                <span className="font-medium">{formatPrice(servicePrices.windowCleaningTotal)}</span>
              </div>
            )}
            {additionalServices.houseWash && servicePrices.houseWash > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  House Wash
                </span>
                <span className="font-medium">{formatPrice(servicePrices.houseWash)}</span>
              </div>
            )}
            {additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Gutter Cleaning
                </span>
                <span className="font-medium">{formatPrice(servicePrices.gutterCleaning)}</span>
              </div>
            )}
            {additionalServices.roofCleaning && servicePrices.roofCleaning > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Roof Cleaning
                </span>
                <span className="font-medium">{formatPrice(servicePrices.roofCleaning)}</span>
              </div>
            )}
            {additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Driveway Cleaning
                </span>
                <span className="font-medium">{formatPrice(servicePrices.drivewayCleaning)}</span>
              </div>
            )}
            {additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Pressure Washing
                </span>
                <span className="font-medium">
                  {formatPrice(servicePrices.pressureWashing)}
                </span>
              </div>
            )}
          </div>
          
          {/* Book One-Time CTA - PRIMARY with high contrast */}
          <Button 
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-auto min-h-16 py-3 text-base sm:text-lg font-bold shadow-xl group transition-all duration-200 active:scale-[0.98] whitespace-normal flex-wrap"
            onClick={onBookOneTime}
          >
            <Calendar className="w-5 h-5 sm:w-6 sm:h-6 mr-2 shrink-0" />
            <span>Book One-Time Service</span>
            <span className="font-mono bg-primary-foreground/20 px-3 py-1 rounded-lg shrink-0">
              {formatPrice(oneTimeTotal)}
            </span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </Button>
          
          {/* Trust microcopy */}
          <p className="text-center text-xs text-muted-foreground mt-2">
            No payment due until service is complete
          </p>
        </CardContent>
      </Card>
      
      {/* Plan Upsell Section */}
      <Card className="border-2 border-primary overflow-hidden">
        <div className="bg-gradient-to-r from-primary to-accent py-2 px-4">
          <div className="flex items-center justify-center gap-2 text-primary-foreground text-sm font-semibold">
            <Star className="w-4 h-4 fill-current" />
            Recommended: 4 seasonal visits (2 exterior + 2 inside & out)
            <Star className="w-4 h-4 fill-current" />
          </div>
        </div>

        <CardContent className="p-5">
          {/* Fail-closed states. A plan MUST have a real annual + monthly total
              returned from the canonical server. Never show $0 or allow selection. */}
          {!hasValidPlan && (planPhase === 'loading' || planPhase === 'idle') && (
            <div
              className="rounded-lg border border-border bg-muted/40 p-4 flex items-center gap-3"
              data-testid="plan-loading"
              aria-busy="true"
            >
              <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Calculating your Annual Maintenance Plan…</p>
            </div>
          )}
          {!hasValidPlan && (planPhase === 'unavailable' || planPhase === 'manual_review_required' || planPhase === 'missing_information' || (planPhase === 'ready' && bundles.length === 0)) && (
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3"
              data-testid="plan-unavailable"
              role="status"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Annual Maintenance Plan unavailable right now
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    We couldn’t calculate this plan yet. Your one-time quote above is still available.
                  </p>
                </div>
              </div>
              {onRetryPlan && (
                <Button variant="outline" size="sm" onClick={onRetryPlan} data-testid="plan-retry">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Try again
                </Button>
              )}
            </div>
          )}

          {/* Upgrade CTA - MOVED ABOVE PLAN CARDS */}
          <Button 
            className="w-full btn-secondary h-12 text-base mb-4"
            variant="outline"
            onClick={onUpgradeAndBook}
            disabled={!hasValidPlan}
            aria-disabled={!hasValidPlan}
            data-testid="plan-upgrade-cta"
          >
            <RefreshCw className="w-5 h-5 mr-2" />
            Upgrade & Book on Autopilot
          </Button>

          {onCustomizePlan && homeDetails && hasValidPlan && currentBundle && (
            <PlanCustomizeDrawer
              bundle={currentBundle}
              baseExteriorPrice={servicePrices.exteriorWindows}
              baseInteriorPrice={servicePrices.interiorWindows}
              servicePrices={{
                gutterCleaning: servicePrices.gutterCleaning,
                houseWash: servicePrices.houseWash,
                roofCleaning: servicePrices.roofCleaning,
              }}
              homeDetails={homeDetails}
              additionalServices={additionalServices}
              onCustomize={(customization) => onCustomizePlan(currentBundle.tier, customization)}
            >
              <Button
                className="w-full h-11 text-sm mb-4"
                variant="ghost"
                data-testid="plan-customize-cta"
              >
                <SlidersHorizontal className="w-4 h-4 mr-2" />
                Customize plan
              </Button>
            </PlanCustomizeDrawer>
          )}

          {/* See All Plans - MOVED DIRECTLY BELOW CTA. Only when a valid plan exists. */}
          {hasValidPlan && (
          <Collapsible open={showAllPlans} onOpenChange={setShowAllPlans}>
            <CollapsibleTrigger className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2 mb-4">
              <ChevronDown className={`w-4 h-4 transition-transform ${showAllPlans ? 'rotate-180' : ''}`} />
              {showAllPlans ? 'Hide plan options' : 'See all plan options'}
            </CollapsibleTrigger>
            
            <CollapsibleContent className="pb-4">
              <div className="space-y-3">
                {bundles.map((bundle) => {
                  const isSelected = selectedTier === bundle.tier;
                  const isRecommended = bundle.tier === 'best';

                  // Reconciled payment breakdown for this bundle so the row
                  // never contradicts the selected-plan summary below.
                  const bundleBreakdown = computePlanPaymentBreakdown({
                    annualTotal: bundle.annualTotal,
                    authoritativeSavings: bundle.savings,
                    comparisonTotal: oneTimeTotal * (bundle.windowFrequency || 2),
                  });
                  if (!bundleBreakdown) return null;

                  return (
                    <div
                      key={bundle.tier}
                      className={`relative p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        isSelected 
                          ? 'border-primary bg-primary/5 shadow-md' 
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() => onSelectTier(bundle.tier)}
                    >
                      {isRecommended && (
                        <Badge className="absolute -top-2 right-3 bg-primary text-primary-foreground text-xs">
                          Best Value
                        </Badge>
                      )}
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                          </div>
                          <div>
                            <span className={`font-semibold ${
                              bundle.tier === 'good' 
                                ? 'text-muted-foreground' 
                                : bundle.tier === 'better' 
                                  ? 'text-primary' 
                                  : 'text-accent'
                            }`}>
                              {bundle.name}
                            </span>
                            <span className="text-sm text-muted-foreground ml-2">
                              • {bundle.label}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatPriceCents(bundleBreakdown.depositAmount)} today</div>
                          <div className="text-xs text-muted-foreground">
                            then {formatPriceCents(bundleBreakdown.monthlyPayment)} × {bundleBreakdown.regularPaymentCount} mo
                            {bundleBreakdown.hasFinalAdjustment && (
                              <> + {formatPriceCents(bundleBreakdown.finalPayment)} final</>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">plus applicable tax</div>
                          {bundleBreakdown.savings > 0 && (
                            <div className="text-xs text-success">
                              Save {formatPrice(bundleBreakdown.savings)}/yr
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
             </CollapsibleContent>
           </Collapsible>
           )}

           {/* Selected Plan Summary - Live updates. Only when a real plan exists. */}
           {hasValidPlan && currentBundle && (
           <div className="p-4 rounded-lg bg-primary/5 border border-primary/20" data-testid="plan-summary">
            <div className="flex items-center justify-between mb-2">
              <Badge className={`${
                currentBundle?.tier === 'good' 
                  ? 'tier-badge-good' 
                  : currentBundle?.tier === 'better' 
                    ? 'tier-badge-better' 
                    : 'tier-badge-best'
              }`}>
                {currentBundle?.name || 'Better'} Plan
              </Badge>
              <span className="text-sm font-medium text-primary" data-testid="plan-annual-total">
                {formatPrice(annualTotal)} total / year
              </span>
            </div>

            {/* Prominent annual savings. */}
            {annualSavings > 0 && (
              <div
                className="savings-badge mb-3 inline-flex"
                data-testid="plan-annual-savings"
              >
                Save {formatPrice(annualSavings)}/yr vs equivalent one-time visits
              </div>
            )}

            {/* Exact payment schedule — deposit due today + 11 monthly payments
                that reconcile to the authoritative annual total. */}
            <div className="rounded-md border border-primary/20 bg-background/60 p-3 mb-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Due today (plus applicable tax)</span>
                <span
                  className="text-2xl font-bold price-display text-foreground"
                  data-testid="plan-due-today"
                >
                  {formatPriceCents(deposit)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">
                  {hasFinalAdjustment
                    ? `Then ${regularPaymentCount} monthly payments of`
                    : `Then ${remainingPayments} monthly payments of`}
                </span>
                <span
                  className="text-lg font-semibold text-foreground"
                  data-testid="plan-monthly-payment"
                >
                  {formatPriceCents(monthlyPayment)}
                </span>
              </div>
              {hasFinalAdjustment && (
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">
                    Final monthly payment of
                  </span>
                  <span
                    className="text-lg font-semibold text-foreground"
                    data-testid="plan-final-payment"
                  >
                    {formatPriceCents(finalPayment)}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground" data-testid="plan-tax-note">
                All amounts shown plus applicable tax.
              </p>
              <div className="flex items-baseline justify-between pt-2 border-t border-border">
                <span className="text-sm text-muted-foreground">Annual plan total</span>
                <span className="text-sm font-semibold text-foreground">
                  {formatPriceCents(annualTotal)}
                </span>
              </div>
              <div className="flex items-start gap-2 pt-1">
                <CreditCard className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Exactly 20% due today. Remaining balance split across {remainingPayments} monthly installments
                  {hasFinalAdjustment && ' (final installment adjusted to the cent)'} — cancel or change anytime before the next visit.
                </p>
              </div>
            </div>
            
            {/* What's included */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What you get
              </h4>
              {currentBundle?.features.slice(0, 3).map((feature, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>{feature}</span>
                </div>
              ))}
              {currentBundle?.additionalServicesIncluded.slice(0, 2).map((service, idx) => (
                <div key={`add-${idx}`} className="flex items-start gap-2 text-sm">
                  <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>{service}</span>
                </div>
              ))}
            </div>
          </div>
          )}
          
          {/* Social proof */}
          <p className="text-center text-xs text-muted-foreground mt-4">
            Most homeowners choose this option to keep things clean year-round.
          </p>
        </CardContent>
      </Card>
      
      {/* Disclaimer */}
      <p className="text-center text-xs text-muted-foreground">
        No payment due today. Final details confirmed after booking.
      </p>
    </div>
  );
}
