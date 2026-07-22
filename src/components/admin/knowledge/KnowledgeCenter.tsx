import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PhoneNumbersManager } from './PhoneNumbersManager';
import { KnowledgeManager } from './KnowledgeManager';
import { KnowledgeGapsView } from './KnowledgeGapsView';
import { SystemHealthView } from './SystemHealthView';
import { EscalationCenter } from './EscalationCenter';
import { ServicePreparationPanel } from './ServicePreparationPanel';
import { WeatherStatusPanel } from './WeatherStatusPanel';
import { PostServiceEducationPanel } from './PostServiceEducationPanel';
import { MaintenanceIntervalsPanel } from './MaintenanceIntervalsPanel';

export function KnowledgeCenter({ onOpenAiConversations }: { onOpenAiConversations?: () => void }) {
  return (
    <Tabs defaultValue="knowledge" className="space-y-4">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        <TabsTrigger value="gaps">Knowledge Gaps</TabsTrigger>
        <TabsTrigger value="prep">Service Preparation</TabsTrigger>
        <TabsTrigger value="education">Post-Service Education</TabsTrigger>
        <TabsTrigger value="maintenance">Maintenance Intervals</TabsTrigger>
        <TabsTrigger value="weather">Weather Status</TabsTrigger>
        <TabsTrigger value="health">System Health</TabsTrigger>
        <TabsTrigger value="escalations">Escalations</TabsTrigger>
        <TabsTrigger value="phones">Phone Numbers</TabsTrigger>
      </TabsList>
      <TabsContent value="knowledge"><KnowledgeManager /></TabsContent>
      <TabsContent value="gaps"><KnowledgeGapsView /></TabsContent>
      <TabsContent value="prep"><ServicePreparationPanel /></TabsContent>
      <TabsContent value="education"><PostServiceEducationPanel /></TabsContent>
      <TabsContent value="maintenance"><MaintenanceIntervalsPanel /></TabsContent>
      <TabsContent value="weather"><WeatherStatusPanel /></TabsContent>
      <TabsContent value="health"><SystemHealthView onOpenAiConversations={onOpenAiConversations} /></TabsContent>
      <TabsContent value="escalations"><EscalationCenter /></TabsContent>
      <TabsContent value="phones"><PhoneNumbersManager /></TabsContent>
    </Tabs>
  );
}
