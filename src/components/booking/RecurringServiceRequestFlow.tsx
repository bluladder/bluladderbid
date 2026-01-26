import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Check, User, CheckCircle, CalendarCheck, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerInfoForm, type CustomerInfo } from './CustomerInfoForm';
import type { ServicePrices, AdditionalServices, HomeDetails, BundleTier } from '@/types/homeowner';

type RequestStep = 'info';

interface RecurringServiceRequestFlowProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  homeDetails: HomeDetails;
  selectedBundle: BundleTier;
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

export function RecurringServiceRequestFlow({ 
  servicePrices, 
  additionalServices, 
  homeDetails,
  selectedBundle,
  onCancel,
  prefillCustomerInfo,
}: RecurringServiceRequestFlowProps) {
  const [step, setStep] = useState<RequestStep>('info');
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(prefillCustomerInfo || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Build services array for the request with frequency info
  const buildServicesArray = () => {
    const services: Array<{ name: string; price: number; frequency: string }> = [];
    
    // Window cleaning uses windowFrequency from the selected bundle
    if (servicePrices.windowCleaningTotal > 0) {
      services.push({ 
        name: 'Window Cleaning', 
        price: servicePrices.windowCleaningTotal,
        frequency: `${selectedBundle.windowFrequency}x per year`,
      });
    }
    
    // Gutter cleaning frequency varies by tier (use additionalServicesFrequency pattern)
    // For simplicity, we derive from tier: good=1x, better=1x, best=2x
    const additionalFreq = selectedBundle.tier === 'best' ? 2 : 1;
    
    if (servicePrices.gutterCleaning > 0) {
      services.push({ 
        name: 'Gutter Cleaning', 
        price: servicePrices.gutterCleaning,
        frequency: `${additionalFreq}x per year`,
      });
    }
    if (servicePrices.houseWash > 0) {
      services.push({ 
        name: 'House Wash', 
        price: servicePrices.houseWash,
        frequency: '1x per year',
      });
    }
    if (servicePrices.roofCleaning > 0) {
      services.push({ 
        name: 'Roof Cleaning', 
        price: servicePrices.roofCleaning,
        frequency: '1x per year',
      });
    }
    if (servicePrices.drivewayCleaning > 0) {
      services.push({ 
        name: 'Driveway Cleaning', 
        price: servicePrices.drivewayCleaning,
        frequency: '1x per year',
      });
    }
    if (servicePrices.pressureWashing > 0) {
      services.push({ 
        name: 'Pressure Washing', 
        price: servicePrices.pressureWashing,
        frequency: '1x per year',
      });
    }
    
    return services;
  };

  const handleCustomerInfoSubmit = async (info: CustomerInfo) => {
    setCustomerInfo(info);
    // Auto-submit the request immediately
    await handleSubmitRequest(info);
  };

  const handleSubmitRequest = async (info: CustomerInfo) => {
    if (!info) {
      toast.error('Please provide your contact information');
      return;
    }

    setIsSubmitting(true);

    try {
      const services = buildServicesArray();
      
      const response = await supabase.functions.invoke('jobber-create-service-request', {
        body: {
          customer: {
            email: info.email,
            firstName: info.firstName,
            lastName: info.lastName,
            phone: info.phone,
            address: info.address,
          },
          selectedPlan: {
            tier: selectedBundle.tier,
            name: selectedBundle.name,
            label: selectedBundle.label,
            monthlyPayment: selectedBundle.monthlyPayment,
            annualTotal: selectedBundle.annualTotal,
          },
          services,
          homeDetails,
          notes: info.notes,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to submit request');
      }

      setIsSuccess(true);
      toast.success('Your service plan request has been submitted!');
    } catch (error) {
      console.error('Submit request error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
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

          <div className="pt-4 space-y-3">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">Selected Plan:</span> {selectedBundle.name} ({selectedBundle.label})
            </div>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">Monthly Payment:</span> {formatPrice(selectedBundle.monthlyPayment)}/month
            </div>
          </div>

          <Button onClick={onCancel} className="mt-6">
            Return to Quote
          </Button>
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
            {formatPrice(selectedBundle.monthlyPayment)}
            <span className="text-base font-normal text-muted-foreground">/month</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {formatPrice(selectedBundle.annualTotal)} annually
            {selectedBundle.savings > 0 && ` • Save ${formatPrice(selectedBundle.savings)}`}
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
