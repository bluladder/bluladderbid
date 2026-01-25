import { Calendar, Download, Check, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { ServicePrices, AdditionalServices, HomeDetails } from '@/types/homeowner';

interface OneTimeSummaryProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  homeDetails: HomeDetails;
  onDownloadPDF: () => void;
  onGetStarted: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function OneTimeSummary({ 
  servicePrices, 
  additionalServices,
  homeDetails,
  onDownloadPDF,
  onGetStarted 
}: OneTimeSummaryProps) {
  const hasServices = servicePrices.grandTotal > 0;
  
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
        {/* Total Price */}
        <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
          <div className="flex items-center justify-between mb-2">
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-accent/20 text-accent-foreground">
              One-Time
            </span>
            <span className="text-sm font-medium text-accent">Single Appointment</span>
          </div>
          <div className="text-3xl price-display text-foreground">
            {formatPrice(servicePrices.grandTotal)}
            <span className="text-base font-normal text-muted-foreground"> total</span>
          </div>
        </div>
        
        {/* Service Breakdown */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Services Included
          </h4>
          
          <div className="space-y-2 text-sm">
            {servicePrices.windowCleaningTotal > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-success" />
                    Window Cleaning
                  </span>
                  <span className="font-medium">{formatPrice(servicePrices.windowCleaningTotal)}</span>
                </div>
                
                {servicePrices.exteriorWindows > 0 && (
                  <div className="flex justify-between text-muted-foreground pl-6">
                    <span>• Exterior windows</span>
                    <span>{formatPrice(servicePrices.exteriorWindows)}</span>
                  </div>
                )}
                
                {servicePrices.interiorWindows > 0 && (
                  <div className="flex justify-between text-muted-foreground pl-6">
                    <span>• Interior windows</span>
                    <span>{formatPrice(servicePrices.interiorWindows)}</span>
                  </div>
                )}
                
                {servicePrices.hardWaterAddon > 0 && (
                  <div className="flex justify-between text-muted-foreground pl-6">
                    <span>• Hard water treatment</span>
                    <span>+{formatPrice(servicePrices.hardWaterAddon)}</span>
                  </div>
                )}
                
                {servicePrices.frenchPanesAddon > 0 && (
                  <div className="flex justify-between text-muted-foreground pl-6">
                    <span>• French panes</span>
                    <span>+{formatPrice(servicePrices.frenchPanesAddon)}</span>
                  </div>
                )}
                
                {servicePrices.solarScreensAddon > 0 && (
                  <div className="flex justify-between text-muted-foreground pl-6">
                    <span>• Solar screen removal</span>
                    <span>+{formatPrice(servicePrices.solarScreensAddon)}</span>
                  </div>
                )}
              </>
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
            
            {additionalServices.pressureWashing.enabled && (servicePrices.pressureWashing + servicePrices.pressureWashingAddons) > 0 && (
              <div className="flex justify-between">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-success" />
                  Pressure Washing
                </span>
                <span className="font-medium">
                  {formatPrice(servicePrices.pressureWashing + servicePrices.pressureWashingAddons)}
                </span>
              </div>
            )}
          </div>
        </div>
        
        <Separator />
        
        {/* Summary */}
        <div className="space-y-3">
          <div className="flex justify-between text-lg font-semibold">
            <span>Total Due</span>
            <span className="price-display text-accent">
              {formatPrice(servicePrices.grandTotal)}
            </span>
          </div>
          
          <p className="text-xs text-muted-foreground">
            All services completed in a single appointment
          </p>
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
            onClick={onGetStarted}
            disabled={!hasServices}
          >
            <Calendar className="w-5 h-5 mr-2" />
            Schedule Appointment
          </Button>
          
          <Button 
            variant="outline" 
            className="w-full btn-secondary"
            onClick={onDownloadPDF}
            disabled={!hasServices}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Quote PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
