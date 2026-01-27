import { Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlanBuilderHeader } from '@/components/plan-builder/PlanBuilderHeader';
import { PlanHomeDetailsForm } from '@/components/plan-builder/PlanHomeDetailsForm';
import { ServiceSelectionCard } from '@/components/plan-builder/ServiceSelectionCard';
import { PlanPaymentSummary } from '@/components/plan-builder/PlanPaymentSummary';
import { PlanCustomerForm } from '@/components/plan-builder/PlanCustomerForm';
import { useServicePlanBuilder } from '@/hooks/useServicePlanBuilder';
import { toast } from 'sonner';
import type { PlanBuilderServiceId } from '@/types/servicePlanBuilder';

export default function PlanBuilder() {
  const {
    homeDetails,
    customer,
    services,
    payment,
    updateHomeDetails,
    updateCustomer,
    toggleService,
    updateFrequency,
    isValid,
    hasSelectedServices,
    isLoading,
  } = useServicePlanBuilder();
  
  const enabledServiceIds = services.filter(s => s.enabled).map(s => s.id);
  
  const handleSubmit = () => {
    if (!isValid) {
      toast.error('Please complete all required fields');
      return;
    }
    
    // TODO: Submit the plan - create quote/booking
    toast.success('Plan submitted! We\'ll be in touch shortly.');
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading pricing...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
        <PlanBuilderHeader />
        
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Home Details */}
            <PlanHomeDetailsForm
              homeDetails={homeDetails}
              onChange={updateHomeDetails}
              enabledServices={enabledServiceIds}
            />
            
            {/* Step 2: Service Selection */}
            <Card className="card-elevated">
              <CardHeader className="pb-4">
                <div className="section-header">
                  <div className="section-icon">
                    <Package className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Build Your Bundle</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      Select services and choose how often you want them
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {homeDetails.squareFootage === 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700 dark:text-amber-400">
                    Enter your home's square footage above to see pricing
                  </div>
                )}
                
                <div className="grid gap-4 md:grid-cols-2">
                  {services.map((service) => (
                    <ServiceSelectionCard
                      key={service.id}
                      service={service}
                      onToggle={toggleService}
                      onFrequencyChange={updateFrequency}
                      hasHomeDetails={homeDetails.squareFootage > 0}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
            
            {/* Step 3: Customer Info - only show after services selected */}
            {hasSelectedServices && (
              <PlanCustomerForm
                customer={customer}
                onChange={updateCustomer}
              />
            )}
          </div>
          
          {/* Sidebar - Payment Summary */}
          <div className="lg:col-span-1">
            <PlanPaymentSummary
              payment={payment}
              services={services}
              isValid={isValid}
              onSubmit={handleSubmit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
