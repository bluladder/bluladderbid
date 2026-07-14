import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PhoneNumbersManager } from './PhoneNumbersManager';
import { KnowledgeManager } from './KnowledgeManager';
import { KnowledgeGapsView } from './KnowledgeGapsView';
import { SystemHealthView } from './SystemHealthView';
import { EscalationCenter } from './EscalationCenter';

export function KnowledgeCenter({ onOpenAiConversations }: { onOpenAiConversations?: () => void }) {
  return (
    <Tabs defaultValue="knowledge" className="space-y-4">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        <TabsTrigger value="gaps">Knowledge Gaps</TabsTrigger>
        <TabsTrigger value="health">System Health</TabsTrigger>
        <TabsTrigger value="escalations">Escalations</TabsTrigger>
        <TabsTrigger value="phones">Phone Numbers</TabsTrigger>
      </TabsList>
      <TabsContent value="knowledge"><KnowledgeManager /></TabsContent>
      <TabsContent value="gaps"><KnowledgeGapsView /></TabsContent>
      <TabsContent value="health"><SystemHealthView onOpenAiConversations={onOpenAiConversations} /></TabsContent>
      <TabsContent value="escalations"><EscalationCenter /></TabsContent>
      <TabsContent value="phones"><PhoneNumbersManager /></TabsContent>
    </Tabs>
  );
}
