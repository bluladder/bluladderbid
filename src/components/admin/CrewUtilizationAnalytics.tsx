import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  BarChart3, 
  Clock, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle, 
  Calendar,
  Car,
  User,
  RefreshCw
} from 'lucide-react';
import { format, subDays, startOfWeek, endOfWeek, eachDayOfInterval, parseISO, isSameDay } from 'date-fns';

interface TechnicianUtilization {
  id: string;
  name: string;
  availableHours: number;
  bookedHours: number;
  estimatedDriveHours: number;
  workingHours: number;
  idleHours: number;
  utilizationPercent: number;
  jobCount: number;
  avgJobDuration: number;
}

interface DayUtilization {
  date: string;
  dayOfWeek: string;
  totalAvailableHours: number;
  totalBookedHours: number;
  utilizationPercent: number;
  jobCount: number;
  isUnderutilized: boolean;
  isOverloaded: boolean;
}

interface UtilizationSummary {
  totalAvailableHours: number;
  totalBookedHours: number;
  totalDriveHours: number;
  avgUtilization: number;
  totalJobs: number;
  underutilizedDays: number;
  overloadedDays: number;
}

type DateRange = '7d' | '14d' | '30d';

export function CrewUtilizationAnalytics() {
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [techUtilization, setTechUtilization] = useState<TechnicianUtilization[]>([]);
  const [dayUtilization, setDayUtilization] = useState<DayUtilization[]>([]);
  const [summary, setSummary] = useState<UtilizationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUtilizationData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const days = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : 30;
      const startDate = subDays(new Date(), days);
      const endDate = new Date();

      // Fetch technicians
      const { data: technicians, error: techError } = await supabase
        .from('technicians')
        .select('id, name, schedule_start_hour, schedule_end_hour, work_days')
        .eq('is_active', true);

      if (techError) throw techError;

      // Fetch bookings in date range
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, technician_id, scheduled_start, scheduled_end, duration_minutes, status')
        .gte('scheduled_start', startDate.toISOString())
        .lte('scheduled_start', endDate.toISOString())
        .in('status', ['confirmed', 'scheduled', 'completed', 'in_progress'])
        .eq('is_hidden', false);

      if (bookingsError) throw bookingsError;

      // Get all days in range
      const allDays = eachDayOfInterval({ start: startDate, end: endDate });

      // Calculate per-technician utilization
      const techStats: TechnicianUtilization[] = (technicians || []).map(tech => {
        const techBookings = (bookings || []).filter(b => b.technician_id === tech.id);
        
        // Calculate available hours based on schedule
        const workDays = (tech.work_days as number[]) || [1, 2, 3, 4, 5];
        const startHour = tech.schedule_start_hour || 9;
        const endHour = tech.schedule_end_hour || 17;
        const hoursPerDay = endHour - startHour;
        
        // Count work days in range
        const allDays = eachDayOfInterval({ start: startDate, end: endDate });
        const workDaysInRange = allDays.filter(d => workDays.includes(d.getDay())).length;
        const availableHours = workDaysInRange * hoursPerDay;
        
        // Calculate booked hours
        const bookedMinutes = techBookings.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);
        const bookedHours = bookedMinutes / 60;
        
        // Estimate drive time (rough: 20 min average between jobs)
        const estimatedDriveHours = (techBookings.length * 20) / 60;
        
        // Calculate working vs idle
        const workingHours = bookedHours + estimatedDriveHours;
        const idleHours = Math.max(0, availableHours - workingHours);
        
        const utilizationPercent = availableHours > 0 
          ? Math.round((workingHours / availableHours) * 100) 
          : 0;

        return {
          id: tech.id,
          name: tech.name,
          availableHours: Math.round(availableHours * 10) / 10,
          bookedHours: Math.round(bookedHours * 10) / 10,
          estimatedDriveHours: Math.round(estimatedDriveHours * 10) / 10,
          workingHours: Math.round(workingHours * 10) / 10,
          idleHours: Math.round(idleHours * 10) / 10,
          utilizationPercent,
          jobCount: techBookings.length,
          avgJobDuration: techBookings.length > 0 
            ? Math.round(bookedMinutes / techBookings.length) 
            : 0,
        };
      });

      setTechUtilization(techStats);

      // Calculate per-day utilization (reuse allDays from above)
      const dayStats: DayUtilization[] = allDays.map(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const dayOfWeek = format(day, 'EEEE');
        const isWorkDay = [1, 2, 3, 4, 5].includes(day.getDay()); // Simple work day check
        
        const dayBookings = (bookings || []).filter(b => {
          if (!b.scheduled_start) return false;
          return isSameDay(parseISO(b.scheduled_start), day);
        });
        
        // Total available hours (all techs combined)
        const totalAvailableHours = isWorkDay ? (technicians?.length || 1) * 8 : 0;
        
        // Booked hours
        const bookedMinutes = dayBookings.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);
        const totalBookedHours = bookedMinutes / 60;
        
        const utilizationPercent = totalAvailableHours > 0
          ? Math.round((totalBookedHours / totalAvailableHours) * 100)
          : 0;

        return {
          date: dayStr,
          dayOfWeek,
          totalAvailableHours: Math.round(totalAvailableHours * 10) / 10,
          totalBookedHours: Math.round(totalBookedHours * 10) / 10,
          utilizationPercent,
          jobCount: dayBookings.length,
          isUnderutilized: isWorkDay && utilizationPercent < 30,
          isOverloaded: utilizationPercent > 90,
        };
      });

      setDayUtilization(dayStats.filter(d => d.totalAvailableHours > 0));

      // Calculate summary
      const totalAvailableHours = techStats.reduce((sum, t) => sum + t.availableHours, 0);
      const totalBookedHours = techStats.reduce((sum, t) => sum + t.bookedHours, 0);
      const totalDriveHours = techStats.reduce((sum, t) => sum + t.estimatedDriveHours, 0);
      const totalJobs = techStats.reduce((sum, t) => sum + t.jobCount, 0);
      
      setSummary({
        totalAvailableHours: Math.round(totalAvailableHours * 10) / 10,
        totalBookedHours: Math.round(totalBookedHours * 10) / 10,
        totalDriveHours: Math.round(totalDriveHours * 10) / 10,
        avgUtilization: totalAvailableHours > 0 
          ? Math.round(((totalBookedHours + totalDriveHours) / totalAvailableHours) * 100)
          : 0,
        totalJobs,
        underutilizedDays: dayStats.filter(d => d.isUnderutilized).length,
        overloadedDays: dayStats.filter(d => d.isOverloaded).length,
      });

    } catch (err) {
      console.error('Failed to fetch utilization data:', err);
      setError('Failed to load utilization analytics');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUtilizationData();
  }, [dateRange]);

  const getUtilizationColor = (percent: number) => {
    if (percent < 30) return 'text-amber-600';
    if (percent > 90) return 'text-red-600';
    return 'text-green-600';
  };

  const getUtilizationBadge = (percent: number) => {
    if (percent < 30) return { label: 'Underutilized', variant: 'secondary' as const };
    if (percent > 90) return { label: 'Overloaded', variant: 'destructive' as const };
    return { label: 'Optimal', variant: 'default' as const };
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Crew Utilization Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
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
            <BarChart3 className="w-5 h-5" />
            Crew Utilization Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={fetchUtilizationData} className="mt-4">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Date Range Selector */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Crew Utilization Analytics
              </CardTitle>
              <CardDescription>
                Monitor crew efficiency and identify scheduling opportunities
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="14d">Last 14 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={fetchUtilizationData}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Utilization</p>
                  <p className={`text-2xl font-bold ${getUtilizationColor(summary.avgUtilization)}`}>
                    {summary.avgUtilization}%
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Jobs</p>
                  <p className="text-2xl font-bold">{summary.totalJobs}</p>
                </div>
                <Calendar className="w-8 h-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Booked Hours</p>
                  <p className="text-2xl font-bold">{summary.totalBookedHours}h</p>
                </div>
                <Clock className="w-8 h-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Drive Time (est.)</p>
                  <p className="text-2xl font-bold">{summary.totalDriveHours}h</p>
                </div>
                <Car className="w-8 h-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Insights Banner */}
      {summary && (summary.underutilizedDays > 0 || summary.overloadedDays > 0) && (
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              {summary.underutilizedDays > 0 && (
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-amber-600" />
                  <span className="text-sm">
                    <strong>{summary.underutilizedDays}</strong> underutilized day{summary.underutilizedDays !== 1 ? 's' : ''} 
                    <span className="text-muted-foreground"> — opportunity for more bookings</span>
                  </span>
                </div>
              )}
              {summary.overloadedDays > 0 && (
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-red-600" />
                  <span className="text-sm">
                    <strong>{summary.overloadedDays}</strong> overloaded day{summary.overloadedDays !== 1 ? 's' : ''}
                    <span className="text-muted-foreground"> — consider adding capacity</span>
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Technician Utilization */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="w-5 h-5" />
            Technician Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {techUtilization.map(tech => {
              const badge = getUtilizationBadge(tech.utilizationPercent);
              return (
                <div key={tech.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{tech.name}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <span className={`font-bold ${getUtilizationColor(tech.utilizationPercent)}`}>
                      {tech.utilizationPercent}%
                    </span>
                  </div>
                  <Progress value={tech.utilizationPercent} className="h-2" />
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>{tech.jobCount} jobs</span>
                    <span>{tech.bookedHours}h booked</span>
                    <span>{tech.estimatedDriveHours}h drive</span>
                    <span>{tech.idleHours}h idle</span>
                    {tech.avgJobDuration > 0 && (
                      <span>~{Math.round(tech.avgJobDuration / 60 * 10) / 10}h avg job</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Daily Utilization Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Daily Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {dayUtilization.slice(-14).map(day => (
              <div
                key={day.date}
                className={`
                  p-3 rounded-lg border text-center
                  ${day.isUnderutilized ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : ''}
                  ${day.isOverloaded ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : ''}
                  ${!day.isUnderutilized && !day.isOverloaded ? 'border-border' : ''}
                `}
              >
                <div className="text-xs text-muted-foreground">
                  {format(parseISO(day.date), 'EEE')}
                </div>
                <div className="font-medium text-sm">
                  {format(parseISO(day.date), 'MMM d')}
                </div>
                <div className={`text-lg font-bold ${getUtilizationColor(day.utilizationPercent)}`}>
                  {day.utilizationPercent}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {day.jobCount} job{day.jobCount !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Insights & Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            {summary && summary.avgUtilization < 50 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200">
                <TrendingDown className="w-5 h-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-200">Low overall utilization</p>
                  <p className="text-amber-700 dark:text-amber-300">
                    Consider increasing marketing spend or offering promotions to fill available slots.
                  </p>
                </div>
              </div>
            )}
            
            {summary && summary.avgUtilization > 80 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200">
                <TrendingUp className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">Strong utilization</p>
                  <p className="text-green-700 dark:text-green-300">
                    Your crew is well-utilized. Consider hiring or adjusting pricing if demand continues.
                  </p>
                </div>
              </div>
            )}
            
            {summary && summary.totalDriveHours > summary.totalBookedHours * 0.3 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200">
                <Car className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-200">High drive time ratio</p>
                  <p className="text-blue-700 dark:text-blue-300">
                    Drive time is {Math.round((summary.totalDriveHours / summary.totalBookedHours) * 100)}% of working time. 
                    The route-density feature will help optimize scheduling.
                  </p>
                </div>
              </div>
            )}
            
            {(!summary || summary.totalJobs === 0) && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted border">
                <AlertCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">No booking data</p>
                  <p className="text-muted-foreground">
                    Once bookings are scheduled, utilization metrics will appear here.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
