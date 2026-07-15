import { useState } from 'react';
import { Users, Settings2, Car, Truck, Scale, ChevronDown, ChevronUp, CalendarOff, ShieldCheck, CalendarDays, Info } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { TechnicianManager } from './TechnicianManager';
import { EligibilityRulesManager } from './EligibilityRulesManager';
import { BigJobSettingsEditor } from './BigJobSettingsEditor';
import { DriveTimeSettings } from './DriveTimeSettings';
import { BookingSettings } from './BookingSettings';
import { ScheduleBlocksManager } from './ScheduleBlocksManager';
import { AdminRoleManager } from './AdminRoleManager';
import { AdminScheduleCalendar } from './AdminScheduleCalendar';
import { ScheduleSourceIndicator } from './ScheduleSourceIndicator';
import { BigJobExplainer } from './BigJobExplainer';
import { BookingImpactWarning } from './BookingImpactWarning';
import { CrewRolesPanel } from './CrewRolesPanel';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';

export function CrewTabContent() {
  const { canEditCrewRules, isReadOnly, level } = useAdminPermissions();
  const [activeSection, setActiveSection] = useState('technicians');
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-6">
      {/* Quick Navigation */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={activeSection === 'technicians' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('technicians')}
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Technicians
            </Badge>
            <Badge
              variant={activeSection === 'crew_roles' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('crew_roles')}
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
              Crew Roles
            </Badge>
            <Badge
              variant={activeSection === 'eligibility' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('eligibility')}
            >
              <Scale className="w-3.5 h-3.5 mr-1.5" />
              Eligibility Rules
            </Badge>
            <Badge
              variant={activeSection === 'scheduling' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('scheduling')}
            >
              <Settings2 className="w-3.5 h-3.5 mr-1.5" />
              Scheduling
            </Badge>
            <Badge
              variant={activeSection === 'calendar' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('calendar')}
            >
              <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
              Schedule View
            </Badge>
            <Badge
              variant={activeSection === 'blocks' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('blocks')}
            >
              <CalendarOff className="w-3.5 h-3.5 mr-1.5" />
              Time Off
            </Badge>
            {(level === 'owner_admin' || level === 'admin') && (
              <Badge
                variant={activeSection === 'roles' ? 'default' : 'outline'}
                className="cursor-pointer px-3 py-1.5"
                onClick={() => setActiveSection('roles')}
              >
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                Admin Roles
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Technicians Section */}
      {activeSection === 'technicians' && (
        <div className="space-y-4">
          <TechnicianManager />
        </div>
      )}

      {/* Crew Roles */}
      {activeSection === 'crew_roles' && (
        <div className="space-y-4">
          <CrewRolesPanel />
        </div>
      )}

      {/* Eligibility Rules Section */}
      {activeSection === 'eligibility' && (
        <div className="space-y-4">
          <EligibilityRulesManager />
        </div>
      )}

      {/* Scheduling Section */}
      {activeSection === 'scheduling' && (
        <div className="space-y-6">
          {/* Schedule Source Info */}
          <ScheduleSourceIndicator isConnected={true} />
          
          {/* Big Job Logic Explainer - Read-only summary */}
          <BigJobExplainer />
          
          {/* Primary Settings - Always visible */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Truck className="w-5 h-5 text-primary" />
                Scheduling Configuration
              </CardTitle>
              <CardDescription>
                Core settings that affect how appointments are scheduled
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BookingSettings />
            </CardContent>
          </Card>

          {/* Advanced Settings - Collapsed by default */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2 border-t border-b border-dashed py-3 my-2">
                <Settings2 className="w-4 h-4" />
                {showAdvanced ? 'Hide' : 'Show'} Advanced Scheduling Rules
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-6 pt-4">
                {/* Warning about advanced settings */}
                <BookingImpactWarning 
                  message="Changes to these settings directly affect customer booking behavior. Review carefully before saving."
                />
                <DriveTimeSettings />
                <BigJobSettingsEditor />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Schedule Calendar View */}
      {activeSection === 'calendar' && (
        <AdminScheduleCalendar />
      )}

      {/* Time Off / Schedule Blocks Section */}
      {activeSection === 'blocks' && (
        <div className="space-y-4">
          <ScheduleBlocksManager />
        </div>
      )}

      {/* Admin Roles Section (Owner only) */}
      {activeSection === 'roles' && (level === 'owner_admin' || level === 'admin') && (
        <div className="space-y-4">
          <AdminRoleManager />
        </div>
      )}
    </div>
  );
}
