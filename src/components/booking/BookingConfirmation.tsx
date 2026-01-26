import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CheckCircle, Calendar, Clock, User, MapPin, Download, Home, Phone, Mail } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { CustomerInfo } from './CustomerInfoForm';
import type { TimeSlot } from './TimeSlotPicker';

interface ServiceItem {
  name: string;
  price: number;
}

interface BookingConfirmationProps {
  referenceNumber: string;
  jobNumber?: number;
  scheduledStart: string;
  scheduledEnd: string;
  technicianName: string;
  customer: CustomerInfo;
  services: ServiceItem[];
  subtotal: number;
  discountAmount?: number;
  discountCode?: string;
  total: number;
  onDownloadPDF?: () => void;
  onBookAnother?: () => void;
  onGoHome?: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function BookingConfirmation({
  referenceNumber,
  jobNumber,
  scheduledStart,
  scheduledEnd,
  technicianName,
  customer,
  services,
  subtotal,
  discountAmount,
  discountCode,
  total,
  onDownloadPDF,
  onBookAnother,
  onGoHome,
}: BookingConfirmationProps) {
  const startDate = parseISO(scheduledStart);
  const endDate = parseISO(scheduledEnd);
  const durationHours = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Success Header */}
      <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 mx-auto flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-green-800 dark:text-green-200">
                Booking Confirmed!
              </h2>
              <p className="text-green-700 dark:text-green-300 mt-1">
                Your appointment has been scheduled
              </p>
            </div>
            <div className="inline-block px-4 py-2 rounded-lg bg-white dark:bg-green-900 border border-green-200 dark:border-green-800">
              <p className="text-sm text-muted-foreground">Reference Number</p>
              <p className="text-xl font-mono font-bold text-foreground">{referenceNumber}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appointment Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Appointment Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-semibold">{format(startDate, 'EEEE, MMMM d, yyyy')}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Time</p>
                <p className="font-semibold">
                  {format(startDate, 'h:mm a')} - {format(endDate, 'h:mm a')}
                </p>
                <p className="text-xs text-muted-foreground">~{durationHours} hours</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Technician</p>
                <p className="font-semibold">{technicianName}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-semibold">{customer.address}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Contact Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-muted-foreground" />
              <span>{customer.firstName} {customer.lastName}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <span>{customer.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <span>{customer.phone}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Services & Pricing */}
      <Card>
        <CardHeader>
          <CardTitle>Services & Pricing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {services.map((service, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  {service.name}
                </span>
                <span className="font-medium">{formatPrice(service.price)}</span>
              </div>
            ))}
          </div>
          
          <Separator />
          
          <div className="space-y-2">
            {discountAmount && discountAmount > 0 && (
              <>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount{discountCode ? ` (${discountCode})` : ''}</span>
                  <span>-{formatPrice(discountAmount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-lg font-bold">
              <span>Total Due</span>
              <span className="text-primary">{formatPrice(total)}</span>
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground">
            Payment will be collected after service is completed.
          </p>
        </CardContent>
      </Card>

      {/* What's Next */}
      <Card className="bg-muted/50">
        <CardHeader>
          <CardTitle>What's Next?</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
              <span>You'll receive a confirmation email with your appointment details.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
              <span>We'll send a reminder the day before your appointment.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
              <span>Our technician will arrive at your scheduled time and complete the services.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">4</span>
              <span>Payment is collected after the work is complete.</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        {onDownloadPDF && (
          <Button variant="outline" className="flex-1" onClick={onDownloadPDF}>
            <Download className="w-4 h-4 mr-2" />
            Download Confirmation
          </Button>
        )}
        {onGoHome && (
          <Button className="flex-1" onClick={onGoHome}>
            <Home className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        )}
      </div>
    </div>
  );
}
