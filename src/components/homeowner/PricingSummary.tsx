import { useState } from 'react';
import { Sparkles, Check, Download, CalendarCheck, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { RecurringServiceRequestFlow } from '@/components/booking/RecurringServiceRequestFlow';
import type { ServicePrices, BundleTier, HomeDetails, AdditionalServices } from '@/types/homeowner';
import type { CustomerInfo } from '@/components/booking/CustomerInfoForm';

interface PricingSummaryProps {
  servicePrices: ServicePrices;
  selectedBundle: BundleTier | null;
  homeDetails: HomeDetails;
  additionalServices: AdditionalServices;
  onDownloadPDF: () => void;
  onGetStarted: () => void;
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

export function PricingSummary({ 
  servicePrices, 
  selectedBundle, 
  homeDetails,
  additionalServices,
  onDownloadPDF,
  onGetStarted,
  prefillCustomerInfo,
}: PricingSummaryProps) {
  const [showRequestFlow, setShowRequestFlow] = useState(false);

  if (!selectedBundle) return null;

  // Show recurring service request flow
  if (showRequestFlow) {
    return (
      <RecurringServiceRequestFlow
        servicePrices={servicePrices}
        additionalServices={additionalServices}
        homeDetails={homeDetails}
        selectedBundle={selectedBundle}
        onCancel={() => setShowRequestFlow(false)}
        prefillCustomerInfo={prefillCustomerInfo}
      />
    );
  }
  
  return (
    <Card className="card-summary">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="section-icon">
            <FileText className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">Your Custom Quote</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {homeDetails.squareFootage.toLocaleString()} sq ft • {homeDetails.stories} {homeDetails.stories === 1 ? 'story' : 'stories'}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Selected Plan */}
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
          <div className="text-3xl price-display text-foreground">
            {formatPrice(selectedBundle.monthlyPayment)}
            <span className="text-base font-normal text-muted-foreground">/month</span>
          </div>
        </div>
        
        {/* Service Breakdown */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Per-Service Pricing
          </h4>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Window Cleaning (per visit)</span>
              <span className="font-medium">{formatPrice(servicePrices.windowCleaningTotal)}</span>
            </div>
            
            {servicePrices.exteriorWindows > 0 && (
              <div className="flex justify-between text-muted-foreground pl-4">
                <span>• Exterior windows</span>
                <span>{formatPrice(servicePrices.exteriorWindows)}</span>
              </div>
            )}
            
            {servicePrices.interiorWindows > 0 && (
              <div className="flex justify-between text-muted-foreground pl-4">
                <span>• Interior windows</span>
                <span>{formatPrice(servicePrices.interiorWindows)}</span>
              </div>
            )}
            
            {servicePrices.hardWaterAddon > 0 && (
              <div className="flex justify-between text-muted-foreground pl-4">
                <span>• Hard water treatment</span>
                <span>+{formatPrice(servicePrices.hardWaterAddon)}</span>
              </div>
            )}
            
            {servicePrices.frenchPanesAddon > 0 && (
              <div className="flex justify-between text-muted-foreground pl-4">
                <span>• French panes</span>
                <span>+{formatPrice(servicePrices.frenchPanesAddon)}</span>
              </div>
            )}
            
            {servicePrices.solarScreensAddon > 0 && (
              <div className="flex justify-between text-muted-foreground pl-4">
                <span>• Solar screen removal</span>
                <span>+{formatPrice(servicePrices.solarScreensAddon)}</span>
              </div>
            )}
            
            {servicePrices.ladderWorkAddon > 0 && (
              <div className="flex justify-between text-muted-foreground pl-4">
                <span>• Interior ladder work</span>
                <span>+{formatPrice(servicePrices.ladderWorkAddon)}</span>
              </div>
            )}
            
            {servicePrices.sunroomAddon > 0 && (
              <div className="flex justify-between text-muted-foreground pl-4">
                <span>• Sunroom</span>
                <span>+{formatPrice(servicePrices.sunroomAddon)}</span>
              </div>
            )}
            
            {servicePrices.drivewayCleaning > 0 && (
              <div className="flex justify-between">
                <span>Driveway Cleaning</span>
                <span className="font-medium">{formatPrice(servicePrices.drivewayCleaning)}</span>
              </div>
            )}
            
            {servicePrices.pressureWashing > 0 && (
              <div className="flex justify-between">
                <span>Pressure Washing</span>
                <span className="font-medium">{formatPrice(servicePrices.pressureWashing)}</span>
              </div>
            )}
            
            {servicePrices.gutterCleaning > 0 && (
              <div className="flex justify-between">
                <span>Gutter Cleaning</span>
                <span className="font-medium">{formatPrice(servicePrices.gutterCleaning)}</span>
              </div>
            )}
            
            {servicePrices.houseWash > 0 && (
              <div className="flex justify-between">
                <span>House Wash</span>
                <span className="font-medium">{formatPrice(servicePrices.houseWash)}</span>
              </div>
            )}
            
            {servicePrices.roofCleaning > 0 && (
              <div className="flex justify-between">
                <span>Roof Cleaning</span>
                <span className="font-medium">{formatPrice(servicePrices.roofCleaning)}</span>
              </div>
            )}
          </div>
        </div>
        
        <Separator />
        
        {/* Annual Summary */}
        <div className="space-y-3">
          <div className="flex justify-between text-lg font-semibold">
            <span>Annual Total</span>
            <span className="price-display text-primary">
              {formatPrice(selectedBundle.annualTotal)}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Monthly Payment</span>
            <span className="font-medium">{formatPrice(selectedBundle.monthlyPayment)}/mo</span>
          </div>
          
          {selectedBundle.savings > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Bundle Savings</span>
              <span className="savings-badge">
                Save {formatPrice(selectedBundle.savings)}
              </span>
            </div>
          )}
        </div>
        
        {/* Disclaimer */}
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Prices are based on the information provided and represent our best estimate. 
            Final pricing may adjust if on-site conditions differ.
          </p>
        </div>
        
        {/* Actions */}
        <div className="space-y-3 pt-2">
          <Button 
            className="w-full btn-primary h-12 text-base"
            onClick={() => setShowRequestFlow(true)}
          >
            <CalendarCheck className="w-5 h-5 mr-2" />
            Get Started with This Plan
          </Button>
          
          <Button 
            variant="outline" 
            className="w-full btn-secondary"
            onClick={onDownloadPDF}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Proposal PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
