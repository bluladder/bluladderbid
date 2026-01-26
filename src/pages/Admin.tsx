import { useState } from 'react';
import { useIsAdmin, useAuth } from '@/hooks/useAuth';
import { AdminLogin } from '@/components/admin/AdminLogin';
import { PricingEditor } from '@/components/admin/PricingEditor';
import { PricingPreview } from '@/components/admin/PricingPreview';
import { ScenarioCompare } from '@/components/admin/ScenarioCompare';
import { DiscountCodesManager } from '@/components/admin/DiscountCodesManager';
import { JobberIntegration } from '@/components/admin/JobberIntegration';
import { TechnicianManager } from '@/components/admin/TechnicianManager';
import { BusinessHoursSettings } from '@/components/admin/BusinessHoursSettings';
import { DriveTimeSettings } from '@/components/admin/DriveTimeSettings';
import { BookingsManager } from '@/components/admin/BookingsManager';
import { MarketingAnalytics } from '@/components/admin/MarketingAnalytics';
import { AdminAvailabilityViewer } from '@/components/admin/AdminAvailabilityViewer';
import { CrewUtilizationAnalytics } from '@/components/admin/CrewUtilizationAnalytics';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogOut, Home, ShieldX, Settings, Calculator, GitCompare, Tag, Calendar, ClipboardList, BarChart3, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Admin() {
  const { isAdmin, loading, user } = useIsAdmin();
  const { signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('bookings');

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
              <p className="text-xs text-muted-foreground">Pricing Management</p>
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
        <div className="max-w-5xl mx-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-8 mb-6">
              <TabsTrigger value="bookings" className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                <span className="hidden sm:inline">Bookings</span>
              </TabsTrigger>
              <TabsTrigger value="utilization" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Crew</span>
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Analytics</span>
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex items-center gap-2">
                <Calculator className="w-4 h-4" />
                <span className="hidden sm:inline">Preview</span>
              </TabsTrigger>
              <TabsTrigger value="compare" className="flex items-center gap-2">
                <GitCompare className="w-4 h-4" />
                <span className="hidden sm:inline">Compare</span>
              </TabsTrigger>
              <TabsTrigger value="discounts" className="flex items-center gap-2">
                <Tag className="w-4 h-4" />
                <span className="hidden sm:inline">Discounts</span>
              </TabsTrigger>
              <TabsTrigger value="booking" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Settings</span>
              </TabsTrigger>
              <TabsTrigger value="config" className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Pricing</span>
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="bookings">
              <BookingsManager />
            </TabsContent>
            
            <TabsContent value="utilization">
              <CrewUtilizationAnalytics />
            </TabsContent>
            
            <TabsContent value="analytics">
              <MarketingAnalytics />
            </TabsContent>
            
            <TabsContent value="preview">
              <PricingPreview />
            </TabsContent>
            
            <TabsContent value="compare">
              <ScenarioCompare />
            </TabsContent>
            
            <TabsContent value="discounts">
              <DiscountCodesManager />
            </TabsContent>
            
            <TabsContent value="booking" className="space-y-6">
              <BusinessHoursSettings />
              <DriveTimeSettings />
              <AdminAvailabilityViewer 
                services={[
                  { service: 'windows_exterior', price: 200 },
                ]}
              />
              <JobberIntegration />
              <TechnicianManager />
            </TabsContent>
            
            <TabsContent value="config">
              <PricingEditor />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
