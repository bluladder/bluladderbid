import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Calendar, 
  Clock, 
  User, 
  DollarSign, 
  Phone, 
  MapPin, 
  RefreshCw, 
  AlertCircle,
  CheckCircle,
  Loader2,
  Eye,
  EyeOff,
  ShieldAlert
} from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, isSameDay } from 'date-fns';
import { useServerQuoteCalculation } from '@/hooks/useServerQuoteCalculation';
import { toQuoteInput } from '@/lib/pricing/toQuoteInput';
import type { HomeDetails, AdditionalServices } from '@/types/homeowner';
import { DEFAULT_HOME_DETAILS, DEFAULT_ADDITIONAL_SERVICES } from '@/types/homeowner';
import { AdminAvailabilityViewer, type TimeSlot } from './AdminAvailabilityViewer';
import { SmartScheduler, type SchedulerSlot } from '@/components/scheduling/SmartScheduler';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

// Maps canonical server line-item keys → the availability service keys expected
// by the shared jobber-availability function (which derives operational duration
// and crew requirements). Purely a key rename — NO pricing math here.
const AVAILABILITY_SERVICE_KEY: Record<string, string> = {
  window_cleaning: 'windows_exterior',
  interior_windows: 'windows_interior',
  gutter_cleaning: 'gutters',
  house_wash: 'house_wash',
  roof_cleaning: 'roof_cleaning',
  driveway_cleaning: 'driveway',
  pressure_washing: 'pressure_wash_addon',
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function SchedulingPortal() {
  // Customer info state
  const [customerInfo, setCustomerInfo] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
  });

  // Home details state
  const [homeDetails, setHomeDetails] = useState<HomeDetails>({
    ...DEFAULT_HOME_DETAILS,
    squareFootage: 2500,
  });

  const [additionalServices, setAdditionalServices] = useState<AdditionalServices>({
    ...DEFAULT_ADDITIONAL_SERVICES,
    // The portal always prices/schedules exterior window cleaning.
    windowCleaning: true,
    gutterCleaning: true,
  });

  // Slot selection state
  const [selectedSlot, setSelectedSlot] = useState<(TimeSlot & Partial<SchedulerSlot>) | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [isBooking, setIsBooking] = useState(false);

  // AUTHORITATIVE pricing — every dollar comes from the deployed calculate-quote
  // Edge Function. No local pricing math in the portal.
  const quoteState = useServerQuoteCalculation(
    toQuoteInput(homeDetails, additionalServices),
  );
  const { quote, isFirm, loading: quoteLoading, isUnavailable, isMissingInfo } = quoteState;

  // Line items + total come straight from the authoritative server quote.
  const priceData = useMemo(() => {
    if (!isFirm || !quote) return { services: [], total: 0 };
    return {
      services: quote.lineItems.map((li) => ({ service: li.key, name: li.label, price: li.amount })),
      total: quote.total,
    };
  }, [isFirm, quote]);

  // Server-returned OPERATIONAL duration metadata (not a price proxy).
  const estimatedDurationMinutes = quote?.estimatedDurationMinutes ?? null;

  // Services for availability — server-authoritative prices, keyed to the
  // availability service vocabulary. Route-density/crew logic downstream uses
  // these operational inputs, never a locally computed dollar amount.
  const servicesForAvailability = useMemo(() => {
    return priceData.services.map((s) => ({
      service: AVAILABILITY_SERVICE_KEY[s.service] ?? s.service,
      price: s.price,
    }));
  }, [priceData.services]);

  const handleSlotSelect = (slot: TimeSlot & Partial<SchedulerSlot>) => {
    setSelectedSlot(slot);
  };

  const handleCreateBooking = async () => {
    if (!selectedSlot) {
      toast.error('Please select a time slot');
      return;
    }

    if (!customerInfo.email || !customerInfo.firstName || !customerInfo.lastName) {
      toast.error('Please fill in customer name and email');
      return;
    }

    setIsBooking(true);
    try {
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
        services: priceData.services.map(s => ({
          name: s.name,
          price: s.price,
          description: `${homeDetails.squareFootage} sq ft, ${homeDetails.stories} story`,
        })),
        homeDetails,
        subtotal: priceData.total,
        discountAmount: 0,
        total: priceData.total,
        notes: `Admin booking via Scheduling Portal`,
        utmParams: { preset: 'admin-portal' },
      };

      // Pass team booking data through if the selected slot is a team job.
      if (selectedSlot.isTeamJob) {
        bookingBody.isTeamJob = true;
        bookingBody.teamTechnicianIds = selectedSlot.teamTechnicianIds;
      }

      const { data, error } = await supabase.functions.invoke('jobber-create-booking', {
        body: bookingBody,
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success(`Booking created! Reference: ${data.referenceNumber}`);
      
      // Reset form
      setSelectedSlot(null);
      setShowInspector(false);
      setCustomerInfo({ firstName: '', lastName: '', email: '', phone: '', address: '' });
    } catch (err) {
      console.error('Booking failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setIsBooking(false);
    }
  };

  if (pricingLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Admin Scheduling Portal
          </CardTitle>
          <CardDescription>
            View pricing, check availability, and book appointments while on the phone with customers
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Customer & Service Configuration */}
        <div className="space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={customerInfo.firstName}
                    onChange={(e) => setCustomerInfo(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={customerInfo.lastName}
                    onChange={(e) => setCustomerInfo(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Smith"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={customerInfo.email}
                  onChange={(e) => setCustomerInfo(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="john@example.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={customerInfo.phone}
                  onChange={(e) => setCustomerInfo(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="address">Service Address</Label>
                <Input
                  id="address"
                  value={customerInfo.address}
                  onChange={(e) => setCustomerInfo(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="123 Main St, City, TX 75001"
                />
              </div>
            </CardContent>
          </Card>

          {/* Home Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4" />
                Home Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="sqft">Square Footage</Label>
                  <Input
                    id="sqft"
                    type="number"
                    value={homeDetails.squareFootage || ''}
                    onChange={(e) => setHomeDetails(prev => ({ ...prev, squareFootage: parseInt(e.target.value) || 0 }))}
                    placeholder="2500"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="stories">Stories</Label>
                  <Select
                    value={String(homeDetails.stories)}
                    onValueChange={(v) => setHomeDetails(prev => ({ ...prev, stories: parseInt(v) as 1 | 2 | 3 }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 Story</SelectItem>
                      <SelectItem value="2">2 Stories</SelectItem>
                      <SelectItem value="3">3 Stories</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Service toggles */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Gutter Cleaning</Label>
                  <Switch
                    checked={additionalServices.gutterCleaning}
                    onCheckedChange={(checked) => setAdditionalServices(prev => ({ ...prev, gutterCleaning: checked }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>House Wash</Label>
                  <Switch
                    checked={additionalServices.houseWash}
                    onCheckedChange={(checked) => setAdditionalServices(prev => ({ ...prev, houseWash: checked }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Price Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" />
                Price Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {priceData.services.map((svc, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span>{svc.name}</span>
                    <span className="font-mono">{formatPrice(svc.price)}</span>
                  </div>
                ))}
                {priceData.services.length === 0 && (
                  <p className="text-sm text-muted-foreground">Enter home details to see pricing</p>
                )}
              </div>
              {priceData.total > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">Total</span>
                    <Badge variant="secondary" className="text-lg font-mono">
                      {formatPrice(priceData.total)}
                    </Badge>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Availability & Booking */}
        <div className="space-y-6">
          {/* Smart Scheduler — same Best / Next / 5 more / calendar as customers see */}
          {servicesForAvailability.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <Calendar className="w-6 h-6 mx-auto mb-2 opacity-50" />
                Enter home details and select services to see available appointments.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-4 w-4" />
                  Available Appointments
                </CardTitle>
                <CardDescription>
                  Best recommended, next available, and the full calendar — the same view customers get.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SmartScheduler
                  services={servicesForAvailability}
                  customerAddress={customerInfo.address || undefined}
                  numStories={homeDetails.stories}
                  selectedSlot={selectedSlot}
                  onSelectSlot={(slot) => handleSlotSelect(slot as TimeSlot & Partial<SchedulerSlot>)}
                />
              </CardContent>
            </Card>
          )}

          {/* Advanced: Availability Inspector (excluded slots + overrides) */}
          {servicesForAvailability.length > 0 && (
            <Collapsible open={showInspector} onOpenChange={setShowInspector}>
              <Card>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/40 rounded-lg transition-colors">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-semibold">Advanced: Availability Inspector</p>
                        <p className="text-xs text-muted-foreground">
                          Show excluded slots and override hidden times.
                        </p>
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showInspector ? 'rotate-180' : ''}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <AdminAvailabilityViewer
                      services={servicesForAvailability}
                      customerAddress={customerInfo.address || undefined}
                      onSelectSlot={handleSlotSelect}
                      selectedSlot={selectedSlot}
                    />
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* Selected Slot & Book */}
          {selectedSlot && (
            <Card className="border-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Selected Appointment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{format(parseISO(selectedSlot.startTime), 'EEEE, MMMM d, yyyy')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {format(parseISO(selectedSlot.startTime), 'h:mm a')} - {format(parseISO(selectedSlot.endTime), 'h:mm a')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedSlot.technicianName}</span>
                  </div>
                </div>

                {selectedSlot.isOverride && (
                  <Alert className="border-orange-500/50 bg-orange-500/10">
                    <ShieldAlert className="h-4 w-4 text-orange-600" />
                    <AlertDescription className="text-orange-600 text-sm">
                      This is an override slot that is normally hidden from customers.
                    </AlertDescription>
                  </Alert>
                )}

                <Button 
                  onClick={handleCreateBooking} 
                  className="w-full"
                  disabled={isBooking || !customerInfo.email || !customerInfo.firstName}
                >
                  {isBooking ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Booking...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Create Booking
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
