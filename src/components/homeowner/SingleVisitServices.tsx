import { useState } from 'react';
import { ArrowLeft, Calendar, Check, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { ServicePrices, AdditionalServices } from '@/types/homeowner';

interface SingleVisitServicesProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  onBack: () => void;
  onContinue: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function SingleVisitServices({ 
  servicePrices, 
  additionalServices,
  onBack,
  onContinue,
}: SingleVisitServicesProps) {
  const hasServices = servicePrices.grandTotal > 0;
  
  // Count enabled services
  const enabledServices = [
    servicePrices.windowCleaningTotal > 0,
    additionalServices.houseWash,
    additionalServices.gutterCleaning,
    additionalServices.roofCleaning,
    additionalServices.pressureWashing.enabled,
  ].filter(Boolean).length;

  return (
    <Card className="card-summary">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 -ml-2">
            <ArrowLeft className="w-4 h-4" />
            Change Service Type
          </Button>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="section-icon bg-accent">
            <Sparkles className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">Single Visit Quote</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              One-time service • No commitment
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Total Price Display */}
        <div className="p-4 rounded-lg bg-accent/10 border border-accent/30 text-center">
          <div className="text-4xl font-bold price-display text-foreground">
            {hasServices ? formatPrice(servicePrices.grandTotal) : '$0'}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {hasServices 
              ? `${enabledServices} service${enabledServices !== 1 ? 's' : ''} • Single appointment`
              : 'Configure services above to see pricing'
            }
          </div>
        </div>
        
        {/* Service breakdown */}
        {hasServices && (
          <div className="space-y-3">
            <h4 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
              Services Included
            </h4>
            
            <div className="space-y-2 text-sm">
              {servicePrices.windowCleaningTotal > 0 && (
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
        )}
        
        <Separator />
        
        {/* Disclaimer */}
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Prices are based on the information provided. Final pricing may adjust if on-site conditions differ.
          </p>
        </div>
        
        {/* CTA */}
        <Button 
          className="w-full btn-primary h-12 text-base"
          onClick={onContinue}
          disabled={!hasServices}
        >
          <Calendar className="w-5 h-5 mr-2" />
          Book My Appointment
        </Button>
        
        <p className="text-center text-xs text-muted-foreground">
          No payment due today. Final details confirmed after booking.
        </p>
      </CardContent>
    </Card>
  );
}
