import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { RefreshCw, TrendingUp, Users, DollarSign, Megaphone } from 'lucide-react';
import { format, parseISO, subDays, startOfDay, endOfDay } from 'date-fns';
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
  total: number;
  utm_params_json: UtmParams | null;
  created_at: string;
  status: string;
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  '#8884d8',
  '#82ca9d',
  '#ffc658',
];

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

interface ChartData {
  name: string;
  bookings: number;
  revenue: number;
}

export function MarketingAnalytics() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  const fetchBookings = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('bookings')
        .select('id, total, utm_params_json, created_at, status')
        .order('created_at', { ascending: true });

      if (dateRange !== 'all') {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const startDate = startOfDay(subDays(new Date(), days)).toISOString();
        query = query.gte('created_at', startDate);
      }

      const { data, error } = await query;
      if (error) throw error;
      setBookings((data as Booking[]) || []);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      toast.error('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [dateRange]);

  // Aggregate data by source
  const sourceData = useMemo(() => {
    const grouped: Record<string, { bookings: number; revenue: number }> = {};
    bookings.forEach(b => {
      const source = b.utm_params_json?.utm_source || 'Direct';
      if (!grouped[source]) grouped[source] = { bookings: 0, revenue: 0 };
      grouped[source].bookings++;
      grouped[source].revenue += b.total;
    });
    return Object.entries(grouped)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.bookings - a.bookings);
  }, [bookings]);

  // Aggregate data by medium
  const mediumData = useMemo(() => {
    const grouped: Record<string, { bookings: number; revenue: number }> = {};
    bookings.forEach(b => {
      const medium = b.utm_params_json?.utm_medium || 'None';
      if (!grouped[medium]) grouped[medium] = { bookings: 0, revenue: 0 };
      grouped[medium].bookings++;
      grouped[medium].revenue += b.total;
    });
    return Object.entries(grouped)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.bookings - a.bookings);
  }, [bookings]);

  // Aggregate data by campaign
  const campaignData = useMemo(() => {
    const grouped: Record<string, { bookings: number; revenue: number }> = {};
    bookings.forEach(b => {
      const campaign = b.utm_params_json?.utm_campaign || 'None';
      if (!grouped[campaign]) grouped[campaign] = { bookings: 0, revenue: 0 };
      grouped[campaign].bookings++;
      grouped[campaign].revenue += b.total;
    });
    return Object.entries(grouped)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 10); // Top 10 campaigns
  }, [bookings]);

  // Aggregate data by preset
  const presetData = useMemo(() => {
    const grouped: Record<string, { bookings: number; revenue: number }> = {};
    bookings.forEach(b => {
      const preset = b.utm_params_json?.preset || 'None';
      if (!grouped[preset]) grouped[preset] = { bookings: 0, revenue: 0 };
      grouped[preset].bookings++;
      grouped[preset].revenue += b.total;
    });
    return Object.entries(grouped)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.bookings - a.bookings);
  }, [bookings]);

  // Time series data (daily)
  const timeSeriesData = useMemo(() => {
    const grouped: Record<string, { date: string; total: number; attributed: number; revenue: number }> = {};
    bookings.forEach(b => {
      const date = format(parseISO(b.created_at), 'MMM d');
      if (!grouped[date]) grouped[date] = { date, total: 0, attributed: 0, revenue: 0 };
      grouped[date].total++;
      grouped[date].revenue += b.total;
      if (b.utm_params_json?.utm_source) {
        grouped[date].attributed++;
      }
    });
    return Object.values(grouped);
  }, [bookings]);

  // Time series by source (for trend analysis)
  const sourceTimeSeriesData = useMemo(() => {
    const allSources = new Set<string>();
    const grouped: Record<string, Record<string, number>> = {};
    
    bookings.forEach(b => {
      const date = format(parseISO(b.created_at), 'MMM d');
      const source = b.utm_params_json?.utm_source || 'Direct';
      allSources.add(source);
      if (!grouped[date]) grouped[date] = {};
      grouped[date][source] = (grouped[date][source] || 0) + 1;
    });
    
    return {
      data: Object.entries(grouped).map(([date, sources]) => ({ date, ...sources })),
      sources: Array.from(allSources).slice(0, 6) // Top 6 sources for readability
    };
  }, [bookings]);

  // Time series by medium
  const mediumTimeSeriesData = useMemo(() => {
    const allMediums = new Set<string>();
    const grouped: Record<string, Record<string, number>> = {};
    
    bookings.forEach(b => {
      const date = format(parseISO(b.created_at), 'MMM d');
      const medium = b.utm_params_json?.utm_medium || 'None';
      allMediums.add(medium);
      if (!grouped[date]) grouped[date] = {};
      grouped[date][medium] = (grouped[date][medium] || 0) + 1;
    });
    
    return {
      data: Object.entries(grouped).map(([date, mediums]) => ({ date, ...mediums })),
      mediums: Array.from(allMediums).slice(0, 6)
    };
  }, [bookings]);

  // Time series by campaign
  const campaignTimeSeriesData = useMemo(() => {
    // Get top campaigns by volume first
    const campaignCounts: Record<string, number> = {};
    bookings.forEach(b => {
      const campaign = b.utm_params_json?.utm_campaign;
      if (campaign) {
        campaignCounts[campaign] = (campaignCounts[campaign] || 0) + 1;
      }
    });
    const topCampaigns = Object.entries(campaignCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    
    const grouped: Record<string, Record<string, number>> = {};
    bookings.forEach(b => {
      const date = format(parseISO(b.created_at), 'MMM d');
      const campaign = b.utm_params_json?.utm_campaign;
      if (campaign && topCampaigns.includes(campaign)) {
        if (!grouped[date]) grouped[date] = {};
        grouped[date][campaign] = (grouped[date][campaign] || 0) + 1;
      }
    });
    
    return {
      data: Object.entries(grouped).map(([date, campaigns]) => ({ date, ...campaigns })),
      campaigns: topCampaigns
    };
  }, [bookings]);

  // Revenue over time by source
  const revenueTimeSeriesData = useMemo(() => {
    const allSources = new Set<string>();
    const grouped: Record<string, Record<string, number>> = {};
    
    bookings.forEach(b => {
      const date = format(parseISO(b.created_at), 'MMM d');
      const source = b.utm_params_json?.utm_source || 'Direct';
      allSources.add(source);
      if (!grouped[date]) grouped[date] = {};
      grouped[date][source] = (grouped[date][source] || 0) + b.total;
    });
    
    return {
      data: Object.entries(grouped).map(([date, sources]) => ({ date, ...sources })),
      sources: Array.from(allSources).slice(0, 6)
    };
  }, [bookings]);

  // Summary stats
  const totalBookings = bookings.length;
  const totalRevenue = bookings.reduce((sum, b) => sum + b.total, 0);
  const attributedBookings = bookings.filter(b => b.utm_params_json?.utm_source).length;
  const attributionRate = totalBookings > 0 ? (attributedBookings / totalBookings) * 100 : 0;
  const avgOrderValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.name.includes('Revenue') ? formatPrice(entry.value) : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Header with date range selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Marketing Analytics</h2>
          <p className="text-sm text-muted-foreground">Track campaign performance and conversions</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-1">
            {(['7d', '30d', '90d', 'all'] as const).map((range) => (
              <Button
                key={range}
                variant={dateRange === range ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDateRange(range)}
                className="px-3"
              >
                {range === 'all' ? 'All' : range}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={fetchBookings} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Bookings</span>
            </div>
            <p className="text-2xl font-bold mt-1">{totalBookings}</p>
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
              <span className="text-sm text-muted-foreground">Attribution Rate</span>
            </div>
            <p className="text-2xl font-bold mt-1">{attributionRate.toFixed(1)}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Avg Order Value</span>
            </div>
            <p className="text-2xl font-bold mt-1">{formatPrice(avgOrderValue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      {timeSeriesData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Booking Trend</CardTitle>
            <CardDescription>Daily bookings over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="total" 
                    name="Total Bookings"
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="attributed" 
                    name="Attributed"
                    stroke="hsl(var(--chart-2))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--chart-2))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Grid */}
      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trends">Trends Over Time</TabsTrigger>
          <TabsTrigger value="source">By Source</TabsTrigger>
          <TabsTrigger value="medium">By Medium</TabsTrigger>
          <TabsTrigger value="campaign">By Campaign</TabsTrigger>
          <TabsTrigger value="preset">By Preset</TabsTrigger>
        </TabsList>

        {/* New Trends Tab */}
        <TabsContent value="trends" className="space-y-4">
          {/* Bookings by Source Over Time */}
          {sourceTimeSeriesData.data.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Bookings by Source Over Time</CardTitle>
                <CardDescription>Daily booking volume by traffic source</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sourceTimeSeriesData.data}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      {sourceTimeSeriesData.sources.map((source, idx) => (
                        <Line
                          key={source}
                          type="monotone"
                          dataKey={source}
                          name={source}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2}
                          dot={{ fill: COLORS[idx % COLORS.length], r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Revenue by Source Over Time */}
          {revenueTimeSeriesData.data.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Revenue by Source Over Time</CardTitle>
                <CardDescription>Daily revenue by traffic source</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={revenueTimeSeriesData.data}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis tickFormatter={(v) => `$${v}`} className="text-xs" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      {revenueTimeSeriesData.sources.map((source, idx) => (
                        <Line
                          key={source}
                          type="monotone"
                          dataKey={source}
                          name={source}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2}
                          dot={{ fill: COLORS[idx % COLORS.length], r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bookings by Medium Over Time */}
          {mediumTimeSeriesData.data.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Bookings by Medium Over Time</CardTitle>
                <CardDescription>Daily booking volume by traffic medium</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mediumTimeSeriesData.data}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      {mediumTimeSeriesData.mediums.map((medium, idx) => (
                        <Line
                          key={medium}
                          type="monotone"
                          dataKey={medium}
                          name={medium}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2}
                          dot={{ fill: COLORS[idx % COLORS.length], r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Campaign Performance Over Time */}
          {campaignTimeSeriesData.data.length > 1 && campaignTimeSeriesData.campaigns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Top Campaigns Over Time</CardTitle>
                <CardDescription>Daily booking volume for top 5 campaigns</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={campaignTimeSeriesData.data}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      {campaignTimeSeriesData.campaigns.map((campaign, idx) => (
                        <Line
                          key={campaign}
                          type="monotone"
                          dataKey={campaign}
                          name={campaign}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2}
                          dot={{ fill: COLORS[idx % COLORS.length], r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {sourceTimeSeriesData.data.length <= 1 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Not enough data to show trends.</p>
                <p className="text-sm mt-1">Need at least 2 days of booking data.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="source" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Bookings by Source</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sourceData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="bookings"
                      >
                        {sourceData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Revenue by Source</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourceData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tickFormatter={(v) => `$${v}`} className="text-xs" />
                      <YAxis dataKey="name" type="category" width={80} className="text-xs" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Source breakdown table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Source Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sourceData.map((item, idx) => (
                  <div key={item.name} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                      />
                      <span className="font-medium">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span>{item.bookings} bookings</span>
                      <span className="font-medium">{formatPrice(item.revenue)}</span>
                      <span className="text-muted-foreground">
                        AOV: {formatPrice(item.bookings > 0 ? item.revenue / item.bookings : 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="medium" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Bookings by Medium</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mediumData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="bookings" name="Bookings" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Revenue by Medium</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mediumData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis tickFormatter={(v) => `$${v}`} className="text-xs" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="campaign" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Campaign Performance (Top 10)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={campaignData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" />
                    <YAxis dataKey="name" type="category" width={120} className="text-xs" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="bookings" name="Bookings" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Campaign Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {campaignData.map((item, idx) => (
                  <div key={item.name} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{item.name}</Badge>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span>{item.bookings} bookings</span>
                      <span className="font-medium">{formatPrice(item.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preset" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Bookings by Service Preset</CardTitle>
                <CardDescription>Which pre-selected services convert best</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={presetData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="bookings"
                      >
                        {presetData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Preset Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {presetData.map((item, idx) => (
                    <div key={item.name} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <span className="font-medium">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <span>{item.bookings} bookings</span>
                        <span className="font-medium">{formatPrice(item.revenue)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {loading && (
        <div className="text-center py-8 text-muted-foreground">
          Loading analytics...
        </div>
      )}

      {!loading && bookings.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Megaphone className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No booking data available for the selected period.</p>
            <p className="text-sm mt-1">Bookings with UTM parameters will appear here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
