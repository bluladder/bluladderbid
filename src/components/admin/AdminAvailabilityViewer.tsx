import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Calendar, Clock, User, ChevronLeft, ChevronRight, Star, AlertCircle, 
  Eye, EyeOff, Car, MapPin, Ban, RefreshCw, ShieldAlert, CheckCircle 
} from 'lucide-react';
import { format, parseISO, isSameDay } from 'date-fns';

interface ExclusionReason {
  code: 'OVERLAP' | 'DRIVE_TIME' | 'BUFFER' | 'BOUNDARY' | 'LAST_JOB';
  message: string;
  details?: string;
}

export interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isRecommended?: boolean;
  estimatedDriveMinutes?: number;
  isFirstJob?: boolean;
  isLongFirstDrive?: boolean;
  excluded?: boolean;
  exclusionReason?: ExclusionReason;
  isOverride?: boolean;
}

interface ServiceForAvailability {
  service: string;
  price: number;
}

interface AdminAvailabilityViewerProps {
  services: ServiceForAvailability[];
  customerAddress?: string;
  onSelectSlot?: (slot: TimeSlot) => void;
  selectedSlot?: TimeSlot | null;
}

const exclusionIcons: Record<string, React.ReactNode> = {
  OVERLAP: <Ban className="w-3 h-3" />,
  DRIVE_TIME: <Car className="w-3 h-3" />,
  BUFFER: <Clock className="w-3 h-3" />,
  BOUNDARY: <Calendar className="w-3 h-3" />,
  LAST_JOB: <MapPin className="w-3 h-3" />,
};

const exclusionColors: Record<string, string> = {
  OVERLAP: 'bg-destructive/10 text-destructive border-destructive/30',
  DRIVE_TIME: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  BUFFER: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  BOUNDARY: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  LAST_JOB: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
};

