import { Service, FREQUENCY_LABELS, ServiceFrequency } from '@/types/servicePlan';
import { Sparkles, Droplets, Home, Cloud, Warehouse, TreeDeciduous, Sun, Layers, Wrench, Grid3X3, X, Trash2, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ServiceConfigCardProps {
  service: Service;
  orderNumber: number;
  onPriceChange: (id: string, price: number) => void;
  onFrequencyChange: (id: string, frequency: ServiceFrequency) => void;
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

export function ServiceConfigCard({
  service,
  orderNumber,
  onPriceChange,
  onFrequencyChange,
  onRemove,
  onDelete,
  isCustom,
}: ServiceConfigCardProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl p-4 animate-fade-in border transition-all duration-200 ${
        isDragging 
          ? 'shadow-lg ring-2 ring-primary/30 border-primary/40' 
          : 'border-border/60'
      }`}
      css-style={`background: var(--gradient-card);`}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
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
            className="p-1 rounded-md hover:bg-muted cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors touch-none"
            title="Drag to reorder"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <div 
            className="w-8 h-8 rounded-lg text-primary-foreground flex items-center justify-center shadow-sm"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-sm">{service.name}</h3>
              {isCustom && (
                <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                  Custom
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isCustom && onDelete && (
            <button
              onClick={() => onDelete(service.id)}
              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete service permanently"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onRemove(service.id)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Remove from plan"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Base Price
          </label>
          <div className="mt-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <input
              type="number"
              value={service.basePrice}
              onChange={(e) =>
                onPriceChange(service.id, parseFloat(e.target.value) || 0)
              }
              className="input-field pl-7 font-semibold"
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
  );
}