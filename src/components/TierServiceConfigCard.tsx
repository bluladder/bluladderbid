import { useState } from 'react';
import { Service, FREQUENCY_LABELS, ServiceFrequency, TierKey, FREQUENCY_MULTIPLIERS } from '@/types/servicePlan';
import { Sparkles, Droplets, Home, Cloud, Warehouse, TreeDeciduous, Sun, Layers, Wrench, Grid3X3, X, Trash2, GripVertical, ChevronDown, ChevronUp, Crown, Star } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

interface TierServiceConfigCardProps {
  service: Service;
  orderNumber: number;
  onPriceChange: (id: string, price: number) => void;
  onNoteChange: (id: string, note: string) => void;
  onFrequencyChange: (id: string, frequency: ServiceFrequency) => void;
  onTierAvailabilityChange: (id: string, tier: TierKey, available: boolean) => void;
  onTierFrequencyChange: (id: string, tier: TierKey, frequency: ServiceFrequency) => void;
  onBestOnlyChange: (id: string, bestOnly: boolean) => void;
  onRemove: (id: string) => void;
  onDelete?: (id: string) => void;
  isCustom?: boolean;
}

const iconMap: Record<string, React.ElementType> = {
  Sparkles,
  Droplets,
  Home,
  Cloud,
  Warehouse,
  TreeDeciduous,
  Sun,
  Layers,
  Wrench,
  Grid3X3,
};

const TIER_CONFIG: { key: TierKey; label: string; color: string }[] = [
  { key: 'good', label: 'Good', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  { key: 'better', label: 'Better', color: 'bg-primary/10 text-primary border-primary/20' },
  { key: 'best', label: 'Best', color: 'bg-amber-100 text-amber-700 border-amber-200' },
];

export function TierServiceConfigCard({
  service,
  orderNumber,
  onPriceChange,
  onNoteChange,
  onFrequencyChange,
  onTierAvailabilityChange,
  onTierFrequencyChange,
  onBestOnlyChange,
  onRemove,
  onDelete,
  isCustom,
}: TierServiceConfigCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = iconMap[service.icon] || Wrench;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Count which tiers this service is available in
  const availableTiers = TIER_CONFIG.filter(t => service.tierAvailability[t.key]);
  
  // Calculate annual value based on base price and best tier frequency
  const bestFreqVisits = FREQUENCY_MULTIPLIERS[service.tierFrequencies.best];
  const annualValue = service.basePrice * bestFreqVisits;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl animate-fade-in border transition-all duration-200 overflow-hidden ${
        isDragging 
          ? 'shadow-lg ring-2 ring-primary/30 border-primary/40' 
          : 'border-border/60'
      }`}
    >
      {/* Collapsed Header */}
      <div 
        className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        style={{ background: 'var(--gradient-card)' }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Order number badge */}
            <div 
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-primary-foreground shadow-sm"
              style={{ background: 'var(--gradient-primary)' }}
            >
              {orderNumber}
            </div>
            {/* Drag handle */}
            <button
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-md hover:bg-muted cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors touch-none"
              title="Drag to reorder"
            >
              <GripVertical className="w-4 h-4" />
            </button>
            <div 
              className="w-8 h-8 rounded-lg text-primary-foreground flex items-center justify-center shadow-sm shrink-0"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-foreground text-sm truncate">{service.name}</h3>
                {isCustom && (
                  <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent border-accent/20">
                    Custom
                  </Badge>
                )}
                {service.bestOnly && (
                  <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">
                    <Crown className="w-3 h-3 mr-0.5" />
                    Best Only
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-semibold text-primary">${service.basePrice}</span>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">
                  {availableTiers.length === 3 ? 'All tiers' : availableTiers.map(t => t.label).join(', ') || 'No tiers'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isCustom && onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(service.id); }}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                title="Delete service permanently"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(service.id); }}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Remove from plan"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-1.5 text-muted-foreground">
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/40 bg-muted/20 animate-fade-in">
          {/* Base Price & Note Row */}
          <div className="pt-4 grid sm:grid-cols-2 gap-4">
            {/* Base Price */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Base Price (per visit)
              </label>
              <div className="mt-1 relative max-w-[120px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <input
                  type="number"
                  value={service.basePrice}
                  onChange={(e) => onPriceChange(service.id, parseFloat(e.target.value) || 0)}
                  className="input-field pl-7 font-semibold"
                  min={0}
                  step={5}
                />
              </div>
            </div>

            {/* Custom Note */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Custom Note <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={service.note || ''}
                onChange={(e) => onNoteChange(service.id, e.target.value)}
                placeholder="e.g., Includes screens, Up to 20 windows..."
                className="input-field mt-1 text-sm"
                maxLength={100}
              />
            </div>
          </div>

          {/* Best Only Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50/50">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-foreground">Exclusive to Best Plan</p>
                <p className="text-xs text-muted-foreground">Premium service for top-tier members only</p>
              </div>
            </div>
            <Switch
              checked={service.bestOnly}
              onCheckedChange={(checked) => onBestOnlyChange(service.id, checked)}
            />
          </div>

          {/* Tier Availability & Frequency */}
          {!service.bestOnly && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Tier Settings
              </p>
              <div className="grid gap-2">
                {TIER_CONFIG.map((tierConfig) => {
                  const isAvailable = service.tierAvailability[tierConfig.key];
                  const frequency = service.tierFrequencies[tierConfig.key];
                  const visits = FREQUENCY_MULTIPLIERS[frequency];
                  
                  return (
                    <div 
                      key={tierConfig.key}
                      className={`p-3 rounded-lg border transition-all ${
                        isAvailable 
                          ? 'border-border bg-background' 
                          : 'border-border/40 bg-muted/30 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={isAvailable}
                            onCheckedChange={(checked) => onTierAvailabilityChange(service.id, tierConfig.key, checked)}
                            disabled={tierConfig.key === 'best'} // Best tier should always be available if service is enabled
                          />
                          <div>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${tierConfig.color}`}>
                              {tierConfig.key === 'better' && <Star className="w-3 h-3 mr-1" />}
                              {tierConfig.key === 'best' && <Crown className="w-3 h-3 mr-1" />}
                              {tierConfig.label}
                            </span>
                          </div>
                        </div>
                        
                        {isAvailable && (
                          <div className="flex items-center gap-2">
                            <select
                              value={frequency}
                              onChange={(e) => onTierFrequencyChange(service.id, tierConfig.key, e.target.value as ServiceFrequency)}
                              className="input-field text-xs py-1.5 px-2 w-auto"
                            >
                              {(Object.keys(FREQUENCY_LABELS) as ServiceFrequency[]).map((freq) => (
                                <option key={freq} value={freq}>
                                  {FREQUENCY_LABELS[freq]}
                                </option>
                              ))}
                            </select>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              ${(service.basePrice * visits).toFixed(0)}/yr
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Annual Value Summary */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/10">
            <span className="text-sm text-muted-foreground">Best Tier Annual Value</span>
            <span className="text-sm font-bold text-primary">${annualValue.toFixed(0)}/year</span>
          </div>
        </div>
      )}
    </div>
  );
}