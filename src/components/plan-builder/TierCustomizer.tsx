import { useState } from 'react';
import { ChevronDown, ChevronUp, Check, Sliders } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

const FREQUENCY_LABELS: Record<number, string> = {
  1: '1x/year',
  2: '2x/year',
  3: '3x/year',
  4: '4x/year',
};

interface ServiceRowProps {
  service: ServicePlanService;
  isIncludedInTier: boolean;
  addonDiscount: number;
  showFrequencyControls: boolean;
  onToggle: () => void;
  onFrequencyChange: (freq: 1 | 2 | 3 | 4) => void;
}

function ServiceRow({ service, isIncludedInTier, addonDiscount, showFrequencyControls, onToggle, onFrequencyChange }: ServiceRowProps) {
  const displayPrice = service.enabled && !isIncludedInTier && addonDiscount > 0
    ? Math.round(service.calculatedPrice * (1 - addonDiscount / 100))
    : service.calculatedPrice;
  
  const annualPrice = displayPrice * service.frequency;
  
  return (
    <div className={`p-3 rounded-lg border transition-all ${
      service.enabled 
        ? 'bg-primary/5 border-primary/20' 
        : 'bg-muted/30 border-border/50'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className={`w-5 h-5 rounded flex items-center justify-center transition-colors flex-shrink-0 ${
                service.enabled
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-muted-foreground/30 hover:border-primary'
              }`}
            >
              {service.enabled && <Check className="w-3.5 h-3.5" />}
            </button>
            <span className={`font-medium text-sm ${service.enabled ? '' : 'text-muted-foreground'}`}>
              {service.name}
            </span>
            {isIncludedInTier && service.enabled && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                Included
              </Badge>
            )}
            {!isIncludedInTier && service.enabled && addonDiscount > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-success border-success/30">
                {addonDiscount}% off
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 pl-7">{service.description}</p>
        </div>
        
        <div className="text-right flex-shrink-0">
          {service.calculatedPrice > 0 ? (
            <>
              <div className="font-semibold text-sm">
                {formatPrice(annualPrice)}
                <span className="text-xs font-normal text-muted-foreground">/yr</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatPrice(displayPrice)} × {service.frequency}
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Enter home details</span>
          )}
        </div>
      </div>
      
      {/* Frequency selector - only when enabled AND controls are shown */}
      {service.enabled && showFrequencyControls && (
        <div className="mt-2 pl-7">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-2">Frequency:</span>
            {[1, 2, 3, 4].map((freq) => (
              <button
                key={freq}
                onClick={() => onFrequencyChange(freq as 1 | 2 | 3 | 4)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  service.frequency === freq
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                }`}
              >
                {freq}x
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Show current frequency when controls hidden */}
      {service.enabled && !showFrequencyControls && (
        <div className="mt-1 pl-7">
          <span className="text-xs text-muted-foreground">{service.frequency}x per year</span>
        </div>
      )}
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
  const [isAddonsOpen, setIsAddonsOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  
  // Split services into core (included in tier) and add-ons
  const coreServiceIds = tier.includedServices.map(s => {
    // Extract service name from "Service Name Xx/yr" format
    const match = s.match(/^(.+?)\s+\d+x\/yr$/);
    return match ? match[1].toLowerCase().replace(/\s+/g, '-') : s.toLowerCase().replace(/\s+/g, '-');
  });
  
  // Map tier service names to service IDs
  const tierServiceMapping: Record<string, string[]> = {
    'exterior-windows': ['window-cleaning-exterior'],
    'interior-windows': ['window-cleaning-interior'],
    'gutter-cleaning': ['gutter-cleaning'],
    'house-wash': ['house-wash'],
    'roof-cleaning': ['roof-cleaning'],
  };
  
  const includedServiceIds = new Set<string>();
  tier.includedServices.forEach(service => {
    if (service.includes('Exterior Windows')) includedServiceIds.add('window-cleaning-exterior');
    if (service.includes('Interior Windows')) includedServiceIds.add('window-cleaning-interior');
    if (service.includes('Gutter')) includedServiceIds.add('gutter-cleaning');
    if (service.includes('House Wash')) includedServiceIds.add('house-wash');
    if (service.includes('Roof')) includedServiceIds.add('roof-cleaning');
  });
  
  const coreServices = services.filter(s => includedServiceIds.has(s.id));
  const addonServices = services.filter(s => !includedServiceIds.has(s.id));
  const enabledAddons = addonServices.filter(s => s.enabled);
  
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Customize Your {tier.name} Plan</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Adjust frequencies or add extra services
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
      
      <CardContent className="space-y-4">
        {/* Core Services - Simple list view */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Included in {tier.name}
          </h4>
          <div className="space-y-2">
            {coreServices.map(service => (
              <ServiceRow
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
        
        {/* Advanced Options - Collapsed by default */}
        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 py-2 text-sm text-primary hover:text-primary/80 transition-colors">
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
            <p className="text-xs text-muted-foreground pb-2">
              Adjust how often each service is performed per year.
            </p>
          </CollapsibleContent>
        </Collapsible>
        
        <Separator />
        
        {/* Add-on Services */}
        <Collapsible open={isAddonsOpen} onOpenChange={setIsAddonsOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center justify-between w-full py-2 text-left">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Add-on Services
                </h4>
                {enabledAddons.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {enabledAddons.length} added
                  </Badge>
                )}
                {addonDiscount > 0 && (
                  <Badge variant="outline" className="text-[10px] text-success border-success/30">
                    {addonDiscount}% off with {tier.name}
                  </Badge>
                )}
              </div>
              {isAddonsOpen ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <div className="space-y-2 pt-2">
              {addonServices.map(service => (
                <ServiceRow
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
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
