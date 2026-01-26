import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { usePricingConfigRows, useUpdatePricingConfig, DEFAULT_PRICING, type PricingConfigRow } from '@/hooks/usePricingConfig';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, RefreshCw, Percent, DollarSign, Home, Droplets, Wind, Sun, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface EditableValue {
  [key: string]: number | string | EditableValue;
}

// Describes the type of value for better UI rendering
type ValueType = 'currency' | 'percent' | 'multiplier' | 'rate' | 'text';

interface FieldConfig {
  label: string;
  type: ValueType;
  description?: string;
}

// Configuration for how to display each field
const FIELD_CONFIGS: Record<string, Record<string, FieldConfig>> = {
  window_cleaning: {
    exteriorPerSqFt: { label: 'Exterior Rate', type: 'rate', description: 'Per sq ft for exterior windows' },
    interiorPerSqFt: { label: 'Interior Rate', type: 'rate', description: 'Per sq ft for interior windows' },
    minimumPrice: { label: 'Minimum Price', type: 'currency', description: 'Minimum charge regardless of house size' },
  },
  house_wash: {
    perSqFt: { label: 'Rate per Sq Ft', type: 'rate', description: 'Base rate per square foot' },
    minimumPrice: { label: 'Minimum Price', type: 'currency', description: 'Minimum charge regardless of house size' },
  },
  gutter_cleaning: {
    perSqFt: { label: 'Rate per Sq Ft', type: 'rate', description: 'Base rate per square foot' },
    minimumPrice: { label: 'Minimum Price', type: 'currency', description: 'Minimum charge regardless of house size' },
  },
  roof_cleaning: {
    perSqFt: { label: 'Rate per Sq Ft', type: 'rate', description: 'Base rate per square foot' },
    minimumPrice: { label: 'Minimum Price', type: 'currency', description: 'Minimum charge regardless of house size' },
  },
};

// Section descriptions for the new structure
const SECTION_INFO: Record<string, { title: string; description: string; icon: React.ReactNode }> = {
  window_cleaning: {
    title: 'Window Cleaning',
    description: 'Base rates per sq ft plus percentage modifiers for stories, condition, and special features',
    icon: <Sun className="w-5 h-5" />,
  },
  house_wash: {
    title: 'House Wash',
    description: 'Base rate per sq ft with story-based modifiers',
    icon: <Droplets className="w-5 h-5" />,
  },
  gutter_cleaning: {
    title: 'Gutter Cleaning',
    description: 'Base rate per sq ft with story-based modifiers',
    icon: <Home className="w-5 h-5" />,
  },
  roof_cleaning: {
    title: 'Roof Cleaning',
    description: 'Base rate per sq ft with modifiers for stories, roof type, and severity',
    icon: <Home className="w-5 h-5" />,
  },
  window_addons: {
    title: 'Window Add-ons',
    description: 'Flat fee add-ons for ladder work and sunrooms',
    icon: <DollarSign className="w-5 h-5" />,
  },
  pressure_washing: {
    title: 'Pressure Washing',
    description: 'Driveway-based pricing with surface multipliers and add-ons',
    icon: <Wind className="w-5 h-5" />,
  },
  bundle_config: {
    title: 'Bundle Configuration',
    description: 'Tier settings for Good/Better/Best packages',
    icon: <DollarSign className="w-5 h-5" />,
  },
};

function ModifierInput({
  label,
  value,
  onChange,
  isPercentage = false,
  isCurrency = false,
  isRate = false,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  isPercentage?: boolean;
  isCurrency?: boolean;
  isRate?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="min-w-[100px] text-sm text-muted-foreground capitalize">
        {label.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
      </Label>
      <div className="relative">
        {isCurrency && (
          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        )}
        <Input
          type="number"
          step={isRate ? '0.001' : '1'}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`w-28 ${isCurrency ? 'pl-7' : ''} ${isPercentage ? 'pr-8' : ''}`}
        />
        {isPercentage && (
          <Percent className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        )}
      </div>
      {isPercentage && (
        <Badge variant="outline" className="text-xs">
          {value > 0 ? `+${value}%` : value === 0 ? 'No change' : `${value}%`}
        </Badge>
      )}
    </div>
  );
}

