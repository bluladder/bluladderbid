import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Check, Calendar, User, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TimeSlotPicker, type TimeSlot } from './TimeSlotPicker';
import { CustomerInfoForm, type CustomerInfo } from './CustomerInfoForm';
import { BookingConfirmation } from './BookingConfirmation';
import type { ServicePrices, AdditionalServices, HomeDetails } from '@/types/homeowner';
import type { ValidatedDiscount } from '@/hooks/useDiscountCodes';

type BookingStep = 'time' | 'info' | 'confirmation';

interface BookingFlowProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  homeDetails: HomeDetails;
  appliedDiscount?: ValidatedDiscount | null;
  discountAmount?: number;
  onCancel: () => void;
  prefillCustomerInfo?: CustomerInfo | null;
}

interface BookingResult {
  referenceNumber: string;
  jobNumber?: number;
  scheduledStart: string;
  scheduledEnd: string;
  technicianName: string;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function BookingFlow({ 
  servicePrices, 
  additionalServices, 
  homeDetails,
  appliedDiscount,
  discountAmount = 0,
  onCancel,
  prefillCustomerInfo,
}: BookingFlowProps) {
  const [step, setStep] = useState<BookingStep>('time');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(prefillCustomerInfo || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);

  // Build services array for availability check and booking
  const buildServicesArray = () => {
    const services: Array<{ service: string; name: string; price: number; description: string }> = [];
    
    // Helper to format home details for descriptions
    const sqft = homeDetails.squareFootage?.toLocaleString() || 'N/A';
    const stories = homeDetails.stories || 1;
    const storyLabel = stories === 1 ? '1 story' : `${stories} stories`;
    
    if (servicePrices.windowCleaningTotal > 0) {
      const windowType = homeDetails.windowCleaningType === 'both' ? 'Interior & Exterior' : 'Exterior Only';
      const condition = homeDetails.condition === 'heavy' ? 'Heavy Cleaning' : 'Maintenance Clean';
      
      if (servicePrices.exteriorWindows > 0) {
        services.push({ 
          service: 'windows_exterior', 
          name: 'Window Cleaning (Exterior)', 
          price: servicePrices.exteriorWindows,
          description: `${sqft} sq ft, ${storyLabel}, ${condition}`,
        });
      }
      if (servicePrices.interiorWindows > 0) {
        services.push({ 
          service: 'windows_interior', 
          name: 'Window Cleaning (Interior)', 
          price: servicePrices.interiorWindows,
          description: `${sqft} sq ft, ${storyLabel}`,
        });
      }
      if (servicePrices.hardWaterAddon > 0) {
        const percent = homeDetails.hardWaterPercent || 25;
        services.push({ 
          service: 'windows_exterior', 
          name: 'Hard Water Treatment', 
          price: servicePrices.hardWaterAddon,
          description: `${percent}% of windows affected`,
        });
      }
      if (servicePrices.frenchPanesAddon > 0) {
        const percent = homeDetails.frenchPanesPercent || 25;
        services.push({ 
          service: 'windows_exterior', 
          name: 'French Panes', 
          price: servicePrices.frenchPanesAddon,
          description: `${percent}% of windows`,
        });
      }
      if (servicePrices.solarScreensAddon > 0) {
        const percent = homeDetails.solarScreensPercent || 25;
        services.push({ 
          service: 'windows_exterior', 
          name: 'Solar Screen Removal', 
          price: servicePrices.solarScreensAddon,
          description: `${percent}% of windows`,
        });
      }
      if (servicePrices.ladderWorkAddon > 0) {
        services.push({ 
          service: 'windows_exterior', 
          name: 'Ladder Work', 
          price: servicePrices.ladderWorkAddon,
          description: `${homeDetails.ladderWorkCount || '1-3'} windows requiring ladder`,
        });
      }
      if (servicePrices.sunroomAddon > 0) {
        services.push({ 
          service: 'windows_exterior', 
          name: 'Sunroom Cleaning', 
          price: servicePrices.sunroomAddon,
          description: `${homeDetails.sunroom} sunroom`,
        });
      }
    }
    
    if (additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0) {
      services.push({ 
        service: 'gutters', 
        name: 'Gutter Cleaning', 
        price: servicePrices.gutterCleaning,
        description: `${sqft} sq ft home, ${storyLabel}`,
      });
    }
    
    if (additionalServices.houseWash && servicePrices.houseWash > 0) {
      services.push({ 
        service: 'house_wash', 
        name: 'House Wash', 
        price: servicePrices.houseWash,
        description: `${sqft} sq ft, ${storyLabel}`,
      });
    }
    
    if (additionalServices.roofCleaning && servicePrices.roofCleaning > 0) {
      const roofType = additionalServices.roofType || 'asphalt';
      const severity = additionalServices.roofSeverity || 'light';
      services.push({ 
        service: 'roof_wash', 
        name: 'Roof Cleaning', 
        price: servicePrices.roofCleaning,
        description: `${roofType} roof, ${severity} cleaning, ${sqft} sq ft`,
      });
    }
    
    if (additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0) {
      services.push({ 
        service: 'driveway', 
        name: 'Driveway Cleaning', 
        price: servicePrices.drivewayCleaning,
        description: `${additionalServices.drivewayCleaning.sqft} sq ft (${additionalServices.drivewayCleaning.surfaceType})`,
      });
    }
    
    if (additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0) {
      const areas: string[] = [];
      if (additionalServices.pressureWashing.frontPorch.enabled) areas.push('front porch');
      if (additionalServices.pressureWashing.backPatio.enabled) areas.push('back patio');
      if (additionalServices.pressureWashing.poolDeck.enabled) areas.push('pool deck');
      if (additionalServices.pressureWashing.walkways.enabled) areas.push('walkways');
      
      services.push({ 
        service: 'pressure_wash_addon', 
        name: 'Pressure Washing', 
        price: servicePrices.pressureWashing,
        description: areas.join(', '),
      });
    }
    
    return services;
  };

  const services = buildServicesArray();
  const subtotal = servicePrices.grandTotal;
  const finalTotal = subtotal - discountAmount;

  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
  };

