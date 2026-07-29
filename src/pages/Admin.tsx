import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useIsAdmin, useAuth } from '@/hooks/useAuth';
import { AdminLogin } from '@/components/admin/AdminLogin';
import { BookingsManager } from '@/components/admin/BookingsManager';
import { SchedulingPortal } from '@/components/admin/SchedulingPortal';
import { AnalyticsTabContent } from '@/components/admin/AnalyticsTabContent';
import { CrewTabContent } from '@/components/admin/CrewTabContent';
import { IntegrationsTabContent } from '@/components/admin/IntegrationsTabContent';
import { PricingTabContent } from '@/components/admin/PricingTabContent';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { LogOut, Home, ShieldX, Mail, FileBarChart } from 'lucide-react';
import { CustomerAccessLiveTestsPanel } from '@/components/admin/security/CustomerAccessLiveTestsPanel';
import { SecurityErrorBoundary } from '@/components/admin/security/SecurityErrorBoundary';
import { ConversationsTabContent } from '@/components/admin/conversations/ConversationsTabContent';
import { OpsHealthPanel } from '@/components/admin/ops/OpsHealthPanel';
import { OpsAlertsPanel } from '@/components/admin/ops/OpsAlertsPanel';
import { EmailSuppressionsPanel } from '@/components/admin/ops/EmailSuppressionsPanel';
import { CallRailDurabilityPanel } from '@/components/admin/ops/CallRailDurabilityPanel';
import { CampaignLaunchControlsPanel } from '@/components/admin/ops/CampaignLaunchControlsPanel';
import { LaunchDiagnosticsPanel } from '@/components/admin/ops/LaunchDiagnosticsPanel';
import { AdminSidebar, type AdminSection } from '@/components/admin/shell/AdminSidebar';
import { OverviewPanel } from '@/components/admin/shell/OverviewPanel';
import { ActionInboxPanel } from '@/components/admin/shell/ActionInboxPanel';
import { PlaceholderPanel } from '@/components/admin/shell/PlaceholderPanel';
import { useActionInboxCount } from '@/hooks/useActionInboxCount';

const TAB_TO_SECTION: Record<string, AdminSection> = {
  ops: 'ops',
  conversations: 'conversations',
  bookings: 'bookings',
  scheduling: 'scheduling',
  analytics: 'analytics',
  crew: 'crew',
  integrations: 'integrations',
  pricing: 'pricing',
  security: 'security',
};

function resolveSection(raw: string | null | undefined): AdminSection {
  if (!raw) return 'overview';
  if (TAB_TO_SECTION[raw]) return TAB_TO_SECTION[raw];
  return raw as AdminSection;
}

export default function Admin({ initialTab }: { initialTab?: string }) {
  const { isAdmin, loading, user } = useIsAdmin();
  const { signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState<AdminSection>(
    resolveSection(initialTab ?? searchParams.get('tab')),
  );
  const inboxCount = useActionInboxCount();

  useEffect(() => {
    if (initialTab) setSection(resolveSection(initialTab));
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

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar active={section} onSelect={setSection} inboxCount={inboxCount} />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border bg-card px-4 sticky top-0 z-40">
            <SidebarTrigger />
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-display font-semibold text-primary truncate">
                BluLadder Admin
              </h1>
            </div>
            <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[200px]">
              {user?.email}
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/">
                <Home className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">View Site</span>
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </header>

          <main className="flex-1 p-6 overflow-x-hidden">
            <div className="max-w-6xl mx-auto">
              {section === 'overview' && <OverviewPanel onNavigate={(s) => setSection(s as AdminSection)} />}
              {section === 'inbox' && <ActionInboxPanel />}
              {section === 'ops' && (
                <div className="space-y-6">
                  <LaunchDiagnosticsPanel />
                  <OpsHealthPanel />
                  <OpsAlertsPanel />
                  <CampaignLaunchControlsPanel />
                  <EmailSuppressionsPanel />
                  <CallRailDurabilityPanel />
                </div>
              )}
              {section === 'conversations' && <ConversationsTabContent />}
              {section === 'bookings' && <BookingsManager />}
              {section === 'scheduling' && <SchedulingPortal />}
              {section === 'analytics' && <AnalyticsTabContent />}
              {section === 'crew' && <CrewTabContent />}
              {section === 'integrations' && <IntegrationsTabContent />}
              {section === 'pricing' && <PricingTabContent />}
              {section === 'security' && (
                <SecurityErrorBoundary>
                  <CustomerAccessLiveTestsPanel />
                </SecurityErrorBoundary>
              )}
              {section === 'email-drafts' && (
                <PlaceholderPanel
                  icon={Mail}
                  title="Email Drafts"
                  phase="Phase 6 · Coming soon"
                  description="Ben's Gmail assistant will surface drafted replies here once ben@bluladder.com is connected. Nothing sends automatically — every reply lands here for review."
                />
              )}
              {section === 'reports' && (
                <PlaceholderPanel
                  icon={FileBarChart}
                  title="Reports"
                  phase="Phase 7 · Coming soon"
                  description="Weekly and monthly KPI reports with channel breakdown and period-over-period comparisons will publish here on schedule."
                />
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
