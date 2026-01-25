import { Service, FREQUENCY_LABELS, ServiceFrequency } from '@/types/servicePlan';
import { Switch } from '@/components/ui/switch';
import { Sparkles, Droplets, Home, Cloud, Warehouse, TreeDeciduous, Sun, Layers, Wrench, Trash2, Grid3X3 } from 'lucide-react';

interface ServiceCardProps {
  service: Service;
  onToggle: (id: string) => void;
  onPriceChange: (id: string, price: number) => void;
  onFrequencyChange: (id: string, frequency: ServiceFrequency) => void;
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

export function ServiceCard({
  service,
  onToggle,
  onPriceChange,
  onFrequencyChange,
  onDelete,
  isCustom,
}: ServiceCardProps) {
  const Icon = iconMap[service.icon] || Wrench;

  return (
    <div
      className={`card-elevated p-5 transition-all duration-200 ${
        service.enabled ? 'ring-2 ring-primary/20' : 'opacity-75'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              service.enabled
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{service.name}</h3>
              {isCustom && (
                <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                  Custom
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{service.description || 'Custom service'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCustom && onDelete && (
            <button
              onClick={() => onDelete(service.id)}
              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete service"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <Switch
            checked={service.enabled}
            onCheckedChange={() => onToggle(service.id)}
          />
        </div>
      </div>

      {service.enabled && (
        <div className="mt-4 pt-4 border-t border-border animate-fade-in">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Base Price
              </label>
              <div className="mt-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <input
                  type="number"
                  value={service.basePrice}
                  onChange={(e) =>
                    onPriceChange(service.id, parseFloat(e.target.value) || 0)
                  }
                  className="input-field pl-7 text-lg font-semibold"
                  min={0}
                  step={5}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Frequency
              </label>
              <select
                value={service.frequency}
                onChange={(e) =>
                  onFrequencyChange(service.id, e.target.value as ServiceFrequency)
                }
                className="input-field mt-1"
              >
                {(Object.keys(FREQUENCY_LABELS) as ServiceFrequency[]).map((freq) => (
                  <option key={freq} value={freq}>
                    {FREQUENCY_LABELS[freq]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