  const handleCustomerSubmit = async (info: CustomerInfo) => {
    if (!selectedSlot) {
      toast.error('Please select a time slot first');
      return;
    }

    setIsSubmitting(true);
    setCustomerInfo(info);

    try {
      const { data, error } = await supabase.functions.invoke('jobber-create-booking', {
        body: {
          customer: {
            email: info.email,
            firstName: info.firstName,
            lastName: info.lastName,
            phone: info.phone,
            address: info.address,
          },
          technicianId: selectedSlot.technicianId,
          scheduledStart: selectedSlot.startTime,
          scheduledEnd: selectedSlot.endTime,
          durationMinutes: selectedSlot.durationMinutes,
          services: services.map(s => ({ 
            name: s.name, 
            price: s.price,
            description: s.description,
          })),
          homeDetails,
          subtotal,
          discountAmount,
          total: finalTotal,
          discountCode: appliedDiscount?.code,
          notes: info.notes,
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setBookingResult({
        referenceNumber: data.referenceNumber,
        jobNumber: data.jobNumber,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        technicianName: data.technicianName,
      });
      
      setStep('confirmation');
      toast.success('Booking confirmed!');
    } catch (err) {
      console.error('Booking failed:', err);
      toast.error('Failed to create booking. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoHome = () => {
    window.location.href = '/';
  };

  const stepProgress = step === 'time' ? 33 : step === 'info' ? 66 : 100;

  // Confirmation step
  if (step === 'confirmation' && bookingResult && customerInfo) {
    return (
      <div className="space-y-6">
        <BookingConfirmation
          referenceNumber={bookingResult.referenceNumber}
          jobNumber={bookingResult.jobNumber}
          scheduledStart={bookingResult.scheduledStart}
          scheduledEnd={bookingResult.scheduledEnd}
          technicianName={bookingResult.technicianName}
          customer={customerInfo}
          services={services.map(s => ({ name: s.name, price: s.price }))}
          subtotal={subtotal}
          discountAmount={discountAmount}
          discountCode={appliedDiscount?.code}
          total={finalTotal}
          onGoHome={handleGoHome}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className={step === 'time' ? 'text-primary font-medium' : 'text-muted-foreground'}>
                1. Pick Time
              </span>
              <span className={step === 'info' ? 'text-primary font-medium' : 'text-muted-foreground'}>
                2. Your Info
              </span>
              <span className={step === 'confirmation' ? 'text-primary font-medium' : 'text-muted-foreground'}>
                3. Confirmed
              </span>
            </div>
            <Progress value={stepProgress} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Quote Summary */}
      <Card className="bg-muted/50">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Your Quote</p>
              <p className="text-2xl font-bold">
                {appliedDiscount && discountAmount > 0 ? (
                  <>
                    <span className="line-through text-muted-foreground text-lg mr-2">
                      {formatPrice(subtotal)}
                    </span>
                    {formatPrice(finalTotal)}
                  </>
                ) : (
                  formatPrice(subtotal)
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{services.length} services</p>
              {appliedDiscount && (
                <p className="text-sm text-green-600">
                  {appliedDiscount.code} applied
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step Content */}
      {step === 'time' && (
        <>
          <TimeSlotPicker
            services={services.map(s => ({ service: s.service, price: s.price }))}
            onSelectSlot={handleSelectSlot}
            selectedSlot={selectedSlot}
          />
          
          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel} className="flex-1">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Quote
            </Button>
            <Button 
              onClick={() => setStep('info')} 
              disabled={!selectedSlot}
              className="flex-1"
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </>
      )}

      {step === 'info' && (
        <>
          <CustomerInfoForm
            onSubmit={handleCustomerSubmit}
            initialData={customerInfo || prefillCustomerInfo || undefined}
            isSubmitting={isSubmitting}
          />
          
          <Button variant="outline" onClick={() => setStep('time')} className="w-full">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Time Selection
          </Button>
        </>
      )}
    </div>
  );
}
