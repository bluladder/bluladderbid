import { useState } from 'react';
import { Link2, Code, RefreshCw, ChevronDown, ChevronUp, ExternalLink, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JobberIntegration } from './JobberIntegration';
import { EmbedCodeManager } from './EmbedCodeManager';
import { SmsCampaignManager } from './sms/SmsCampaignManager';
import { SmsMessageLog } from './sms/SmsMessageLog';
import { SmsOptOutManager } from './sms/SmsOptOutManager';

export function IntegrationsTabContent() {
  const [activeSection, setActiveSection] = useState('jobber');

  return (
    <div className="space-y-6">
      {/* Quick Navigation */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={activeSection === 'jobber' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('jobber')}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Jobber Sync
            </Badge>
            <Badge
              variant={activeSection === 'embed' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('embed')}
            >
              <Code className="w-3.5 h-3.5 mr-1.5" />
              Website Embed
            </Badge>
            <Badge
              variant={activeSection === 'sms' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('sms')}
            >
              <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
              Text Messaging
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Jobber Integration */}
      {activeSection === 'jobber' && (
        <div className="space-y-4">
          <JobberIntegration />
          
          {/* Helper Info */}
          <Card className="bg-blue-50/50 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-800/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <Link2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    How Jobber Sync Works
                  </h4>
                  <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
                    <li>Schedule data syncs automatically every 5 minutes for near-term dates</li>
                    <li>Far-term dates sync daily in background batches</li>
                    <li>Webhooks provide real-time updates for job changes</li>
                    <li>Manual sync available if you need immediate updates</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Embed Code Manager */}
      {activeSection === 'embed' && (
        <div className="space-y-4">
          <EmbedCodeManager />
          
          {/* Helper Info */}
          <Card className="bg-green-50/50 border-green-200/50 dark:bg-green-950/20 dark:border-green-800/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/50">
                  <Code className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-green-900 dark:text-green-100">
                    Embedding Tips
                  </h4>
                  <ul className="text-xs text-green-700 dark:text-green-300 space-y-1 list-disc list-inside">
                    <li>Use iframe embeds for full booking flow integration</li>
                    <li>Direct links work best for email campaigns and social media</li>
                    <li>UTM parameters track which sources drive conversions</li>
                    <li>Service-specific links pre-select services for targeted landing pages</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Text Messaging (CallRail SMS) */}
      {activeSection === 'sms' && (
        <div className="space-y-4">
          <Card className="bg-blue-50/50 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-800/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    CallRail texting is connected
                  </h4>
                  <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
                    <li>Transactional texts (quote ready, appointment scheduled, rescheduled, cancelled) send automatically.</li>
                    <li>Follow-up campaigns enroll customers when their trigger event fires and send on a delay.</li>
                    <li>Queued campaign messages are processed every 15 minutes.</li>
                    <li>When a customer replies STOP, they're suppressed automatically and shown under Opt-Outs.</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="campaigns">
            <TabsList>
              <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
              <TabsTrigger value="log">Message Log</TabsTrigger>
              <TabsTrigger value="optouts">Opt-Outs</TabsTrigger>
            </TabsList>
            <TabsContent value="campaigns" className="mt-4">
              <SmsCampaignManager />
            </TabsContent>
            <TabsContent value="log" className="mt-4">
              <SmsMessageLog />
            </TabsContent>
            <TabsContent value="optouts" className="mt-4">
              <SmsOptOutManager />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
