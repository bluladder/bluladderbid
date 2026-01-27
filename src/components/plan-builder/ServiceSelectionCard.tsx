import { CheckCircle2, Circle, Sparkles, Home, Warehouse, Cloud, Droplets } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ServicePlanService, PlanBuilderServiceId } from '@/types/servicePlanBuilder';
import { FREQUENCY_OPTIONS } from '@/types/servicePlanBuilder';

interface ServiceSelectionCardProps {
  service: ServicePlanService;
  onToggle: (id: PlanBuilderServiceId) => void;
  onFrequencyChange: (id: PlanBuilderServiceId, frequency: 1 | 2 | 3 | 4) => void;
  hasHomeDetails: boolean;
}

const ICONS: Record<string, React.FC<{ className?: string }>> = {
  Sparkles,
  Home,
  Warehouse,
  Cloud,
  Droplets,
};

export function ServiceSelectionCard({
  service,
  onToggle,
  onFrequencyChange,
  hasHomeDetails,
}: ServiceSelectionCardProps) {
  const Icon = ICONS[service.icon] || Circle;
  
  const priceDisplay = hasHomeDetails && service.calculatedPrice > 0
    ? `$${service.calculatedPrice}`
    : 'Enter home details';
  
  const annualDisplay = hasHomeDetails && service.annualTotal > 0
    ? `$${service.annualTotal}/year`
    : '';
  
  return (
    <Card
      className={cn(
        'relative cursor-pointer transition-all duration-200 overflow-hidden',
        service.enabled
          ? 'ring-2 ring-primary bg-primary/5 border-primary/20'
          : 'hover:border-muted-foreground/30 hover:bg-muted/30'
      )}
      onClick={() => onToggle(service.id as PlanBuilderServiceId)}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Selection indicator */}
          <div className="mt-0.5">
            {service.enabled ? (
              <CheckCircle2 className="w-5 h-5 text-primary" />
            ) : (
              <Circle className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          
          {/* Icon */}
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            service.enabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}>
            <Icon className="w-5 h-5" />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-medium text-foreground">{service.name}</h4>
                <p className="text-sm text-muted-foreground mt-0.5">{service.description}</p>
              </div>
              
              {/* Price */}
              <div className="text-right flex-shrink-0">
                <p className={cn(
                  'font-semibold',
                  hasHomeDetails && service.calculatedPrice > 0 ? 'text-foreground' : 'text-muted-foreground text-sm'
                )}>
                  {priceDisplay}
                </p>
                {service.enabled && annualDisplay && (
                  <p className="text-xs text-primary font-medium">{annualDisplay}</p>
                )}
              </div>
            </div>
            
            {/* Frequency selector - only show when enabled */}
            {service.enabled && (
              <div 
                className="mt-3 flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-sm text-muted-foreground">Frequency:</span>
                <Select
                  value={String(service.frequency)}
                  onValueChange={(v) => onFrequencyChange(service.id as PlanBuilderServiceId, parseInt(v) as 1 | 2 | 3 | 4)}
                >
                  <SelectTrigger className="w-[160px] h-8 text-sm bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border shadow-lg z-50">
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
