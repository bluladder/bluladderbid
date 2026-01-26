import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Calendar, 
  User, 
  DollarSign, 
  Clock, 
  ExternalLink, 
  RefreshCw, 
  Megaphone,
  Tag,
  MousePointer,
  Search,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  preset?: string;
}

interface Booking {
  id: string;
  reference_number: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  total: number;
  subtotal: number;
  discount_amount: number | null;
  discount_code: string | null;
  services_json: Array<{ name: string; price: number }>;
  home_details_json: Record<string, unknown>;
  utm_params_json: UtmParams | null;
  created_at: string;
  customer: {
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
  } | null;
  technician: {
    name: string;
  } | null;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

function getStatusColor(status: string) {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800';
    case 'scheduled': return 'bg-blue-100 text-blue-800';
    case 'confirmed': return 'bg-blue-100 text-blue-800';
    case 'in_progress': return 'bg-yellow-100 text-yellow-800';
    case 'cancelled': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function UtmAttribution({ utm }: { utm: UtmParams | null }) {
  if (!utm || Object.keys(utm).filter(k => utm[k as keyof UtmParams]).length === 0) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-1">
        <MousePointer className="w-3 h-3" />
        Direct
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {utm.utm_source && (
        <div className="flex items-center gap-2 text-sm">
          <Megaphone className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground">Source:</span>
          <Badge variant="outline" className="text-xs">{utm.utm_source}</Badge>
        </div>
      )}
      {utm.utm_medium && (
        <div className="flex items-center gap-2 text-sm">
          <Tag className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground">Medium:</span>
          <Badge variant="outline" className="text-xs">{utm.utm_medium}</Badge>
        </div>
      )}
      {utm.utm_campaign && (
        <div className="flex items-center gap-2 text-sm">
          <Search className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground">Campaign:</span>
          <Badge variant="outline" className="text-xs">{utm.utm_campaign}</Badge>
        </div>
      )}
      {utm.preset && (
        <div className="flex items-center gap-2 text-sm">
          <MousePointer className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground">Preset:</span>
          <Badge variant="secondary" className="text-xs">{utm.preset}</Badge>
        </div>
      )}
      {utm.utm_term && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Term: {utm.utm_term}
        </div>
      )}
      {utm.utm_content && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Content: {utm.utm_content}
        </div>
      )}
    </div>
  );
}

function BookingCard({ booking, expanded, onToggle }: { booking: Booking; expanded: boolean; onToggle: () => void }) {
  const customerName = [booking.customer?.first_name, booking.customer?.last_name]
    .filter(Boolean).join(' ') || 'Unknown';

  return (
    <Card className="overflow-hidden">
      <div 
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono font-medium">{booking.reference_number}</span>
              <Badge className={getStatusColor(booking.status)} variant="secondary">
                {booking.status.replace('_', ' ')}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {customerName}
              </span>
              {booking.scheduled_start && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {format(parseISO(booking.scheduled_start), 'MMM d, yyyy')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-semibold">{formatPrice(booking.total)}</div>
              {booking.utm_params_json?.utm_source && (
                <Badge variant="outline" className="text-xs">
                  {booking.utm_params_json.utm_source}
                </Badge>
              )}
            </div>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-4 bg-muted/30">
          <div className="grid grid-cols-2 gap-4">
            {/* Customer Info */}
            <div>
              <h4 className="text-sm font-medium mb-2">Customer</h4>
              <div className="space-y-1 text-sm">
                <p>{customerName}</p>
                <p className="text-muted-foreground">{booking.customer?.email}</p>
                {booking.customer?.phone && (
                  <p className="text-muted-foreground">{booking.customer.phone}</p>
                )}
              </div>
            </div>

            {/* Attribution */}
            <div>
              <h4 className="text-sm font-medium mb-2">Marketing Attribution</h4>
              <UtmAttribution utm={booking.utm_params_json} />
            </div>
          </div>

          <Separator />

          {/* Services */}
          <div>
            <h4 className="text-sm font-medium mb-2">Services</h4>
            <div className="space-y-1">
              {booking.services_json.map((service, idx) => (
                <div key={idx} className="flex justify-between text-sm">
                  <span>{service.name}</span>
                  <span>{formatPrice(service.price)}</span>
                </div>
              ))}
              {booking.discount_amount && booking.discount_amount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount {booking.discount_code && `(${booking.discount_code})`}</span>
                  <span>-{formatPrice(booking.discount_amount)}</span>
                </div>
              )}
              <Separator className="my-1" />
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span>{formatPrice(booking.total)}</span>
              </div>
            </div>
          </div>

          {/* Technician & Schedule */}
          {(booking.technician || booking.scheduled_start) && (
            <>
              <Separator />
              <div className="flex gap-4 text-sm">
                {booking.technician && (
                  <div>
                    <span className="text-muted-foreground">Technician:</span>{' '}
                    {booking.technician.name}
                  </div>
                )}
                {booking.scheduled_start && (
                  <div>
                    <span className="text-muted-foreground">Scheduled:</span>{' '}
                    {format(parseISO(booking.scheduled_start), 'MMM d, yyyy h:mm a')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function BookingsManager() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          reference_number,
          status,
          scheduled_start,
          scheduled_end,
          total,
          subtotal,
          discount_amount,
          discount_code,
          services_json,
          home_details_json,
          utm_params_json,
          created_at,
          customer:customers(first_name, last_name, email, phone),
          technician:technicians(name)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setBookings((data as unknown as Booking[]) || []);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      toast.error('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  // Attribution stats
  const attributionStats = bookings.reduce((acc, b) => {
    const source = b.utm_params_json?.utm_source || 'Direct';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalRevenue = bookings.reduce((sum, b) => sum + b.total, 0);
  const attributedBookings = bookings.filter(b => 
    b.utm_params_json && Object.keys(b.utm_params_json).some(k => b.utm_params_json![k as keyof UtmParams])
  );

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Bookings</span>
            </div>
            <p className="text-2xl font-bold mt-1">{bookings.length}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Revenue</span>
            </div>
            <p className="text-2xl font-bold mt-1">{formatPrice(totalRevenue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Attributed</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              {attributedBookings.length}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                ({bookings.length > 0 ? Math.round((attributedBookings.length / bookings.length) * 100) : 0}%)
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Top Source</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              {Object.entries(attributionStats)
                .sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Attribution Breakdown */}
      {Object.keys(attributionStats).length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Attribution Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(attributionStats)
                .sort((a, b) => b[1] - a[1])
                .map(([source, count]) => (
                  <Badge key={source} variant="outline" className="text-sm">
                    {source}: {count}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bookings List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Bookings</CardTitle>
              <CardDescription>View booking details and marketing attribution</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchBookings} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading bookings...
            </div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No bookings found
            </div>
          ) : (
            <ScrollArea className="max-h-[600px] pr-4">
              <div className="space-y-3">
                {bookings.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    expanded={expandedId === booking.id}
                    onToggle={() => setExpandedId(expandedId === booking.id ? null : booking.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
