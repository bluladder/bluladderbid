import { useState } from 'react';
import { TrendingUp, Users, Target, ChevronDown, ChevronUp, LineChart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MarketingAnalytics } from './MarketingAnalytics';
import { CrewUtilizationAnalytics } from './CrewUtilizationAnalytics';
import { ConversionAnalyticsPanel } from './analytics/ConversionAnalyticsPanel';

export function AnalyticsTabContent() {
  const [activeSection, setActiveSection] = useState('marketing');

  return (
    <div className="space-y-6">
      {/* Quick Navigation */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={activeSection === 'marketing' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('marketing')}
            >
              <Target className="w-3.5 h-3.5 mr-1.5" />
              Marketing & Conversions
            </Badge>
            <Badge
              variant={activeSection === 'crew' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('crew')}
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Crew Utilization
            </Badge>
            <Badge
              variant={activeSection === 'conversion' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('conversion')}
            >
              <LineChart className="w-3.5 h-3.5 mr-1.5" />
              Conversion Analytics
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Marketing Analytics */}
      {activeSection === 'marketing' && (
        <MarketingAnalytics />
      )}

      {/* Crew Utilization */}
      {activeSection === 'crew' && (
        <CrewUtilizationAnalytics />
      )}

      {/* Conversion Analytics — funnel, outcomes, reviews, gaps, model comparison */}
      {activeSection === 'conversion' && (
        <ConversionAnalyticsPanel />
      )}
    </div>
  );
}