export function AdminAvailabilityViewer({ 
  services, 
  customerAddress,
  onSelectSlot,
  selectedSlot 
}: AdminAvailabilityViewerProps) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [excludedSlots, setExcludedSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [overrideMode, setOverrideMode] = useState(false);
  const [pendingOverrideSlot, setPendingOverrideSlot] = useState<TimeSlot | null>(null);

  // Debounce availability requests so typing an address doesn't spam the provider.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAvailability = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('jobber-availability', {
        body: {
          services,
          startDate: format(new Date(), 'yyyy-MM-dd'),
          // Keep admin requests small to avoid triggering provider throttling.
          // The admin can page forward/back as needed instead of prefetching weeks at a time.
          daysToCheck: 3,
          customerAddress,
          includeExcluded: true, // Admin mode
        },
      });

      if (fnError) throw fnError;

      if (data.error) {
        setError(data.error);
        setSlots([]);
        setExcludedSlots([]);
        return;
      }

      const fetchedSlots: TimeSlot[] = data.slots || [];
      const fetchedExcluded: TimeSlot[] = data.excludedSlots || [];
      
      setSlots(fetchedSlots);
      setExcludedSlots(fetchedExcluded);

      // Extract unique dates that have any slots
      const allSlots = [...fetchedSlots, ...fetchedExcluded];
      const dates = [...new Set(allSlots.map(s => 
        format(parseISO(s.startTime), 'yyyy-MM-dd')
      ))].map(d => parseISO(d));
      
      setAvailableDates(dates);
      
      if (dates.length > 0) {
        setSelectedDate(dates[0]);
      }
    } catch (err) {
      console.error('Failed to fetch availability:', err);
      setError('Unable to load availability data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (services.length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchAvailability();
    }, 800);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [services, customerAddress]);

  // Combine and filter slots for selected date
  const allSlotsForDate = [
    ...slots.filter(slot => isSameDay(parseISO(slot.startTime), selectedDate)),
    ...(showExcluded ? excludedSlots.filter(slot => isSameDay(parseISO(slot.startTime), selectedDate)) : []),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Stats for selected date
  const availableCount = slots.filter(slot => isSameDay(parseISO(slot.startTime), selectedDate)).length;
  const excludedCount = excludedSlots.filter(slot => isSameDay(parseISO(slot.startTime), selectedDate)).length;

  // Group by exclusion reason for stats
  const excludedByReason = excludedSlots
    .filter(slot => isSameDay(parseISO(slot.startTime), selectedDate))
    .reduce((acc, slot) => {
      const code = slot.exclusionReason?.code || 'UNKNOWN';
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const navigateDate = (direction: 'prev' | 'next') => {
    const currentIndex = availableDates.findIndex(d => isSameDay(d, selectedDate));
    if (direction === 'prev' && currentIndex > 0) {
      setSelectedDate(availableDates[currentIndex - 1]);
    } else if (direction === 'next' && currentIndex < availableDates.length - 1) {
      setSelectedDate(availableDates[currentIndex + 1]);
    }
  };

  const handleSlotClick = (slot: TimeSlot) => {
    if (slot.excluded) {
      if (overrideMode) {
        setPendingOverrideSlot(slot);
      }
    } else {
      onSelectSlot?.(slot);
    }
  };

  const confirmOverride = () => {
    if (pendingOverrideSlot && onSelectSlot) {
      onSelectSlot({ ...pendingOverrideSlot, isOverride: true });
    }
    setPendingOverrideSlot(null);
  };

  const isSlotSelected = (slot: TimeSlot) => {
    return selectedSlot?.startTime === slot.startTime && 
           selectedSlot?.technicianId === slot.technicianId;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Loading Availability...
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Availability Inspector
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={fetchAvailability} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Availability Inspector
            </CardTitle>
            <CardDescription>
              Admin view showing all slots including excluded ones
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAvailability}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Switch
              id="show-excluded"
              checked={showExcluded}
              onCheckedChange={(checked) => {
                setShowExcluded(checked);
                if (!checked) setOverrideMode(false);
              }}
            />
            <Label htmlFor="show-excluded" className="flex items-center gap-1">
              {showExcluded ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              Show Excluded
            </Label>
          </div>
          
          {showExcluded && (
            <div className="flex items-center gap-2">
              <Switch
                id="override-mode"
                checked={overrideMode}
                onCheckedChange={setOverrideMode}
              />
              <Label htmlFor="override-mode" className="flex items-center gap-1">
                <ShieldAlert className="w-4 h-4" />
                Override Mode
              </Label>
            </div>
          )}
          
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('grid')}
            >
              Grid
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('table')}
            >
              Table
            </Button>
          </div>
        </div>

        {overrideMode && (
          <Alert className="border-orange-500/50 bg-orange-500/10">
            <ShieldAlert className="h-4 w-4 text-orange-600" />
            <AlertDescription className="text-orange-600">
              <strong>Override Mode Active:</strong> You can now select excluded time slots for internal scheduling. 
              These slots are hidden from customers for good reason—use with caution.
            </AlertDescription>
          </Alert>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
            <div className="text-2xl font-bold text-green-600">{availableCount}</div>
            <div className="text-xs text-muted-foreground">Available</div>
          </div>
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="text-2xl font-bold text-destructive">{excludedCount}</div>
            <div className="text-xs text-muted-foreground">Excluded</div>
          </div>
          {Object.entries(excludedByReason).map(([code, count]) => (
            <div key={code} className={`p-3 rounded-lg border ${exclusionColors[code] || 'bg-muted'}`}>
              <div className="flex items-center gap-1">
                {exclusionIcons[code]}
                <span className="font-bold">{count}</span>
              </div>
              <div className="text-xs">{code.replace('_', ' ')}</div>
            </div>
          ))}
        </div>

        {/* Date Navigation */}
        <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateDate('prev')}
            disabled={availableDates.findIndex(d => isSameDay(d, selectedDate)) === 0}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          
          <div className="text-center">
            <p className="font-semibold text-lg">
              {format(selectedDate, 'EEEE, MMMM d')}
            </p>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateDate('next')}
            disabled={availableDates.findIndex(d => isSameDay(d, selectedDate)) === availableDates.length - 1}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Date Quick Select */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {availableDates.slice(0, 10).map((date) => (
            <Button
              key={date.toISOString()}
              variant={isSameDay(date, selectedDate) ? 'default' : 'outline'}
              size="sm"
              className="flex-shrink-0"
              onClick={() => setSelectedDate(date)}
            >
              <div className="text-center">
                <div className="text-xs">{format(date, 'EEE')}</div>
                <div className="font-bold">{format(date, 'd')}</div>
              </div>
            </Button>
          ))}
        </div>

        {/* Slots Display */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            <TooltipProvider>
              {allSlotsForDate.map((slot, idx) => {
                const canSelect = !slot.excluded || overrideMode;
                const selected = isSlotSelected(slot);
                
                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={selected ? 'default' : slot.excluded ? 'outline' : 'secondary'}
                        size="sm"
                        className={`relative flex flex-col h-auto py-2 ${
                          slot.excluded 
                            ? `${exclusionColors[slot.exclusionReason?.code || 'OVERLAP']} ${overrideMode ? 'cursor-pointer hover:ring-2 hover:ring-orange-500' : ''}`
                            : ''
                        } ${selected ? 'ring-2 ring-primary' : ''}`}
                        onClick={() => handleSlotClick(slot)}
                        disabled={!canSelect || !onSelectSlot}
                      >
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(parseISO(slot.startTime), 'h:mm a')}
                        </div>
                        <div className="text-xs opacity-70">{slot.technicianName}</div>
                        {slot.estimatedDriveMinutes && (
                          <div className="text-xs flex items-center gap-1">
                            <Car className="w-3 h-3" />
                            {slot.estimatedDriveMinutes}m
                          </div>
                        )}
                        {slot.isRecommended && (
                          <Star className="w-3 h-3 absolute -top-1 -right-1 text-yellow-500 fill-yellow-500" />
                        )}
                        {slot.isLongFirstDrive && (
                          <Badge variant="outline" className="text-[10px] absolute -bottom-1 -right-1">
                            Long 1st
                          </Badge>
                        )}
                        {slot.excluded && (
                          <div className="absolute -top-1 -left-1">
                            {exclusionIcons[slot.exclusionReason?.code || 'OVERLAP']}
                          </div>
                        )}
                        {selected && (
                          <CheckCircle className="w-4 h-4 absolute -top-1 -right-1 text-primary-foreground" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="space-y-1">
                        <p className="font-medium">{slot.technicianName}</p>
                        <p>{format(parseISO(slot.startTime), 'h:mm a')} - {format(parseISO(slot.endTime), 'h:mm a')}</p>
                        {slot.estimatedDriveMinutes && (
                          <p className="text-xs">Est. drive: {slot.estimatedDriveMinutes} min</p>
                        )}
                        {slot.isFirstJob && <p className="text-xs">First job of day</p>}
                        {slot.excluded && slot.exclusionReason && (
                          <div className="pt-1 border-t">
                            <p className="font-medium text-destructive">{slot.exclusionReason.message}</p>
                            {slot.exclusionReason.details && (
                              <p className="text-xs">{slot.exclusionReason.details}</p>
                            )}
                            {overrideMode && (
                              <p className="text-xs text-orange-600 mt-1">Click to override and book this slot</p>
                            )}
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </TooltipProvider>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Drive</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  {overrideMode && <TableHead>Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allSlotsForDate.map((slot, idx) => {
                  const canSelect = !slot.excluded || overrideMode;
                  const selected = isSlotSelected(slot);
                  
                  return (
                    <TableRow 
                      key={idx}
                      className={`${slot.excluded ? 'opacity-60' : ''} ${selected ? 'bg-primary/10' : ''} ${canSelect && onSelectSlot ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                      onClick={() => canSelect && onSelectSlot && handleSlotClick(slot)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {selected && <CheckCircle className="w-4 h-4 text-primary" />}
                          {format(parseISO(slot.startTime), 'h:mm a')}
                          {slot.isFirstJob && (
                            <Badge variant="outline" className="text-[10px]">1st</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{slot.technicianName}</TableCell>
                      <TableCell>
                        {slot.estimatedDriveMinutes ? `${slot.estimatedDriveMinutes} min` : '-'}
                      </TableCell>
                      <TableCell>{slot.durationMinutes} min</TableCell>
                      <TableCell>
                        {slot.excluded ? (
                          <Badge variant="destructive">Excluded</Badge>
                        ) : (
                          <Badge variant="default">Available</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {slot.exclusionReason ? (
                          <div className="text-xs">
                            <div className="font-medium">{slot.exclusionReason.message}</div>
                            {slot.exclusionReason.details && (
                              <div className="text-muted-foreground">{slot.exclusionReason.details}</div>
                            )}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {slot.excluded && overrideMode && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="text-orange-600 border-orange-500/50 hover:bg-orange-500/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSlotClick(slot);
                            }}
                          >
                            <ShieldAlert className="w-3 h-3 mr-1" />
                            Override
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {allSlotsForDate.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No slots to display for this date.
            </AlertDescription>
          </Alert>
        )}

        {/* Override Confirmation Dialog */}
        <AlertDialog open={!!pendingOverrideSlot} onOpenChange={() => setPendingOverrideSlot(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-orange-600" />
                Override Excluded Slot?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    You are about to book a slot that is normally hidden from customers.
                  </p>
                  
                  {pendingOverrideSlot && (
                    <div className="p-3 rounded-lg bg-muted space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">
                          {format(parseISO(pendingOverrideSlot.startTime), 'EEEE, MMM d')} at {format(parseISO(pendingOverrideSlot.startTime), 'h:mm a')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        <span>{pendingOverrideSlot.technicianName}</span>
                      </div>
                      {pendingOverrideSlot.exclusionReason && (
                        <div className={`p-2 rounded border ${exclusionColors[pendingOverrideSlot.exclusionReason.code]}`}>
                          <div className="flex items-center gap-1 font-medium">
                            {exclusionIcons[pendingOverrideSlot.exclusionReason.code]}
                            {pendingOverrideSlot.exclusionReason.message}
                          </div>
                          {pendingOverrideSlot.exclusionReason.details && (
                            <p className="text-xs mt-1">{pendingOverrideSlot.exclusionReason.details}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <p className="text-orange-600 font-medium">
                    This override will be logged. Proceed only if necessary for internal scheduling.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmOverride}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <ShieldAlert className="w-4 h-4 mr-2" />
                Confirm Override
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}