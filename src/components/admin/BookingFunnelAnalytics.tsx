import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
  Cell,
} from 'recharts';
import { Calendar, Clock, User, CheckCircle, TrendingDown, Sparkles, MapPin } from 'lucide-react';
import { format, parseISO, subDays, startOfDay } from 'date-fns';

interface StepEvent {
  id: string;
  session_id: string;
  step: 'calendar' | 'time' | 'info' | 'confirm';
  used_suggested_day: boolean;
  used_recommended_slot: boolean;
  created_at: string;
}

const STEP_CONFIG = {
  calendar: { label: 'Calendar View', icon: Calendar, color: 'hsl(var(--primary))' },
  time: { label: 'Time Selected', icon: Clock, color: 'hsl(var(--chart-2))' },
  info: { label: 'Info Form', icon: User, color: 'hsl(var(--chart-3))' },
  confirm: { label: 'Confirmed', icon: CheckCircle, color: 'hsl(var(--chart-4))' },
};

const STEPS_ORDER: Array<'calendar' | 'time' | 'info' | 'confirm'> = ['calendar', 'time', 'info', 'confirm'];

interface BookingFunnelAnalyticsProps {
  dateRange: '7d' | '30d' | '90d' | 'all';
}

export function BookingFunnelAnalytics({ dateRange }: BookingFunnelAnalyticsProps) {
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : null;
        const startDate = days ? startOfDay(subDays(new Date(), days)).toISOString() : null;

        const query = (supabase as any)
          .from('booking_step_events')
          .select('*')
          .order('created_at', { ascending: true });

        if (startDate) {
          query.gte('created_at', startDate);
        }

        const { data, error } = await query;

        if (error) throw error;
        setEvents(data || []);
      } catch (err) {
        console.error('Failed to fetch step events:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [dateRange]);

  // Group events by session and compute funnel metrics
  const funnelData = useMemo(() => {
    const sessionSteps: Record<string, Set<string>> = {};
    const sessionSuggestedDay: Record<string, boolean> = {};
    const sessionRecommendedSlot: Record<string, boolean> = {};

    events.forEach(e => {
      if (!sessionSteps[e.session_id]) {
        sessionSteps[e.session_id] = new Set();
      }
      sessionSteps[e.session_id].add(e.step);
      
      if (e.used_suggested_day) {
        sessionSuggestedDay[e.session_id] = true;
      }
      if (e.used_recommended_slot) {
        sessionRecommendedSlot[e.session_id] = true;
      }
    });

    const totalSessions = Object.keys(sessionSteps).length;
    
    const stepCounts = STEPS_ORDER.map(step => ({
      step,
      count: Object.values(sessionSteps).filter(steps => steps.has(step)).length,
    }));

    // Calculate dropoff rates
    return stepCounts.map((item, index) => {
      const prevCount = index === 0 ? totalSessions : stepCounts[index - 1].count;
      const dropoffRate = prevCount > 0 ? ((prevCount - item.count) / prevCount) * 100 : 0;
      const conversionRate = totalSessions > 0 ? (item.count / totalSessions) * 100 : 0;
      
      return {
        ...item,
        ...STEP_CONFIG[item.step],
        dropoffRate,
        conversionRate,
        fill: STEP_CONFIG[item.step].color,
      };
    });
  }, [events]);

  // Analyze suggested day / recommended slot impact
  const suggestionImpact = useMemo(() => {
    const sessionSteps: Record<string, Set<string>> = {};
    const sessionSuggestedDay: Record<string, boolean> = {};
    const sessionRecommendedSlot: Record<string, boolean> = {};

    events.forEach(e => {
      if (!sessionSteps[e.session_id]) {
        sessionSteps[e.session_id] = new Set();
      }
      sessionSteps[e.session_id].add(e.step);
      
      if (e.used_suggested_day) {
        sessionSuggestedDay[e.session_id] = true;
      }
      if (e.used_recommended_slot) {
        sessionRecommendedSlot[e.session_id] = true;
      }
    });

    // Sessions that reached calendar
    const calendarSessions = Object.entries(sessionSteps)
      .filter(([_, steps]) => steps.has('calendar'))
      .map(([id]) => id);

    // Confirmed sessions
    const confirmedSessions = Object.entries(sessionSteps)
      .filter(([_, steps]) => steps.has('confirm'))
      .map(([id]) => id);

    // Sessions with suggested day
    const suggestedDaySessions = calendarSessions.filter(id => sessionSuggestedDay[id]);
    const suggestedDayConfirmed = confirmedSessions.filter(id => sessionSuggestedDay[id]);
    
    // Sessions with recommended slot
    const recommendedSlotSessions = calendarSessions.filter(id => sessionRecommendedSlot[id]);
    const recommendedSlotConfirmed = confirmedSessions.filter(id => sessionRecommendedSlot[id]);

    // Without suggestions
    const noSuggestionSessions = calendarSessions.filter(id => !sessionSuggestedDay[id] && !sessionRecommendedSlot[id]);
    const noSuggestionConfirmed = confirmedSessions.filter(id => !sessionSuggestedDay[id] && !sessionRecommendedSlot[id]);

    return {
      suggestedDay: {
        total: suggestedDaySessions.length,
        converted: suggestedDayConfirmed.length,
        rate: suggestedDaySessions.length > 0 
          ? (suggestedDayConfirmed.length / suggestedDaySessions.length) * 100 
          : 0,
      },
      recommendedSlot: {
        total: recommendedSlotSessions.length,
        converted: recommendedSlotConfirmed.length,
        rate: recommendedSlotSessions.length > 0 
          ? (recommendedSlotConfirmed.length / recommendedSlotSessions.length) * 100 
          : 0,
      },
      noSuggestion: {
        total: noSuggestionSessions.length,
        converted: noSuggestionConfirmed.length,
        rate: noSuggestionSessions.length > 0 
          ? (noSuggestionConfirmed.length / noSuggestionSessions.length) * 100 
          : 0,
      },
    };
  }, [events]);

  // Daily trend data
  const trendData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};

    events.forEach(e => {
      const date = format(parseISO(e.created_at), 'MMM d');
      if (!byDate[date]) {
        byDate[date] = { calendar: 0, time: 0, info: 0, confirm: 0 };
      }
      byDate[date][e.step]++;
    });

    return Object.entries(byDate).map(([date, steps]) => ({
      date,
      ...steps,
    }));
  }, [events]);

  const totalSessions = funnelData[0]?.count || 0;
  const confirmedSessions = funnelData.find(f => f.step === 'confirm')?.count || 0;
  const overallConversion = totalSessions > 0 ? (confirmedSessions / totalSessions) * 100 : 0;

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5" />
            Booking Flow Funnel
          </CardTitle>
          <CardDescription>No booking step data available yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Step tracking data will appear here once customers start using the booking flow.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {funnelData.map((item, index) => {
          const Icon = item.icon;
          return (
            <Card key={item.step}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                </div>
                <p className="text-2xl font-bold">{item.count}</p>
                {index > 0 && item.dropoffRate > 0 && (
                  <p className="text-xs text-destructive mt-1">
                    -{item.dropoffRate.toFixed(1)}% dropoff
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Funnel Visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5" />
            Booking Flow Funnel
          </CardTitle>
          <CardDescription>
            Overall conversion: {overallConversion.toFixed(1)}% ({confirmedSessions} of {totalSessions} sessions)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="label" type="category" width={100} />
                <Tooltip 
                  formatter={(value: number, name: string) => [value, name === 'count' ? 'Sessions' : name]}
                  contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                />
                <Bar dataKey="count" name="Sessions" radius={[0, 4, 4, 0]}>
                  {funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Suggestion Impact Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Route Optimization Impact
          </CardTitle>
          <CardDescription>
            Conversion rates for sessions using suggested days and recommended slots
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            {/* Suggested Day */}
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-primary" />
                <span className="font-medium">Suggested Days</span>
              </div>
              <p className="text-3xl font-bold text-primary">
                {suggestionImpact.suggestedDay.rate.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {suggestionImpact.suggestedDay.converted} of {suggestionImpact.suggestedDay.total} converted
              </p>
            </div>

            {/* Recommended Slot */}
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-chart-2" />
                <span className="font-medium">Recommended Slots</span>
              </div>
              <p className="text-3xl font-bold" style={{ color: 'hsl(var(--chart-2))' }}>
                {suggestionImpact.recommendedSlot.rate.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {suggestionImpact.recommendedSlot.converted} of {suggestionImpact.recommendedSlot.total} converted
              </p>
            </div>

            {/* No Suggestions */}
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">No Suggestions Used</span>
              </div>
              <p className="text-3xl font-bold text-muted-foreground">
                {suggestionImpact.noSuggestion.rate.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {suggestionImpact.noSuggestion.converted} of {suggestionImpact.noSuggestion.total} converted
              </p>
            </div>
          </div>

          {/* Insight */}
          {suggestionImpact.suggestedDay.total > 0 || suggestionImpact.recommendedSlot.total > 0 ? (
            <div className="mt-4 p-3 rounded-lg border bg-card">
              <p className="text-sm">
                {suggestionImpact.suggestedDay.rate > suggestionImpact.noSuggestion.rate ? (
                  <span className="text-green-600">
                    ✓ Suggested days improve conversion by {(suggestionImpact.suggestedDay.rate - suggestionImpact.noSuggestion.rate).toFixed(1)} percentage points
                  </span>
                ) : suggestionImpact.noSuggestion.total > 0 ? (
                  <span className="text-amber-600">
                    ⚠ Suggested days not yet showing improvement over baseline
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Collecting baseline data for comparison
                  </span>
                )}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Daily Trend */}
      {trendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Step Activity</CardTitle>
            <CardDescription>Step events over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Bar dataKey="calendar" name="Calendar" stackId="a" fill={STEP_CONFIG.calendar.color} />
                  <Bar dataKey="time" name="Time" stackId="a" fill={STEP_CONFIG.time.color} />
                  <Bar dataKey="info" name="Info" stackId="a" fill={STEP_CONFIG.info.color} />
                  <Bar dataKey="confirm" name="Confirm" stackId="a" fill={STEP_CONFIG.confirm.color} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
