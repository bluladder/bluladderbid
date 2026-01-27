import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsAdmin, useAuth } from '@/hooks/useAuth';
import { AdminLogin } from '@/components/admin/AdminLogin';
import { PricingEditor } from '@/components/admin/PricingEditor';
import { PricingPreview } from '@/components/admin/PricingPreview';
import { ScenarioCompare } from '@/components/admin/ScenarioCompare';
import { DiscountCodesManager } from '@/components/admin/DiscountCodesManager';
import { JobberIntegration } from '@/components/admin/JobberIntegration';
import { TechnicianManager } from '@/components/admin/TechnicianManager';
import { DriveTimeSettings } from '@/components/admin/DriveTimeSettings';
import { BookingSettings } from '@/components/admin/BookingSettings';
import { BookingsManager } from '@/components/admin/BookingsManager';
import { MarketingAnalytics } from '@/components/admin/MarketingAnalytics';
import { CrewUtilizationAnalytics } from '@/components/admin/CrewUtilizationAnalytics';
import { EmbedCodeManager } from '@/components/admin/EmbedCodeManager';
import { SchedulingPortal } from '@/components/admin/SchedulingPortal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogOut, Home, ShieldX, ClipboardList, Phone, BarChart3, Users, Plug, DollarSign } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Admin({ initialTab }: { initialTab?: string }) {
  const { isAdmin, loading, user } = useIsAdmin();
  const { signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(initialTab || searchParams.get('tab') || 'bookings');

  // Update tab when initialTab prop changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Show login if not authenticated
  if (!user && !loading) {
    return <AdminLogin />;
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking access...</p>
        </div>
      </div>
    );
  }

  // Show access denied if authenticated but not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <ShieldX className="w-12 h-12 mx-auto text-destructive mb-2" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have admin privileges. Contact an administrator to request access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Signed in as: {user?.email}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" asChild className="flex-1">
                <Link to="/">
                  <Home className="w-4 h-4 mr-2" />
                  Go Home
                </Link>
              </Button>
              <Button variant="outline" onClick={() => signOut()} className="flex-1">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show admin panel
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-display font-bold text-primary">
                BluLadder Admin
              </h1>
              <p className="text-xs text-muted-foreground">Management Portal</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">{user?.email}</span>
              <Button variant="outline" size="sm" asChild>
                <Link to="/">
                  <Home className="w-4 h-4 mr-2" />
                  View Site
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="max-w-6xl mx-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-6 mb-6">
              <TabsTrigger value="bookings" className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                <span className="hidden sm:inline">Bookings</span>
              </TabsTrigger>
              <TabsTrigger value="scheduling" className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                <span className="hidden sm:inline">Scheduling</span>
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Analytics</span>
              </TabsTrigger>
              <TabsTrigger value="crew" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Crew</span>
              </TabsTrigger>
              <TabsTrigger value="integrations" className="flex items-center gap-2">
                <Plug className="w-4 h-4" />
                <span className="hidden sm:inline">Integrations</span>
              </TabsTrigger>
              <TabsTrigger value="pricing" className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                <span className="hidden sm:inline">Pricing</span>
              </TabsTrigger>
            </TabsList>
            
            {/* Bookings Tab - View/manage all bookings */}
            <TabsContent value="bookings">
              <BookingsManager />
            </TabsContent>
            
            {/* Scheduling Tab - Phone bookings, quote generation, availability */}
            <TabsContent value="scheduling">
              <SchedulingPortal />
            </TabsContent>
            
            {/* Analytics Tab - Trends, success rates, campaign performance */}
            <TabsContent value="analytics" className="space-y-6">
              <MarketingAnalytics />
              <CrewUtilizationAnalytics />
            </TabsContent>
            
            {/* Crew Tab - Technician config, availability, hours, locations */}
            <TabsContent value="crew" className="space-y-6">
              <TechnicianManager />
              <DriveTimeSettings />
              <BookingSettings />
            </TabsContent>
            
            {/* Integrations Tab - Jobber + Website embeds/links */}
            <TabsContent value="integrations" className="space-y-6">
              <JobberIntegration />
              <EmbedCodeManager />
            </TabsContent>
            
            {/* Pricing Tab - Pricing config, scenarios, discounts */}
            <TabsContent value="pricing" className="space-y-6">
              <PricingEditor />
              <PricingPreview />
              <ScenarioCompare />
              <DiscountCodesManager />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
