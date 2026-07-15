import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, Clock, MapPin, Info } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { TimeSlotPicker, type TimeSlot } from './TimeSlotPicker';
import { CustomerInfoForm, type CustomerInfo } from './CustomerInfoForm';
import { BookingConfirmation } from './BookingConfirmation';
import { ServiceReviewStep } from './ServiceReviewStep';
import { BookingTermsAck } from './BookingTermsAck';
import { BookingStepper } from './BookingStepper';
import { CompleteYourRefresh } from './CompleteYourRefresh';
import { LiveQuoteBar } from './LiveQuoteBar';
import { getStoredUtmParams } from '@/hooks/useUtmTracking';
import { readAttribution } from '@/lib/attribution/attribution';
import { fireSchedule, fireCompleteRegistration } from '@/lib/attribution/metaPixel';
import { useBookingStepTracking } from '@/hooks/useBookingStepTracking';
import type { ServicePrices, AdditionalServices, HomeDetails } from '@/types/homeowner';
import type { ValidatedDiscount } from '@/hooks/useDiscountCodes';

type BookingStep = 'review' | 'info' | 'time' | 'confirmation';

interface BookingFlowProps {
  servicePrices: ServicePrices;
  additionalServices: AdditionalServices;
  homeDetails: HomeDetails;
  appliedDiscount?: ValidatedDiscount | null;
  discountAmount?: number;
  onCancel: () => void;
  prefillCustomerInfo?: CustomerInfo | null;
  /**
   * Allow the customer to add services from within the booking flow
   * (upsell surfaces). Presentation-only: the pricing engine still computes
   * the actual amount. If omitted, upsell surfaces render nothing.
   */
  onAdditionalServicesChange?: (updater: (prev: AdditionalServices) => AdditionalServices) => void;
}

