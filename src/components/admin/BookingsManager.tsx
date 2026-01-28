import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
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
  ChevronUp,
  CalendarIcon,
  Trash2,
  EyeOff,
  Eye,
  RotateCcw,
  CalendarClock,
  Edit,
  XCircle,
  ShieldAlert,
  Loader2
} from 'lucide-react';
import { format, parseISO, subDays, startOfDay, endOfDay, isWithinInterval, differenceInHours } from 'date-fns';
import { toast } from 'sonner';
import { AdminRescheduleDialog } from './AdminRescheduleDialog';
import { AdminModifyServicesDialog } from './AdminModifyServicesDialog';
import { AdminCancelDialog } from './AdminCancelDialog';
import { BookingAuditLog } from './BookingAuditLog';

type DateRange = '7d' | '30d' | '90d' | 'all' | 'custom';

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
  duration_minutes: number;
  total: number;
  subtotal: number;
  discount_amount: number | null;
  discount_code: string | null;
  services_json: Array<{ name: string; price: number }>;
  home_details_json: Record<string, unknown>;
  utm_params_json: UtmParams | null;
  created_at: string;
  is_hidden: boolean;
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

function BookingCard({ 
  booking, 
  expanded, 
  onToggle, 
  onDelete,
  onHide,
  onRestore,
  onReschedule,
  onModify,
  onCancel,
  onViewHistory,
}: { 
  booking: Booking; 
  expanded: boolean; 
  onToggle: () => void;
  onDelete: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  onReschedule: (booking: Booking) => void;
  onModify: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  onViewHistory: (booking: Booking) => void;
}) {
  const customerName = [booking.customer?.first_name, booking.customer?.last_name]
    .filter(Boolean).join(' ') || 'Unknown';
  
  // Check if within 48-hour lockout
  const isWithinLockout = booking.scheduled_start 
    ? differenceInHours(parseISO(booking.scheduled_start), new Date()) < 48
    : false;
  
  // Check if booking can be modified (not completed or cancelled)
  const canModify = !['completed', 'cancelled'].includes(booking.status);

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
              {booking.is_hidden && (
                <Badge variant="outline" className="text-xs bg-muted">
                  <EyeOff className="w-3 h-3 mr-1" />
                  Hidden
                </Badge>
              )}
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

          {/* Admin Override Actions */}
          {canModify && (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-medium">Admin Actions</span>
                  {isWithinLockout && (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      Within 48hr lockout
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onReschedule(booking); }}>
                    <CalendarClock className="w-4 h-4 mr-1.5" />
                    Reschedule
                  </Button>
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onModify(booking); }}>
                    <Edit className="w-4 h-4 mr-1.5" />
                    Modify
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); onCancel(booking); }}>
                    <XCircle className="w-4 h-4 mr-1.5" />
                    Cancel
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onViewHistory(booking); }}>
                    <Clock className="w-4 h-4 mr-1.5" />
                    History
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Visibility Actions */}
          <Separator />
          <div className="flex justify-end gap-2">
            {booking.is_hidden ? (
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onRestore(booking.id); }}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Restore
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onHide(booking.id); }}>
                <EyeOff className="w-4 h-4 mr-2" />
                Hide
              </Button>
            )}
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Permanently
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Permanently Delete Booking?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete booking <strong>{booking.reference_number}</strong> for {customerName}.
                    This action cannot be undone. Consider hiding the booking instead if you want to keep it for records.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(booking.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete Permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </Card>
  );
}