function ModifiersSection({
  title,
  modifiers,
  onChange,
  path,
}: {
  title: string;
  modifiers: Record<string, number | Record<string, number>>;
  onChange: (path: string[], value: number) => void;
  path: string[];
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Percent className="w-4 h-4 text-primary" />
        {title}
        <Badge variant="secondary" className="text-xs">Percentage Modifiers</Badge>
      </h4>
      <div className="grid gap-3 pl-4 border-l-2 border-primary/20">
        {Object.entries(modifiers).map(([key, value]) => {
          if (typeof value === 'object') {
            return (
              <div key={key} className="space-y-2">
                <Label className="text-sm font-medium capitalize">
                  {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                </Label>
                <div className="grid gap-2 pl-4">
                  {Object.entries(value).map(([subKey, subValue]) => (
                    <ModifierInput
                      key={subKey}
                      label={subKey}
                      value={subValue as number}
                      onChange={(val) => onChange([...path, key, subKey], val)}
                      isPercentage={true}
                    />
                  ))}
                </div>
              </div>
            );
          }
          return (
            <ModifierInput
              key={key}
              label={key}
              value={value}
              onChange={(val) => onChange([...path, key], val)}
              isPercentage={true}
            />
          );
        })}
      </div>
    </div>
  );
}

function ServicePricingSection({
  row,
  onSave,
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
    setValues((prev) => {
      const updated = JSON.parse(JSON.stringify(prev));
      let current = updated;
      for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]]) {
          current[path[i]] = {};
        }
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

  const info = SECTION_INFO[row.config_key];
  const isServiceWithModifiers = ['window_cleaning', 'house_wash', 'gutter_cleaning', 'roof_cleaning'].includes(row.config_key);

  // Render rate inputs (perSqFt fields)
  const renderRates = () => {
    const rateFields = Object.entries(values).filter(
      ([key]) => key.includes('PerSqFt') || key === 'perSqFt'
    );

    if (rateFields.length === 0) return null;

    return (
      <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-green-600" />
          Base Rates
          <Badge variant="outline" className="text-xs">Per Square Foot</Badge>
        </h4>
        <div className="grid gap-3 pl-4 border-l-2 border-green-600/20">
          {rateFields.map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="min-w-[120px] text-sm text-muted-foreground">
                {FIELD_CONFIGS[row.config_key]?.[key]?.label || key}
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.001"
                  value={value as number}
                  onChange={(e) => handleValueChange([key], parseFloat(e.target.value) || 0)}
                  className="w-28 pl-7"
                />
              </div>
              <span className="text-xs text-muted-foreground">/sq ft</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render minimum price input
  const renderMinimumPrice = () => {
    const minPrice = values.minimumPrice as number | undefined;
    if (minPrice === undefined && !['window_cleaning', 'house_wash', 'gutter_cleaning', 'roof_cleaning'].includes(row.config_key)) {
      return null;
    }

    return (
      <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-amber-600" />
          Minimum Price
          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Floor Price</Badge>
        </h4>
        <div className="grid gap-3 pl-4 border-l-2 border-amber-600/20">
          <div className="flex items-center gap-2">
            <Label className="min-w-[120px] text-sm text-muted-foreground">
              Minimum Charge
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="number"
                step="1"
                value={(values.minimumPrice as number) ?? 0}
                onChange={(e) => handleValueChange(['minimumPrice'], parseFloat(e.target.value) || 0)}
                className="w-28 pl-7"
              />
            </div>
            <span className="text-xs text-muted-foreground">regardless of size</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground pl-4">
          If the calculated price is below this amount, the minimum will be charged instead.
        </p>
      </div>
    );
  };

  // Render modifiers section
  const renderModifiers = () => {
    const modifiers = values.modifiers as Record<string, number | Record<string, number>> | undefined;
    if (!modifiers) return null;

    return (
      <ModifiersSection
        title="Price Modifiers"
        modifiers={modifiers}
        onChange={handleValueChange}
        path={['modifiers']}
      />
    );
  };

  // Render flat fee add-ons (window_addons, pressure_washing)
  const renderFlatFees = () => {
    if (row.config_key === 'window_addons') {
      return (
        <div className="space-y-4">
          {Object.entries(values).map(([category, items]) => (
            <div key={category} className="space-y-3">
              <h4 className="text-sm font-semibold capitalize">
                {category.replace(/([A-Z])/g, ' $1')}
              </h4>
              <div className="grid gap-2 pl-4 border-l-2 border-muted">
                {Object.entries(items as Record<string, number>).map(([key, value]) => (
                  <ModifierInput
                    key={key}
                    label={key}
                    value={value}
                    onChange={(val) => handleValueChange([category, key], val)}
                    isCurrency={true}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (row.config_key === 'pressure_washing') {
      return (
        <div className="space-y-4">
          {/* Driveway prices */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Driveway Base Prices</h4>
            <div className="grid gap-2 pl-4 border-l-2 border-muted">
              {Object.entries((values.driveway || {}) as Record<string, number>).map(([key, value]) => (
                <ModifierInput
                  key={key}
                  label={key}
                  value={value}
                  onChange={(val) => handleValueChange(['driveway', key], val)}
                  isCurrency={true}
                />
              ))}
            </div>
          </div>

          {/* Surface multipliers */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Surface Type Multipliers</h4>
            <div className="grid gap-2 pl-4 border-l-2 border-muted">
              {Object.entries((values.surfaceMultipliers || {}) as Record<string, number>).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <Label className="min-w-[100px] text-sm text-muted-foreground capitalize">{key}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={value}
                    onChange={(e) => handleValueChange(['surfaceMultipliers', key], parseFloat(e.target.value) || 1)}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">× base price</span>
                </div>
              ))}
            </div>
          </div>

          {/* Add-ons */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Add-on Prices</h4>
            <div className="grid gap-2 pl-4 border-l-2 border-muted">
              {Object.entries((values.addons || {}) as Record<string, number>).map(([key, value]) => (
                <ModifierInput
                  key={key}
                  label={key}
                  value={value}
                  onChange={(val) => handleValueChange(['addons', key], val)}
                  isCurrency={true}
                />
              ))}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // Render bundle config
  const renderBundleConfig = () => {
    if (row.config_key !== 'bundle_config') return null;

    return (
      <div className="space-y-6">
        {Object.entries(values).map(([tier, config]) => {
          const tierConfig = config as Record<string, unknown>;
          return (
            <div key={tier} className="space-y-3 p-4 rounded-lg border bg-card">
              <h4 className="text-sm font-semibold capitalize flex items-center gap-2">
                <Badge variant={tier === 'best' ? 'default' : tier === 'better' ? 'secondary' : 'outline'}>
                  {tier}
                </Badge>
                {tierConfig.name as string}
              </h4>
              
              <div className="grid gap-3">
                <div className="flex items-center gap-2">
                  <Label className="min-w-[140px] text-sm text-muted-foreground">Label</Label>
                  <Input
                    value={tierConfig.label as string}
                    onChange={(e) => handleValueChange([tier, 'label'], e.target.value)}
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="min-w-[140px] text-sm text-muted-foreground">Description</Label>
                  <Input
                    value={tierConfig.description as string}
                    onChange={(e) => handleValueChange([tier, 'description'], e.target.value)}
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="min-w-[140px] text-sm text-muted-foreground">Window Frequency</Label>
                  <Input
                    type="number"
                    value={tierConfig.windowFrequency as number}
                    onChange={(e) => handleValueChange([tier, 'windowFrequency'], parseInt(e.target.value) || 1)}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">times/year</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="min-w-[140px] text-sm text-muted-foreground">Other Services Freq</Label>
                  <Input
                    type="number"
                    value={tierConfig.additionalServicesFrequency as number}
                    onChange={(e) => handleValueChange([tier, 'additionalServicesFrequency'], parseInt(e.target.value) || 1)}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">times/year</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="min-w-[140px] text-sm text-muted-foreground">Bundle Discount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={(tierConfig.discount as number) * 100}
                    onChange={(e) => handleValueChange([tier, 'discount'], (parseFloat(e.target.value) || 0) / 100)}
                    className="w-20"
                  />
                  <Percent className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <AccordionItem value={row.config_key}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center justify-between w-full pr-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              {info?.icon || <DollarSign className="w-5 h-5" />}
            </div>
            <div className="text-left">
              <div className="font-semibold">{info?.title || row.config_key}</div>
              <div className="text-sm text-muted-foreground">
                {info?.description || row.description}
              </div>
            </div>
          </div>
          {hasChanges && (
            <Badge variant="destructive" className="text-xs">
              <AlertCircle className="w-3 h-3 mr-1" />
              Unsaved
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-4 space-y-6">
          {isServiceWithModifiers && (
            <>
              {renderRates()}
              <Separator />
              {renderMinimumPrice()}
              <Separator />
              {renderModifiers()}
            </>
          )}
          
          {renderFlatFees()}
          {renderBundleConfig()}
          
          <div className="pt-4 border-t flex gap-2">
            <Button onClick={handleSave} disabled={!hasChanges} size="sm">
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
            {hasChanges && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValues(row.config_value as EditableValue);
                  setHasChanges(false);
                }}
              >
                Discard
              </Button>
            )}
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

  const handleInitializeDefaults = async () => {
    // Initialize all default pricing configs if they don't exist
    const configKeys = Object.keys(DEFAULT_PRICING);
    
    for (const key of configKeys) {
      const exists = rows?.find((r) => r.config_key === key);
      if (!exists) {
        toast.info(`Initializing ${key}...`);
        // This would need an insert mutation, which we'd need to add
      }
    }
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

  // Order sections logically
  const sectionOrder = [
    'window_cleaning',
    'house_wash',
    'gutter_cleaning',
    'roof_cleaning',
    'window_addons',
    'pressure_washing',
    'bundle_config',
  ];

  const sortedRows = rows?.slice().sort((a, b) => {
    const aIndex = sectionOrder.indexOf(a.config_key);
    const bIndex = sectionOrder.indexOf(b.config_key);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Pricing Configuration
        </CardTitle>
        <CardDescription>
          Manage all pricing values. All four main services (Window Cleaning, House Wash, 
          Gutter Cleaning, Roof Cleaning) are calculated from square footage with percentage-based 
          modifiers (0-100% increase).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(!sortedRows || sortedRows.length === 0) ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No pricing configuration found in database.</p>
            <p className="text-sm mt-2">The system is using default values.</p>
          </div>
        ) : (
          <Accordion type="multiple" className="w-full">
            {sortedRows.map((row) => (
              <ServicePricingSection key={row.id} row={row} onSave={handleSave} />
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
