import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, Calendar, RefreshCw, ArrowRight, Check } from 'lucide-react';
import type { PastBooking, CustomerRecord } from '@/hooks/useCustomerLookup';

interface PastBookingsProps {
  customer: CustomerRecord;
  bookings: PastBooking[];
  onBookAgain: (booking: PastBooking) => void;
  onNewQuote: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'scheduled':
    case 'confirmed':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'cancelled':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export function PastBookings({ customer, bookings, onBookAgain, onNewQuote }: PastBookingsProps) {
  const hasBookings = bookings.length > 0;
  const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Valued Customer';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Welcome back, {customerName}!
            </CardTitle>
            <CardDescription className="mt-1">
              {customer.email}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasBookings ? (
          <>
            <div className="text-sm text-muted-foreground">
              Your recent bookings ({bookings.length})
            </div>
            
            <ScrollArea className="max-h-[400px] pr-4">
              <div className="space-y-3">
                {bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">
                          {booking.referenceNumber}
                        </p>
                        {booking.scheduledStart && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Calendar className="w-3 h-3" />
                            {format(parseISO(booking.scheduledStart), 'MMM d, yyyy')}
                          </p>
                        )}
                      </div>
                      <Badge className={getStatusColor(booking.status)} variant="secondary">
                        {formatStatus(booking.status)}
                      </Badge>
                    </div>
                    
                    <div className="space-y-1 mb-3">
                      {booking.servicesJson.slice(0, 3).map((service, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Check className="w-3 h-3 text-green-600" />
                            {service.name}
                          </span>
                          <span>{formatPrice(service.price)}</span>
                        </div>
                      ))}
                      {booking.servicesJson.length > 3 && (
                        <p className="text-xs text-muted-foreground">
                          +{booking.servicesJson.length - 3} more services
                        </p>
                      )}
                    </div>
                    
                    <Separator className="my-2" />
                    
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">
                        {formatPrice(booking.total)}
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => onBookAgain(booking)}
                        className="gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Book Again
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No past bookings found</p>
            <p className="text-sm mt-1">
              But we have your info saved for a faster checkout!
            </p>
          </div>
        )}
        
        <Separator />
        
        <Button 
          className="w-full"
          onClick={onNewQuote}
        >
          Build a New Quote
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}
