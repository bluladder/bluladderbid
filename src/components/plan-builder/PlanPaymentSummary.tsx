import { CreditCard, Calendar, DollarSign, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { ServicePlanPayment, ServicePlanService } from '@/types/servicePlanBuilder';

interface PlanPaymentSummaryProps {
  payment: ServicePlanPayment;
  services: ServicePlanService[];
  isValid: boolean;
  onSubmit: () => void;
}

export function PlanPaymentSummary({ payment, services, isValid, onSubmit }: PlanPaymentSummaryProps) {
  const enabledServices = services.filter(s => s.enabled);
  
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
          <CardTitle className="text-xl">Payment Summary</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selected Services */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Selected Services
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
                  ${service.annualTotal}
                </span>
              </li>
            ))}
          </ul>
        </div>
        
        <Separator />
        
        {/* Annual Total */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Annual Total</span>
          <span className="text-lg font-semibold text-foreground">
            ${payment.annualTotal}
          </span>
        </div>
        
        <Separator />
        
        {/* Payment Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            12-Month Payment Plan
          </h4>
          
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Due today (20%)</p>
                <p className="text-2xl font-bold text-primary">${payment.downPayment}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <ArrowRight className="w-4 h-4" />
              <span>Then 11 monthly payments of</span>
              <span className="font-semibold text-foreground">${payment.monthlyPayment}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CreditCard className="w-4 h-4" />
            <span>Automatic monthly billing</span>
          </div>
        </div>
        
        <Separator />
        
        {/* Submit Button */}
        <Button 
          className="w-full btn-primary h-12 text-base"
          disabled={!isValid}
          onClick={onSubmit}
        >
          Continue to Review
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        
        {!isValid && (
          <p className="text-xs text-center text-muted-foreground">
            Complete home details and customer info to continue
          </p>
        )}
        
        <p className="text-xs text-center text-muted-foreground">
          Prices are estimates based on the information provided. 
          Final pricing may adjust if on-site conditions differ.
        </p>
      </CardContent>
    </Card>
  );
}