interface BookingResult {
  referenceNumber: string;
  jobNumber?: number;
  scheduledStart: string;
  scheduledEnd: string;
  technicianName: string;
  bookingId?: string;
  jobberVisitId?: string;
  bookedRevenue?: number;
  bookedServiceCount?: number;
  bookedServices?: string[];
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
  onAdditionalServicesChange,
}: BookingFlowProps) {
  const [step, setStep] = useState<BookingStep>('review');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(prefillCustomerInfo || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);
  const [usedSuggestedDay, setUsedSuggestedDay] = useState(false);
  const [usedRecommendedSlot, setUsedRecommendedSlot] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  // Set when the backend accepted the request (202) but could not fully confirm
  // the appointment on the calendar. The slot is held and staff will finish it —
  // this is NOT a failure and must NOT be shown as a confirmed booking.
  const [pendingManual, setPendingManual] = useState<{ referenceNumber?: string } | null>(null);

  // One idempotency key per booking attempt, reused across retries of the SAME
  // slot so a duplicate submission (double click, network retry) can never
  // create two Jobber jobs. Regenerated only when the selected slot changes.
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const sessionIdRef = useRef<string>(
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const getIdempotencyKey = (signature: string): string => {
    if (idempotencyRef.current?.signature === signature) {
      return idempotencyRef.current.key;
    }
    const key = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    idempotencyRef.current = { signature, key };
    return key;
  };

  const { trackCalendarView, trackTimeSelection, trackInfoStep, trackConfirmation } = useBookingStepTracking();

  // Build services array for availability check and booking
  // CRITICAL: Service inclusion is driven ONLY by additionalServices selection state (single source of truth)
  const buildServicesArray = () => {
    const services: Array<{ service: string; name: string; price: number; description: string }> = [];
    
    // Helper to format home details for descriptions
    const sqft = homeDetails.squareFootage?.toLocaleString() || 'N/A';
    const stories = homeDetails.stories || 1;
    const storyLabel = stories === 1 ? '1 story' : `${stories} stories`;
    
    // Window Cleaning - only include if explicitly selected in additionalServices
    if (additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0) {
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

    if (additionalServices.solarPanelCleaning.enabled && servicePrices.solarPanelCleaning > 0) {
      const panels = additionalServices.solarPanelCleaning.panelCount;
      services.push({
        service: 'solar_panels',
        name: 'Solar Panel Cleaning',
        price: servicePrices.solarPanelCleaning,
        description: `${panels} solar panels`,
      });
    }

    if (additionalServices.screenRepair.enabled && servicePrices.screenRepair > 0) {
      const screens = additionalServices.screenRepair.screenCount;
      services.push({
        service: 'screen_repair',
        name: 'Screen Repair',
        price: servicePrices.screenRepair,
        description: `${screens} screen${screens === 1 ? '' : 's'}`,
      });
    }
    
    return services;
  };

  const services = buildServicesArray();
  const subtotal = servicePrices.grandTotal;
  const finalTotal = subtotal - discountAmount;
  
  // Calculate estimated duration based on services
  const estimatedDuration = useMemo(() => {
    let minutes = 0;
    if (additionalServices.windowCleaning && servicePrices.windowCleaningTotal > 0) minutes += 90;
    if (additionalServices.houseWash && servicePrices.houseWash > 0) minutes += 60;
    if (additionalServices.gutterCleaning && servicePrices.gutterCleaning > 0) minutes += 45;
    if (additionalServices.roofCleaning && servicePrices.roofCleaning > 0) minutes += 90;
    if (additionalServices.drivewayCleaning.enabled && servicePrices.drivewayCleaning > 0) minutes += 60;
    if (additionalServices.pressureWashing.enabled && servicePrices.pressureWashing > 0) minutes += 45;
    if (additionalServices.solarPanelCleaning.enabled && servicePrices.solarPanelCleaning > 0) minutes += 45;
    if (additionalServices.screenRepair.enabled && servicePrices.screenRepair > 0) minutes += 30;
    return Math.max(60, minutes); // Minimum 1 hour
  }, [additionalServices, servicePrices]);

  // Handle proceeding from review step
  const handleProceedFromReview = () => {
    trackInfoStep();
    setStep('info');
  };

  const handleSelectSlot = (slot: TimeSlot, fromSuggestedDay?: boolean) => {
    setSelectedSlot(slot);
    if (fromSuggestedDay) setUsedSuggestedDay(true);
    if (slot.isRecommended) setUsedRecommendedSlot(true);
  };

  // Called when customer info form is submitted
  const handleCustomerInfoSubmit = (info: CustomerInfo) => {
    setCustomerInfo(info);
    // Track calendar view now that we're proceeding to time selection
    const servicesForTracking = buildServicesArray().map(s => ({ service: s.service, price: s.price }));
    trackCalendarView(servicesForTracking);
    setStep('time');
  };

  // Called when user confirms booking from time selection step
  const handleConfirmBooking = async () => {
    if (!selectedSlot || !customerInfo) {
      toast.error('Please select a time slot');
      return;
    }

    // Track time selection before confirming
    trackTimeSelection(
      {
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        technicianId: selectedSlot.technicianId,
        isRecommended: selectedSlot.isRecommended,
      },
      usedSuggestedDay,
      usedRecommendedSlot
    );

    setIsSubmitting(true);

    try {
      const slotSignature = `${selectedSlot.startTime}|${selectedSlot.technicianId}|${customerInfo.email.toLowerCase()}`;
      const idempotencyKey = getIdempotencyKey(slotSignature);

      // Build the booking request body
      const bookingBody: Record<string, unknown> = {
        customer: {
          email: customerInfo.email,
          firstName: customerInfo.firstName,
          lastName: customerInfo.lastName,
          phone: customerInfo.phone,
          address: customerInfo.address,
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
        // Structured selection so the server can authoritatively recompute the
        // quote and reject any client-side tampering (source of truth = server).
        additionalServices,
        subtotal,
        discountAmount,
        total: finalTotal,
        discountCode: appliedDiscount?.code,
        notes: customerInfo.notes,
        utmParams: getStoredUtmParams(),
        idempotencyKey,
        sessionId: sessionIdRef.current,
      };

      // Pass team booking data if the selected slot is a team job
      if ((selectedSlot as any).isTeamJob) {
        bookingBody.isTeamJob = true;
        bookingBody.teamTechnicianIds = (selectedSlot as any).teamTechnicianIds;
      }

      const { data, error } = await supabase.functions.invoke('jobber-create-booking', {
        body: bookingBody,
      });

      // supabase.functions.invoke treats non-2xx as error, but conflict (409) and 
      // scheduling busy (503) responses contain important JSON bodies.
      // Extract the response body from the error context to handle them properly.
      if (error) {
        let errorBody: any = null;
        try {
          // FunctionsHttpError stores the response in error.context
          if (error.context && typeof error.context.json === 'function') {
            errorBody = await error.context.json();
          }
        } catch {
          // Couldn't parse error body
        }

        // Accepted-but-not-confirmed (defensive: in case invoke surfaces 202 as
        // an error on some clients). Treat as pending manual confirmation.
        if (errorBody?.pendingManualConfirmation || errorBody?.code === 'VISIT_CREATION_FAILED') {
          setPendingManual({ referenceNumber: errorBody.referenceNumber });
          trackConfirmation();
          return;
        }

        if (errorBody?.code === 'CONFLICT') {
          toast.error(errorBody.details || 'This time slot is no longer available. Please select a different time.', {
            duration: 6000,
          });
          setSelectedSlot(null);
          setStep('time');
          return;
        }

        if (errorBody?.code === 'SCHEDULING_BUSY') {
          toast.error(errorBody.details || 'Our scheduling system is busy. Please try again in 1-2 minutes.', {
            duration: 6000,
          });
          return;
        }

        // For other errors with a body message, use it
        if (errorBody?.details || errorBody?.error) {
          throw new Error(errorBody.details || errorBody.error);
        }

        throw error;
      }

      // Accepted (HTTP 202): the request is safely recorded and the slot is held,
      // but the appointment still needs a person to finalize it. Never present
      // this as a confirmed booking.
      if (data?.pendingManualConfirmation || data?.code === 'VISIT_CREATION_FAILED' || data?.success === false) {
        setPendingManual({ referenceNumber: data?.referenceNumber });
        trackConfirmation();
        return;
      }

      if (data?.error) {
        throw new Error(data.details || data.error);
      }

      // A real confirmation requires a Jobber visit id to exist.
      if (!data?.jobberVisitId) {
        setPendingManual({ referenceNumber: data?.referenceNumber });
        trackConfirmation();
        return;
      }

      setBookingResult({
        referenceNumber: data.referenceNumber,
        jobNumber: data.jobNumber,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        technicianName: data.technicianName,
      });
      
      // Track confirmation
      trackConfirmation();
      
      setStep('confirmation');
      toast.success('Booking confirmed!');
    } catch (err: any) {
      console.error('Booking failed:', err);
      
      const errorMessage = err?.message || String(err);
      if (errorMessage.toLowerCase().includes('conflict') || errorMessage.toLowerCase().includes('no longer available')) {
        toast.error(errorMessage, { duration: 6000 });
        setSelectedSlot(null);
        setStep('time');
      } else if (errorMessage.toLowerCase().includes('busy') || errorMessage.toLowerCase().includes('try again')) {
        toast.error(errorMessage, { duration: 6000 });
      } else {
        toast.error('Failed to create booking. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoHome = () => {
    window.location.href = '/';
  };

  // Pending manual confirmation screen (backend returned 202 / needs_attention).
  if (pendingManual) {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Info className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold">We received your request</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Your appointment still needs to be confirmed by our team. We&apos;ll contact you
            shortly to lock in your time — you don&apos;t need to rebook.
          </p>
          {pendingManual.referenceNumber && (
            <p className="text-sm font-mono pt-1">
              Reference: <span className="font-semibold">{pendingManual.referenceNumber}</span>
            </p>
          )}
        </div>
        <Button onClick={handleGoHome} size="lg">Back to Home</Button>
      </div>
    );
  }

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
    <div className="space-y-4">
      {/* Labeled step indicator — always visible so customers see progress and total scope */}
      <div className="space-y-1.5 pb-2 border-b border-border/60">
        <BookingStepper current={step} />
        {step === 'time' && (
          <p className="text-[11px] sm:text-xs text-muted-foreground text-center pt-1">
            Your price is locked — only availability is changing.
          </p>
        )}
      </div>

      {/* Step: Review Services */}
      {step === 'review' && (
        <ServiceReviewStep
          servicePrices={servicePrices}
          additionalServices={additionalServices}
          homeDetails={homeDetails}
          appliedDiscount={appliedDiscount}
          discountAmount={discountAmount}
          estimatedDuration={estimatedDuration}
          onProceed={handleProceedFromReview}
          onBack={onCancel}
          onAdditionalServicesChange={onAdditionalServicesChange}
        />
      )}

      {/* Step: Customer Info */}
      {step === 'info' && (
        <div className="space-y-3">
          <LiveQuoteBar
            servicePrices={servicePrices}
            additionalServices={additionalServices}
            discountAmount={discountAmount}
          />
          <CustomerInfoForm
            onSubmit={handleCustomerInfoSubmit}
            initialData={customerInfo || prefillCustomerInfo || undefined}
            isSubmitting={false}
            submitButtonText="Continue to Schedule"
          />
          
          <Button 
            variant="ghost" 
            onClick={() => setStep('review')} 
            className="w-full text-muted-foreground h-9 text-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Back to Review
          </Button>
        </div>
      )}

      {/* Step: Time Selection */}
      {step === 'time' && customerInfo && (
        <div className="space-y-4">
          <LiveQuoteBar
            servicePrices={servicePrices}
            additionalServices={additionalServices}
            discountAmount={discountAmount}
          />
          {/* Address confirmation - compact */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/40 text-xs">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-muted-foreground">Service at:</span>
            <span className="font-medium truncate">{customerInfo.address}</span>
          </div>

          <TimeSlotPicker
            services={services.map(s => ({ service: s.service, price: s.price }))}
            onSelectSlot={handleSelectSlot}
            selectedSlot={selectedSlot}
            customerAddress={customerInfo.address}
            customerName={[customerInfo.firstName, customerInfo.lastName].filter(Boolean).join(' ').trim() || undefined}
          />
          
          {/* Fixed CTA area with appointment summary */}
          <div className="sticky bottom-0 pt-4 pb-2 bg-gradient-to-t from-background via-background to-transparent -mx-4 px-4">
            {/* Selected Appointment Summary - visible when slot is selected */}
            {selectedSlot && (
              <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-primary">Your Appointment</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date:</span>
                    <span className="font-medium">{format(parseISO(selectedSlot.startTime), 'EEE, MMM d')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time:</span>
                    <span className="font-medium">{selectedSlot.displayTime || format(parseISO(selectedSlot.startTime), 'h:mm a')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Technician:</span>
                    <span className="font-medium">{selectedSlot.technicianName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-medium">~{Math.round(selectedSlot.durationMinutes / 60 * 10) / 10} hrs</span>
                  </div>
                </div>
                
                {/* Terms acknowledgement (required before booking) */}
                <div className="mt-3 pt-3 border-t border-primary/10">
                  <BookingTermsAck
                    accepted={confirmationChecked}
                    onAcceptedChange={setConfirmationChecked}
                  />
                </div>
              </div>
            )}

            {/* Final "Before we reserve your appointment..." upsell — inline, no popup */}
            {selectedSlot && onAdditionalServicesChange && (
              <div className="mb-4">
                <CompleteYourRefresh
                  additionalServices={additionalServices}
                  onAdd={onAdditionalServicesChange}
                  title="Before we reserve your appointment…"
                  subtitle="One last look — add anything you'd like handled during this same visit."
                  variant="compact"
                />
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <Button 
                variant="ghost" 
                onClick={() => setStep('info')} 
                className="text-muted-foreground shrink-0"
                size="sm"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                Edit Info
              </Button>
              <Button 
                onClick={handleConfirmBooking} 
                disabled={!selectedSlot || isSubmitting || !confirmationChecked}
                className="flex-1 min-w-0 h-14 text-sm sm:text-base font-bold shadow-lg"
                size="lg"
              >
                {isSubmitting ? (
                  <>
                    <Clock className="w-4 h-4 mr-2 animate-spin" />
                    Booking...
                  </>
                ) : (
                  <>
                    Confirm Booking • {formatPrice(finalTotal)}
                    <Check className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </div>
            
            {/* Trust microcopy */}
            <p className="text-center text-[10px] text-muted-foreground mt-2">
              No payment required until service is complete
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
