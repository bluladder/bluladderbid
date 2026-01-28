import { useState } from 'react';
import { DollarSign, Calculator, Tags, BarChart3, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PricingEditor } from './PricingEditor';
import { PricingPreview } from './PricingPreview';
import { ScenarioCompare } from './ScenarioCompare';
import { DiscountCodesManager } from './DiscountCodesManager';

export function PricingTabContent() {
  const [activeSection, setActiveSection] = useState('editor');
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-6">
      {/* Quick Navigation */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={activeSection === 'editor' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('editor')}
            >
              <DollarSign className="w-3.5 h-3.5 mr-1.5" />
              Pricing Rates
            </Badge>
            <Badge
              variant={activeSection === 'preview' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('preview')}
            >
              <Calculator className="w-3.5 h-3.5 mr-1.5" />
              Preview Calculator
            </Badge>
            <Badge
              variant={activeSection === 'discounts' ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setActiveSection('discounts')}
            >
              <Tags className="w-3.5 h-3.5 mr-1.5" />
              Discount Codes
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Pricing Editor */}
      {activeSection === 'editor' && (
        <PricingEditor />
      )}

      {/* Preview Calculator */}
      {activeSection === 'preview' && (
        <div className="space-y-6">
          <PricingPreview />
          
          {/* Advanced: Scenario Comparison - Collapsed */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2">
                <BarChart3 className="w-4 h-4" />
                {showAdvanced ? 'Hide' : 'Show'} Scenario Comparison Tool
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-4">
                <ScenarioCompare />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Discount Codes */}
      {activeSection === 'discounts' && (
        <DiscountCodesManager />
      )}
    </div>
  );
}
