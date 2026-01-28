import { useState } from 'react';
import { ChevronDown, ChevronUp, Check, Sliders, Plus, Sparkles, Home, Warehouse, Cloud, Droplets } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { TierConfig } from './TierSelector';
import type { ServicePlanService } from '@/types/servicePlanBuilder';

interface TierCustomizerProps {
  tier: TierConfig;
  services: ServicePlanService[];
  onToggleService: (serviceId: string) => void;
  onChangeFrequency: (serviceId: string, frequency: 1 | 2 | 3 | 4) => void;
  addonDiscount: number;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

const SERVICE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Sparkles,
  Home,
  Warehouse,
  Cloud,
  Droplets,
};

interface ServiceCardProps {
  service: ServicePlanService;
  isIncludedInTier: boolean;
  addonDiscount: number;
  showFrequencyControls: boolean;
  onToggle: () => void;
  onFrequencyChange: (freq: 1 | 2 | 3 | 4) => void;
}

function ServiceCard({ 
  service, 
  isIncludedInTier, 
  addonDiscount, 
  showFrequencyControls, 
  onToggle, 
  onFrequencyChange 
}: ServiceCardProps) {
  const Icon = SERVICE_ICONS[service.icon] || Sparkles;
  
  const displayPrice = service.enabled && !isIncludedInTier && addonDiscount > 0
    ? Math.round(service.calculatedPrice * (1 - addonDiscount / 100))
    : service.calculatedPrice;
  
  const annualPrice = displayPrice * service.frequency;
  const isEnabled = service.enabled;
  
  return (
    <div 
      className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
        isEnabled
          ? 'bg-primary/5 border-primary/30 shadow-sm'
          : 'bg-card border-border/50 hover:border-muted-foreground/30 hover:bg-muted/20'
      }`}
      onClick={onToggle}
    >
      {/* Status Badge */}
      <div className="absolute -top-2 -right-2">
        {isIncludedInTier && isEnabled && (
          <Badge className="bg-primary text-primary-foreground text-[10px] px-2 py-0.5 shadow-sm">
            <Check className="w-3 h-3 mr-1" />
            Included
          </Badge>
        )}
        {!isIncludedInTier && isEnabled && (
          <Badge className="bg-success text-success-foreground text-[10px] px-2 py-0.5 shadow-sm">
            <Plus className="w-3 h-3 mr-1" />
            Added
          </Badge>
        )}
      </div>
      
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
          isEnabled 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted text-muted-foreground'
        }`}>
          <Icon className="w-5 h-5" />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className={`font-medium text-sm ${isEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                {service.name}
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {service.description}
              </p>
            </div>
          </div>
          
          {/* Pricing */}
          <div className="mt-2 flex items-center justify-between">
            <div>
              {service.calculatedPrice > 0 ? (
                <div className="flex items-baseline gap-1">
                  <span className={`font-semibold ${isEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {formatPrice(isEnabled ? annualPrice : displayPrice)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isEnabled ? `/yr (${service.frequency}x)` : '/visit'}
                  </span>
                  {!isIncludedInTier && addonDiscount > 0 && (
                    <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0 text-success border-success/30">
                      {addonDiscount}% off
                    </Badge>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground italic">Enter home details for pricing</span>
              )}
            </div>
            
            {/* Quick Add Button for non-included services */}
            {!isEnabled && (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs px-3"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            )}
          </div>
          
          {/* Frequency controls - only when enabled AND advanced open */}
          {isEnabled && showFrequencyControls && (
            <div className="mt-3 pt-3 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-2">Frequency:</span>
                {[1, 2, 3, 4].map((freq) => (
                  <button
                    key={freq}
                    onClick={() => onFrequencyChange(freq as 1 | 2 | 3 | 4)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      service.frequency === freq
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                    }`}
                  >
                    {freq}x/yr
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Show current frequency when enabled but controls hidden */}
          {isEnabled && !showFrequencyControls && (
            <div className="mt-2">
              <Badge variant="secondary" className="text-[10px]">
                {service.frequency}x per year
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TierCustomizer({
  tier,
  services,
  onToggleService,
  onChangeFrequency,
  addonDiscount,
}: TierCustomizerProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  
  // Determine which services are included in the tier
  const includedServiceIds = new Set<string>();
  tier.includedServices.forEach(service => {
    if (service.includes('Exterior Windows')) includedServiceIds.add('window-cleaning-exterior');
    if (service.includes('Interior Windows')) includedServiceIds.add('window-cleaning-interior');
    if (service.includes('Gutter')) includedServiceIds.add('gutter-cleaning');
    if (service.includes('House Wash')) includedServiceIds.add('house-wash');
    if (service.includes('Roof')) includedServiceIds.add('roof-cleaning');
  });
  
  // Split services for display
  const includedServices = services.filter(s => includedServiceIds.has(s.id));
  const availableServices = services.filter(s => !includedServiceIds.has(s.id));
  const addedExtras = availableServices.filter(s => s.enabled);
  
  // Count totals
  const totalServices = services.length;
  const enabledCount = services.filter(s => s.enabled).length;
  
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Your {tier.name} Plan Services</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              {enabledCount} of {totalServices} services selected
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
            tier.id === 'good'
              ? 'tier-badge-good'
              : tier.id === 'better'
                ? 'tier-badge-better'
                : 'tier-badge-best'
          }`}>
            {tier.name}
          </span>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Included Services Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-sm font-semibold text-foreground">
              Included in {tier.name}
            </h4>
            <Badge variant="secondary" className="text-[10px]">
              {includedServices.length} services
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {includedServices.map(service => (
              <ServiceCard
                key={service.id}
                service={service}
                isIncludedInTier={true}
                addonDiscount={0}
                showFrequencyControls={isAdvancedOpen}
                onToggle={() => onToggleService(service.id)}
                onFrequencyChange={(freq) => onChangeFrequency(service.id, freq)}
              />
            ))}
          </div>
        </div>
        
        <Separator />
        
        {/* Available Add-ons Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">
                Available Add-ons
              </h4>
              {addedExtras.length > 0 && (
                <Badge className="bg-success/10 text-success text-[10px]">
                  {addedExtras.length} added
                </Badge>
              )}
            </div>
            {addonDiscount > 0 && (
              <Badge variant="outline" className="text-xs text-success border-success/30">
                <Sparkles className="w-3 h-3 mr-1" />
                {addonDiscount}% off with {tier.name}
              </Badge>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {availableServices.map(service => (
              <ServiceCard
                key={service.id}
                service={service}
                isIncludedInTier={false}
                addonDiscount={addonDiscount}
                showFrequencyControls={isAdvancedOpen}
                onToggle={() => onToggleService(service.id)}
                onFrequencyChange={(freq) => onChangeFrequency(service.id, freq)}
              />
            ))}
          </div>
        </div>
        
        <Separator />
        
        {/* Advanced Controls Toggle */}
        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 py-2 text-sm text-primary hover:text-primary/80 transition-colors w-full justify-center">
              <Sliders className="w-4 h-4" />
              {isAdvancedOpen ? 'Hide' : 'Show'} frequency controls
              {isAdvancedOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="text-xs text-muted-foreground text-center pt-2">
              Use the frequency buttons on each service above to adjust how often it's performed.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
