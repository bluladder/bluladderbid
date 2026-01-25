import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { usePricingConfigRows, useUpdatePricingConfig, type PricingConfigRow } from '@/hooks/usePricingConfig';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, RefreshCw } from 'lucide-react';

interface EditableValue {
  [key: string]: number | string | EditableValue;
}

function PricingSection({ 
  row, 
  onSave 
}: { 
  row: PricingConfigRow; 
  onSave: (key: string, value: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<EditableValue>(row.config_value as EditableValue);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setValues(row.config_value as EditableValue);
    setHasChanges(false);
  }, [row]);

  const handleValueChange = (path: string[], newValue: number | string) => {
    setValues(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      let current = updated;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      current[path[path.length - 1]] = newValue;
      return updated;
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave(row.config_key, values as Record<string, unknown>);
    setHasChanges(false);
  };

  const renderValue = (value: unknown, path: string[] = []): React.ReactNode => {
    if (typeof value === 'number') {
      return (
        <Input
          type="number"
          step="any"
          value={value}
          onChange={(e) => handleValueChange(path, parseFloat(e.target.value) || 0)}
          className="w-32"
        />
      );
    }
    
    if (typeof value === 'string') {
      return (
        <Input
          type="text"
          value={value}
          onChange={(e) => handleValueChange(path, e.target.value)}
          className="w-48"
        />
      );
    }
    
    if (typeof value === 'object' && value !== null) {
      return (
        <div className="space-y-3 pl-4 border-l-2 border-muted">
          {Object.entries(value).map(([key, val]) => (
            <div key={key} className="flex items-center gap-3">
              <Label className="min-w-[120px] text-sm font-medium">{key}</Label>
              {renderValue(val, [...path, key])}
            </div>
          ))}
        </div>
      );
    }
    
    return <span className="text-muted-foreground">Unknown type</span>;
  };

  const formatTitle = (key: string) => {
    return key
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <AccordionItem value={row.config_key}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center justify-between w-full pr-4">
          <div className="text-left">
            <div className="font-semibold">{formatTitle(row.config_key)}</div>
            {row.description && (
              <div className="text-sm text-muted-foreground">{row.description}</div>
            )}
          </div>
          {hasChanges && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
              Unsaved changes
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-4 space-y-4">
          {renderValue(values)}
          <div className="pt-4 border-t">
            <Button 
              onClick={handleSave} 
              disabled={!hasChanges}
              size="sm"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function PricingEditor() {
  const { data: rows, isLoading, error, refetch } = usePricingConfigRows();
  const updateConfig = useUpdatePricingConfig();

  const handleSave = (configKey: string, configValue: Record<string, unknown>) => {
    updateConfig.mutate({ configKey, configValue });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Error loading pricing configuration.</p>
          <Button variant="outline" onClick={() => refetch()} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing Configuration</CardTitle>
        <CardDescription>
          Manage all pricing values that are used to calculate customer quotes. 
          Changes take effect immediately for new quotes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {rows?.map((row) => (
            <PricingSection 
              key={row.id} 
              row={row} 
              onSave={handleSave}
            />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
