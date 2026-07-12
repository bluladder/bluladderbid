import { CreditCard, Calendar, DollarSign, ArrowRight, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { ServicePlanPayment, ServicePlanService } from '@/types/servicePlanBuilder';

interface PlanPaymentSummaryProps {
  payment: ServicePlanPayment;
  services: ServicePlanService[];
  isValid: boolean;
  isSaving?: boolean;
  onSubmit: () => void;
  showSubmitButton?: boolean;
  selectedTierName?: string;
  pricingReady?: boolean;
  pricingLoading?: boolean;
  pricingUnavailable?: boolean;
}

export function PlanPaymentSummary({ 
  payment, 
  services, 
  isValid, 
  isSaving, 
  onSubmit,
  showSubmitButton = true,
  selectedTierName,
  pricingReady = true,
  pricingLoading,
  pricingUnavailable,
}: PlanPaymentSummaryProps) {
  const enabledServices = services.filter(s => s.enabled);
  // Never show a dollar amount that isn't a current, firm server price.
  const money = (v: number) => (pricingReady ? `$${v}` : '—');
  
  if (enabledServices.length === 0) {
    return (
      <Card className="card-elevated sticky top-4">
        <CardHeader className="pb-4">
          <div className="section-header">
            <div className="section-icon">
              <DollarSign className="w-5 h-5 text-primary-foreground" />
            </div>
            <CardTitle className="text-xl">Your Plan</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Select services to build your plan</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="card-elevated sticky top-4">
      <CardHeader className="pb-4">
        <div className="section-header">
          <div className="section-icon">
            <DollarSign className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">
              {selectedTierName ? `${selectedTierName} Plan` : 'Payment Summary'}
            </CardTitle>
            {selectedTierName && (
              <p className="text-xs text-muted-foreground mt-0.5">
                12-month service agreement
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selected Services */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Included Services
          </h4>
          <ul className="space-y-2">
            {enabledServices.map((service) => (
              <li key={service.id} className="flex justify-between items-center text-sm">
                <span className="text-foreground">
                  {service.name}
                  <span className="text-muted-foreground ml-1">
                    ({service.frequency}x/yr)
                  </span>
                </span>
                <span className="font-medium text-foreground">
                  {money(service.annualTotal)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {!pricingReady && (
          <p className="text-xs text-center text-muted-foreground">
            {pricingLoading
              ? 'Calculating your plan price…'
              : pricingUnavailable
                ? 'Pricing is temporarily unavailable. You can request a quote and our team will follow up.'
                : 'Enter your home details to see your plan price.'}
          </p>
        )}
        
        <Separator />
        
        {/* Annual Total */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Annual Total</span>
          <span className="text-lg font-semibold text-foreground">
            {money(payment.annualTotal)}
          </span>
        </div>
        
        <Separator />
        
        {/* Payment Breakdown - Clearer labels */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            How It Works
          </h4>
          
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
            {/* Step 1 - Deposit */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                20%
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Deposit due today</p>
                <p className="text-2xl font-bold text-primary">{money(payment.downPayment)}</p>
              </div>
            </div>
            
            {/* Step 2 - Monthly */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-background/50">
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <div className="text-sm">
                <span className="text-muted-foreground">Then </span>
                <span className="font-bold text-foreground">{money(payment.monthlyPayment)}/mo</span>
                <span className="text-muted-foreground"> × 11 months</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CreditCard className="w-4 h-4" />
            <span>Automatic monthly billing • Cancel anytime</span>
          </div>
        </div>
        
        <Separator />
        
        {/* Submit Button - only when visible */}
        {showSubmitButton && (
          <>
            <Button 
              className="w-full btn-primary h-12 text-base"
              disabled={!isValid || isSaving}
              onClick={onSubmit}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving Quote...
                </>
              ) : (
                <>
                  Save & Get Quote Link
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
            
            {!isValid && (
              <p className="text-xs text-center text-muted-foreground">
                Complete home details and customer info to continue
              </p>
            )}
          </>
        )}
        
        <p className="text-xs text-center text-muted-foreground">
          Prices are estimates based on the information provided. 
          Final pricing may adjust if on-site conditions differ.
        </p>
      </CardContent>
    </Card>
  );
}
