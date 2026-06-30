import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Sparkles, Zap, Check, User, Users, Clock, Calendar as CalendarIcon,
  Route, ChevronDown, ChevronLeft, ChevronRight, AlertCircle, Star,
  Sun, Moon, Hand, X,
} from 'lucide-react';
import { format, parseISO, addDays, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  useSmartAvailability,
  type TimePreference,
  type RecommendedSlot,
} from '@/hooks/useSmartAvailability';
import { DateFirstCalendar, type CalendarViewMode } from '@/components/booking/DateFirstCalendar';
import { TimeSlotList } from '@/components/booking/TimeSlotList';
import type { TimeSlot } from '@/components/booking/TimeSlotPicker';
import { BookingHelpContact } from '@/components/booking/BookingHelpContact';
import { useSwipe } from '@/hooks/useSwipe';

interface ServiceForAvailability {
  service: string;
  price: number;
}

export interface SchedulerSlot extends RecommendedSlot {}

interface SmartSchedulerProps {
  services: ServiceForAvailability[];
  customerAddress?: string;
  numStories?: number;
  selectedSlot: { startTime: string; technicianId: string } | null;
  onSelectSlot: (slot: SchedulerSlot) => void;
  horizonDays?: number;
  /** Narrower single-column layout for the customer booking column. */
  compact?: boolean;
  /** When set, shows a customer-facing "having trouble booking?" help block. */
  showHelpContact?: boolean;
  /** Link to the customer's approved bid, included in help messages. */
  bidLink?: string;
  /** Reference number included in help messages. */
  bidReference?: string;
  /** Customer name used to personalize help messages. */
  customerName?: string;
}

type BrowseMode = 'day' | 'week' | 'month';

function slotKey(s: { startTime: string; technicianId: string }) {
  return `${s.startTime}|${s.technicianId}`;
}

function durationLabel(minutes: number) {
  const hrs = Math.round((minutes / 60) * 10) / 10;
  return `${hrs} hr${hrs === 1 ? '' : 's'}`;
}

/**
 * Unified availability presenter used by BOTH the admin scheduling portal and
 * the customer booking flow. Surfaces the same labeled hierarchy everywhere:
 *   Best Recommended → Next Available → 5 More Options → Browse calendar.
 */