export function BookingsManager() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [customStartDate, setCustomStartDate] = useState<Date | undefined>(undefined);
  const [customEndDate, setCustomEndDate] = useState<Date | undefined>(undefined);
  const [showHidden, setShowHidden] = useState(false);
  
  // Dialog states
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [modifyTarget, setModifyTarget] = useState<Booking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Booking | null>(null);

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
          duration_minutes,
          total,
          subtotal,
          discount_amount,
          discount_code,
          services_json,
          home_details_json,
          utm_params_json,
          created_at,
          is_hidden,
          customer:customers(first_name, last_name, email, phone),
          technician:technicians(name)
        `)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      setBookings((data as unknown as Booking[]) || []);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      toast.error('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  const deleteBooking = async (id: string) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      setBookings(prev => prev.filter(b => b.id !== id));
      setExpandedId(null);
      toast.success('Booking permanently deleted');
    } catch (err) {
      console.error('Failed to delete booking:', err);
      toast.error('Failed to delete booking');
    }
  };

  const hideBooking = async (id: string) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ is_hidden: true })
        .eq('id', id);
      
      if (error) throw error;
      
      setBookings(prev => prev.map(b => b.id === id ? { ...b, is_hidden: true } : b));
      setExpandedId(null);
      toast.success('Booking hidden from analytics');
    } catch (err) {
      console.error('Failed to hide booking:', err);
      toast.error('Failed to hide booking');
    }
  };

  const restoreBooking = async (id: string) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ is_hidden: false })
        .eq('id', id);
      
      if (error) throw error;
      
      setBookings(prev => prev.map(b => b.id === id ? { ...b, is_hidden: false } : b));
      toast.success('Booking restored');
    } catch (err) {
      console.error('Failed to restore booking:', err);
      toast.error('Failed to restore booking');
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  // Filter bookings by date range and hidden status
  const filteredBookings = useMemo(() => {
    let filtered = bookings;
    
    // Filter by hidden status
    if (!showHidden) {
      filtered = filtered.filter(b => !b.is_hidden);
    }
    
    // Filter by date range
    if (dateRange === 'all') return filtered;
    
    const now = new Date();
    let startDate: Date;
    let endDate = endOfDay(now);
    
    if (dateRange === 'custom') {
      if (!customStartDate || !customEndDate) return filtered;
      startDate = startOfDay(customStartDate);
      endDate = endOfDay(customEndDate);
    } else {
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
      startDate = startOfDay(subDays(now, days));
    }
    
    return filtered.filter(b => {
      const bookingDate = parseISO(b.created_at);
      return isWithinInterval(bookingDate, { start: startDate, end: endDate });
    });
  }, [bookings, dateRange, customStartDate, customEndDate, showHidden]);

  const hiddenCount = bookings.filter(b => b.is_hidden).length;

  // Attribution stats (using filtered bookings)
  const attributionStats = filteredBookings.reduce((acc, b) => {
    const source = b.utm_params_json?.utm_source || 'Direct';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalRevenue = filteredBookings.reduce((sum, b) => sum + b.total, 0);
  const attributedBookings = filteredBookings.filter(b => 
    b.utm_params_json && Object.keys(b.utm_params_json).some(k => b.utm_params_json![k as keyof UtmParams])
  );

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground mr-2">Date Range:</span>
            {(['7d', '30d', '90d', 'all'] as const).map((range) => (
              <Button
                key={range}
                variant={dateRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDateRange(range)}
              >
                {range === 'all' ? 'All Time' : `Last ${range.replace('d', ' days')}`}
              </Button>
            ))}
            
            {/* Custom Date Range */}
            <div className="flex items-center gap-2 ml-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={dateRange === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    className={cn(!customStartDate && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {customStartDate ? format(customStartDate, 'MMM d') : 'Start'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={customStartDate}
                    onSelect={(date) => {
                      setCustomStartDate(date);
                      if (date) setDateRange('custom');
                    }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">–</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={dateRange === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    className={cn(!customEndDate && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {customEndDate ? format(customEndDate, 'MMM d') : 'End'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={customEndDate}
                    onSelect={(date) => {
                      setCustomEndDate(date);
                      if (date) setDateRange('custom');
                    }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            {/* Show Hidden Toggle */}
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant={showHidden ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowHidden(!showHidden)}
                className="gap-2"
              >
                {showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {showHidden ? 'Showing Hidden' : 'Show Hidden'}
                {hiddenCount > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {hiddenCount}
                  </Badge>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Bookings</span>
            </div>
            <p className="text-2xl font-bold mt-1">{filteredBookings.length}</p>
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
              <CardTitle>Bookings ({filteredBookings.length})</CardTitle>
              <CardDescription>
                {dateRange === 'custom' && customStartDate && customEndDate
                  ? `${format(customStartDate, 'MMM d, yyyy')} – ${format(customEndDate, 'MMM d, yyyy')}`
                  : dateRange === 'all' 
                    ? 'All time'
                    : `Last ${dateRange.replace('d', ' days')}`}
              </CardDescription>
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
          ) : filteredBookings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No bookings found for this date range
            </div>
          ) : (
            <ScrollArea className="max-h-[600px] pr-4">
              <div className="space-y-3">
                {filteredBookings.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    expanded={expandedId === booking.id}
                    onToggle={() => setExpandedId(expandedId === booking.id ? null : booking.id)}
                    onDelete={deleteBooking}
                    onHide={hideBooking}
                    onRestore={restoreBooking}
                    onReschedule={(b) => setRescheduleTarget(b)}
                    onModify={(b) => setModifyTarget(b)}
                    onCancel={(b) => setCancelTarget(b)}
                    onViewHistory={(b) => setHistoryTarget(b)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Admin Dialogs */}
      {rescheduleTarget && (
        <AdminRescheduleDialog
          appointment={rescheduleTarget}
          open={!!rescheduleTarget}
          onOpenChange={(open) => !open && setRescheduleTarget(null)}
          onComplete={() => {
            setRescheduleTarget(null);
            fetchBookings();
            toast.success('Appointment rescheduled');
          }}
          adminUserId={user?.id || ''}
        />
      )}

      {modifyTarget && (
        <AdminModifyServicesDialog
          appointment={modifyTarget}
          open={!!modifyTarget}
          onOpenChange={(open) => !open && setModifyTarget(null)}
          onComplete={() => {
            setModifyTarget(null);
            fetchBookings();
          }}
          adminUserId={user?.id || ''}
        />
      )}

      {cancelTarget && (
        <AdminCancelDialog
          appointment={cancelTarget}
          open={!!cancelTarget}
          onOpenChange={(open) => !open && setCancelTarget(null)}
          onComplete={() => {
            setCancelTarget(null);
            fetchBookings();
          }}
          adminUserId={user?.id || ''}
        />
      )}

      {historyTarget && (
        <BookingAuditLog
          bookingId={historyTarget.id}
          referenceNumber={historyTarget.reference_number}
          open={!!historyTarget}
          onOpenChange={(open) => !open && setHistoryTarget(null)}
        />
      )}
    </div>
  );
}
