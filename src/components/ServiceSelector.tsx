import { Service } from '@/types/servicePlan';
import { Sparkles, Droplets, Home, Cloud, Warehouse, TreeDeciduous, Sun, Layers, Wrench, Grid3X3, Check, Plus } from 'lucide-react';

interface ServiceSelectorProps {
  services: Service[];
  onToggle: (id: string) => void;
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

export function ServiceSelector({ services, onToggle }: ServiceSelectorProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {services.map((service) => {
        const Icon = iconMap[service.icon] || Wrench;
        
        return (
          <button
            key={service.id}
            onClick={() => onToggle(service.id)}
            className={`
              relative p-4 rounded-xl text-left transition-all duration-200
              ${service.enabled 
                ? 'card-selected' 
                : 'bg-gradient-to-br from-card to-muted/30 border border-border hover:border-primary/40 hover:shadow-md'
              }
            `}
          >
            {/* Selection indicator */}
            <div className={`
              absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-200
              ${service.enabled 
                ? 'text-primary-foreground shadow-sm' 
                : 'bg-muted/80 text-muted-foreground'
              }
            `}
              style={service.enabled ? { background: 'var(--gradient-primary)' } : {}}
            >
              {service.enabled ? (
                <Check className="w-3 h-3" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
            </div>
            
            {/* Icon */}
            <div className={`
              w-10 h-10 rounded-lg flex items-center justify-center mb-2.5 transition-all duration-200
              ${service.enabled 
                ? 'text-primary-foreground shadow-md' 
                : 'bg-gradient-to-br from-muted to-muted/50 text-muted-foreground'
              }
            `}
              style={service.enabled ? { background: 'var(--gradient-primary)' } : {}}
            >
              <Icon className="w-5 h-5" />
            </div>
            
            {/* Content */}
            <h3 className={`
              font-semibold text-sm leading-tight mb-1 pr-6
              ${service.enabled ? 'text-foreground' : 'text-foreground/80'}
            `}>
              {service.name}
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {service.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}