export function SmartScheduler({
  services,
  customerAddress,
  numStories,
  selectedSlot,
  onSelectSlot,
  horizonDays = 365,
  compact = false,
  showHelpContact = false,
  bidLink,
  bidReference,
  customerName,
}: SmartSchedulerProps) {
  const {
    bestRecommended,
    nextAvailable,
    rankedSlots,
    isLoadingRecommendations,
    fetchRecommendations,
    daySlots,
    isLoadingDaySlots,
    fetchDaySlots,
    fullyBookedDays,
    error,
    requiresAdminAction,
  } = useSmartAvailability({ services, customerAddress, numStories });

  const [preference, setPreference] = useState<TimePreference>('none');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseMode, setBrowseMode] = useState<BrowseMode>('week');
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week');
  const [browseDate, setBrowseDate] = useState<Date | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Auto-fetch on mount / when the service set or address changes.
  useEffect(() => {
    if (services.length === 0) return;
    setHasLoaded(true);
    fetchRecommendations(preference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRecommendations]);

  const handlePreference = (pref: TimePreference) => {
    setPreference(pref);
    fetchRecommendations(pref);
  };

  // "5 more" = ranked slots minus whatever is already shown as best/next.
  const moreOptions = useMemo(() => {
    const shown = new Set<string>();
    if (bestRecommended) shown.add(slotKey(bestRecommended));
    if (nextAvailable) shown.add(slotKey(nextAvailable));
    return rankedSlots.filter((s) => !shown.has(slotKey(s))).slice(0, 5);
  }, [rankedSlots, bestRecommended, nextAvailable]);

  const bestAndNextSame =
    bestRecommended && nextAvailable && slotKey(bestRecommended) === slotKey(nextAvailable);

  const isSelected = (s: { startTime: string; technicianId: string }) =>
    !!selectedSlot && slotKey(selectedSlot) === slotKey(s);

  const handleBrowseDate = (date: Date) => {
    setBrowseDate(date);
    fetchDaySlots(date);
  };

  const handleBrowseModeChange = (mode: BrowseMode) => {
    setBrowseMode(mode);
    if (mode === 'day') {
      const target = browseDate ?? new Date();
      setBrowseDate(target);
      fetchDaySlots(target);
    } else {
      setCalendarView(mode);
    }
  };

  const navigateDay = (dir: 'prev' | 'next') => {
    const base = browseDate ?? new Date();
    const target = addDays(base, dir === 'next' ? 1 : -1);
    setBrowseDate(target);
    fetchDaySlots(target);
  };

  const formattedDaySlots: TimeSlot[] = useMemo(
    () =>
      daySlots
        .filter((s) => {
          if (preference === 'none') return true;
          const h = parseISO(s.startTime).getHours();
          return preference === 'AM' ? h < 12 : h >= 12;
        })
        .map((s) => ({
        technicianId: s.technicianId,
        technicianName: s.technicianName,
        startTime: s.startTime,
        endTime: s.endTime,
        displayTime: s.displayTime,
        durationMinutes: s.durationMinutes,
        routeDensityScore: s.routeDensityScore,
        routeDensityLabel: s.routeDensityLabel,
      })),
    [daySlots, preference]
  );

  // ---- Error state ----
  const isAdminAction = requiresAdminAction || error?.includes('admin') || error?.includes('reconnect');
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {isAdminAction
            ? 'Our scheduling system is temporarily offline. Please try again shortly or call us to book.'
            : error}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sticky filter chips — narrow time slots while scrolling on mobile */}
      <SchedulerFilterChips
        preference={preference}
        onPreferenceChange={handlePreference}
        services={services}
        isLoading={isLoadingRecommendations}
      />

      {isLoadingRecommendations ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !bestRecommended ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No openings match these services right now. Try widening the time
            preference or browse the calendar below.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Best Recommended */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Best Recommended</h3>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Our top pick — fits your service and keeps the route efficient.
            </p>
            <SlotCard
              slot={bestRecommended}
              selected={isSelected(bestRecommended)}
              onSelect={onSelectSlot}
              variant="best"
            />
          </section>

          {/* Next Available (only if different from best) */}
          {nextAvailable && !bestAndNextSame && (
            <section className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-sm font-semibold">Next Available</h3>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Soonest opening large enough to fit your service.
              </p>
              <SlotCard
                slot={nextAvailable}
                selected={isSelected(nextAvailable)}
                onSelect={onSelectSlot}
                variant="next"
              />
            </section>
          )}

          {/* 5 More Options */}
          {moreOptions.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">More Available Times</h3>
                <span className="text-xs text-muted-foreground">
                  {moreOptions.length} option{moreOptions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                {moreOptions.map((slot) => (
                  <SlotCard
                    key={slotKey(slot)}
                    slot={slot}
                    selected={isSelected(slot)}
                    onSelect={onSelectSlot}
                    variant="more"
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Browse all appointments — day / week / month */}
      <Collapsible open={browseOpen} onOpenChange={setBrowseOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/40 rounded-lg transition-colors">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold">Browse all available appointments</p>
                  <p className="text-xs text-muted-foreground">
                    See every opening by day, week, or month.
                  </p>
                </div>
              </div>
              <ChevronDown
                className={cn('w-4 h-4 text-muted-foreground transition-transform', browseOpen && 'rotate-180')}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              {/* Day / Week / Month toggle */}
              <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
                {(['day', 'week', 'month'] as BrowseMode[]).map((mode) => (
                  <Button
                    key={mode}
                    variant={browseMode === mode ? 'default' : 'ghost'}
                    size="sm"
                    className="capitalize h-9 px-4 touch-manipulation"
                    onClick={() => handleBrowseModeChange(mode)}
                  >
                    {mode}
                  </Button>
                ))}
              </div>

              {browseMode === 'day' ? (
                <div
                  className="space-y-3"
                  {...useSwipe({
                    onSwipeLeft: () => navigateDay('next'),
                    onSwipeRight: () => navigateDay('prev'),
                  })}
                >
                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 sm:h-10 sm:w-10 touch-manipulation"
                      aria-label="Previous day"
                      onClick={() => navigateDay('prev')}
                    >
                      <ChevronLeft className="h-5 w-5 sm:h-4 sm:w-4" />
                    </Button>
                    <p className="font-semibold text-sm sm:text-base text-center">
                      {format(browseDate ?? new Date(), 'EEEE, MMMM d')}
                    </p>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 sm:h-10 sm:w-10 touch-manipulation"
                      aria-label="Next day"
                      onClick={() => navigateDay('next')}
                    >
                      <ChevronRight className="h-5 w-5 sm:h-4 sm:w-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-center sm:hidden">
                    Swipe left or right to change days
                  </p>
                  {isLoadingDaySlots ? (
                    <Skeleton className="h-32 w-full" />
                  ) : (
                    <TimeSlotList
                      slots={formattedDaySlots}
                      selectedSlot={(selectedSlot as TimeSlot) ?? null}
                      onSelectSlot={(s) => onSelectSlot(s as SchedulerSlot)}
                      selectedDate={browseDate ?? new Date()}
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <DateFirstCalendar
                    viewMode={calendarView}
                    onViewModeChange={(v) => {
                      setCalendarView(v);
                      setBrowseMode(v);
                    }}
                    selectedDate={browseDate}
                    onSelectDate={handleBrowseDate}
                    minDate={new Date()}
                    maxDate={addDays(new Date(), horizonDays)}
                    fullyBookedDays={fullyBookedDays}
                    isLoadingSlots={isLoadingDaySlots}
                  />
                  {browseDate && (
                    <div className="pt-2 border-t">
                      {isLoadingDaySlots ? (
                        <Skeleton className="h-32 w-full" />
                      ) : (
                        <TimeSlotList
                          slots={formattedDaySlots}
                          selectedSlot={(selectedSlot as TimeSlot) ?? null}
                          onSelectSlot={(s) => onSelectSlot(s as SchedulerSlot)}
                          selectedDate={browseDate}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {showHelpContact && (
        <BookingHelpContact
          bidLink={bidLink}
          bidReference={bidReference}
          customerName={customerName}
          variant="scheduling"
        />
      )}
    </div>
  );
}

/* ------------------------- Sticky filter chips ------------------------- */

const TIME_CHIPS: Array<{ value: TimePreference; label: string; icon: typeof Sun }> = [
  { value: 'none', label: 'Any time', icon: Clock },
  { value: 'AM', label: 'Morning', icon: Sun },
  { value: 'PM', label: 'Afternoon', icon: Moon },
];

function SchedulerFilterChips({
  preference,
  onPreferenceChange,
  services,
  isLoading,
}: {
  preference: TimePreference;
  onPreferenceChange: (p: TimePreference) => void;
  services: ServiceForAvailability[];
  isLoading?: boolean;
}) {
  const serviceNames = services.map((s) => s.service).filter(Boolean);
  return (
    <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/50">
      {/* Time of day */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        <span className="text-[11px] font-medium text-muted-foreground shrink-0">Time</span>
        {TIME_CHIPS.map(({ value, label, icon: Icon }) => {
          const active = preference === value;
          return (
            <button
              key={value}
              type="button"
              disabled={isLoading}
              onClick={() => onPreferenceChange(value)}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 h-9 text-xs font-medium touch-manipulation active:scale-[0.97] transition-colors disabled:opacity-50',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-border hover:bg-accent/50'
              )}
              aria-pressed={active}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Service type context — what these openings are for */}
      {serviceNames.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 mt-2">
          <span className="text-[11px] font-medium text-muted-foreground shrink-0">For</span>
          {serviceNames.map((name) => (
            <Badge
              key={name}
              variant="secondary"
              className="shrink-0 h-7 px-2.5 text-[11px] font-medium whitespace-nowrap"
            >
              {name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Slot card ----------------------------- */

function reasonBadge(slot: RecommendedSlot, variant: 'best' | 'next' | 'more') {
  if (variant === 'best') {
    return (
      <span className="text-[10px] font-medium text-primary-foreground bg-primary px-2 py-0.5 rounded-full inline-flex items-center gap-1">
        <Star className="w-3 h-3 fill-current" /> Top Pick
      </span>
    );
  }
  if (variant === 'next') {
    return (
      <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
        <Zap className="w-3 h-3" /> Soonest
      </span>
    );
  }
  if (slot.gapEfficiencyLabel) {
    return (
      <span className="text-[10px] font-medium text-primary inline-flex items-center gap-0.5">
        <Zap className="w-3 h-3" /> {slot.gapEfficiencyLabel}
      </span>
    );
  }
  if (slot.routeDensityLabel) {
    return (
      <span className="text-[10px] font-medium text-primary inline-flex items-center gap-0.5">
        <Route className="w-3 h-3" /> {slot.routeDensityLabel}
      </span>
    );
  }
  return null;
}

function SlotCard({
  slot,
  selected,
  onSelect,
  variant,
}: {
  slot: RecommendedSlot;
  selected: boolean;
  onSelect: (s: SchedulerSlot) => void;
  variant: 'best' | 'next' | 'more';
}) {
  const date = parseISO(slot.startTime);
  const isTeam = slot.isTeamJob;
  return (
    <button
      onClick={() => onSelect(slot)}
      className={cn(
        'w-full p-3 rounded-lg text-left border transition-colors',
        selected
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : variant === 'best'
            ? 'border-primary/60 bg-primary/5 hover:bg-primary/10'
            : variant === 'next'
              ? 'border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-100/40'
              : 'border-border bg-card hover:bg-accent/50'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('font-semibold', variant === 'more' ? 'text-sm' : 'text-base')}>
              {slot.displayTime || format(date, 'h:mm a')}
            </span>
            <span className="text-xs text-muted-foreground">{format(date, 'EEE, MMM d')}</span>
            {!selected && reasonBadge(slot, variant)}
            {isTeam && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0.5 h-auto bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
              >
                <Users className="w-3 h-3 mr-0.5" /> Team Job
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 flex-wrap">
            {isTeam ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
            <span>{slot.technicianName}</span>
            <span>•</span>
            <Clock className="w-3 h-3" />
            <span>Fits {durationLabel(slot.durationMinutes)}</span>
          </div>
        </div>
        <div className="flex-shrink-0">
          {selected ? (
            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="w-3 h-3 text-primary-foreground" />
            </div>
          ) : (
            <div
              className={cn(
                'w-5 h-5 rounded-full border',
                variant === 'best' ? 'border-primary/50' : 'border-muted-foreground/30'
              )}
            />
          )}
        </div>
      </div>
    </button>
  );
}