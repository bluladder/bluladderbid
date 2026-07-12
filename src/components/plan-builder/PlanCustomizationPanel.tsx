import { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronUp, Sparkles, Home, Warehouse, Cloud, Droplets, Info, ArrowRight, Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PriceUpdateIndicator } from './PriceUpdateIndicator';
import type { TierConfig } from './TierSelector';
import type { ServicePlanService, ServicePlanPayment } from '@/types/servicePlanBuilder';

interface PlanCustomizationPanelProps {
  tier: TierConfig;
  services: ServicePlanService[];
  payment: ServicePlanPayment;
  homeSquareFootage: number;
  onToggleService: (serviceId: string) => void;
  onChangeFrequency: (serviceId: string, frequency: 1 | 2 | 3 | 4) => void;
  onContinue: () => void;
  onCompare: () => void;
  pricingReady?: boolean;
  pricingLoading?: boolean;
  pricingUnavailable?: boolean;
}

const SERVICE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Sparkles,
  Home,
  Warehouse,
  Cloud,
  Droplets,
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function PlanCustomizationPanel({
  tier,
  services,
  payment,
  homeSquareFootage,
  onToggleService,
  onChangeFrequency,
  onContinue,
  onCompare,
  pricingReady = true,
  pricingLoading,
  pricingUnavailable,
}: PlanCustomizationPanelProps) {
  const [showFrequencyControls, setShowFrequencyControls] = useState(false);
  // A dollar figure is shown ONLY when it is a current, firm server price.
  const money = (v: number) => (pricingReady ? formatPrice(v) : '—');
  
  // Determine which services are included in the tier
  const includedServiceIds = new Set<string>();
  tier.includedServices.forEach(service => {
    if (service.includes('Exterior Windows')) includedServiceIds.add('window-cleaning-exterior');
    if (service.includes('Interior Windows')) includedServiceIds.add('window-cleaning-interior');
    if (service.includes('Gutter')) includedServiceIds.add('gutter-cleaning');
    if (service.includes('House Wash')) includedServiceIds.add('house-wash');
    if (service.includes('Roof')) includedServiceIds.add('roof-cleaning');
  });

  const enabledServices = services.filter(s => s.enabled);
  const hasValidPricing = homeSquareFootage > 0;

  return (
    <TooltipProvider>
      <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
        {/* Minimal Header with Update Indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge className={`px-3 py-1.5 ${
              tier.id === 'good' ? 'bg-slate-100 text-slate-700' :
              tier.id === 'better' ? 'bg-primary/10 text-primary' :
              'bg-amber-100 text-amber-700'
            }`}>
              {tier.name} Plan
            </Badge>
            <span className="text-sm text-muted-foreground">
              {enabledServices.length} services
            </span>
            <PriceUpdateIndicator price={payment.annualTotal} />
          </div>
        </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Services List (2 columns on large screens) */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              {/* All Services */}
              <div className="space-y-3">
                {services.map(service => {
                  const Icon = SERVICE_ICONS[service.icon] || Sparkles;
                  const isIncludedInTier = includedServiceIds.has(service.id);
                  const isEnabled = service.enabled;

                  return (
                    <div
                      key={service.id}
                      className={`
                        relative p-3 rounded-lg border-2 transition-all
                        ${isEnabled 
                          ? 'bg-primary/5 border-primary/30' 
                          : 'bg-muted/30 border-transparent hover:border-muted-foreground/20'
                        }
                      `}
                    >
                      <div className="flex items-start gap-3">
                        {/* Toggle Checkbox */}
                        <button
                          onClick={() => onToggleService(service.id)}
                          className={`
                            mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                            ${isEnabled 
                              ? 'bg-primary border-primary text-primary-foreground' 
                              : 'border-muted-foreground/30 hover:border-primary/50'
                            }
                          `}
                        >
                          {isEnabled && <Check className="w-3 h-3" />}
                        </button>

                        {/* Icon */}
                        <div className={`
                          flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
                          ${isEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}
                        `}>
                          <Icon className="w-4 h-4" />
                        </div>

                        {/* Service Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className={`font-medium text-sm ${isEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {service.name}
                            </h4>
                            {isIncludedInTier && isEnabled && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Included
                              </Badge>
                            )}
                            {!isIncludedInTier && isEnabled && tier.addonDiscount > 0 && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-success border-success/30">
                                {tier.addonDiscount}% off
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {service.description}
                          </p>

                          {/* Pricing + Frequency */}
                          {isEnabled && hasValidPricing && (
                            <div className="mt-2 flex items-center justify-between">
                              <div className="flex items-baseline gap-1">
                                <span className="font-semibold text-foreground">
                                  {formatPrice(service.annualTotal)}
                                </span>
                                <span className="text-xs text-muted-foreground">/yr</span>
                              </div>

                              {/* Frequency Selector */}
                              {showFrequencyControls && (
                                <div className="flex items-center gap-1">
                                  {[1, 2, 3, 4].map(freq => (
                                    <button
                                      key={freq}
                                      onClick={() => onChangeFrequency(service.id, freq as 1 | 2 | 3 | 4)}
                                      className={`
                                        px-2 py-0.5 text-xs rounded transition-colors
                                        ${service.frequency === freq 
                                          ? 'bg-primary text-primary-foreground' 
                                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                        }
                                      `}
                                    >
                                      {freq}x
                                    </button>
                                  ))}
                                </div>
                              )}

                              {!showFrequencyControls && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {service.frequency}x per year
                                </Badge>
                              )}
                            </div>
                          )}

                          {!isEnabled && hasValidPricing && (
                            <div className="mt-1.5">
                              <span className="text-xs text-muted-foreground">
                                Add for {formatPrice(service.calculatedPrice)}/visit
                              </span>
                            </div>
                          )}

                          {!hasValidPricing && (
                            <p className="text-xs text-muted-foreground italic mt-1">
                              Enter home sqft for pricing
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Frequency Toggle */}
              <Collapsible open={showFrequencyControls} onOpenChange={setShowFrequencyControls}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 py-2 text-sm text-primary hover:text-primary/80 transition-colors w-full justify-center">
                    {showFrequencyControls ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        Hide frequency controls
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        Adjust service frequency
                      </>
                    )}
                  </button>
                </CollapsibleTrigger>
              </Collapsible>
            </CardContent>
          </Card>
        </div>

          {/* Live Price Breakdown (Sticky Sidebar) */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24">
              <Card className="bg-gradient-to-b from-primary/5 to-background border-primary/20 shadow-lg">
                <CardContent className="p-4 space-y-4">
                  {/* Monthly Price with Tooltip */}
                  <div className="text-center">
                    <div className="text-3xl font-bold text-primary transition-all duration-300">
                      {formatPrice(payment.monthlyPayment)}
                      <span className="text-base font-normal text-muted-foreground">/mo</span>
                    </div>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      <span className="text-xs text-muted-foreground">
                        Billed monthly after 20% deposit
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="text-muted-foreground/70 hover:text-muted-foreground">
                            <Info className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">
                            Deposit secures your annual service schedule. 
                            Remaining balance is split into 11 easy monthly payments.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  <Separator />

                  {/* Price Breakdown */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Annual value</span>
                      <span className="font-medium">{formatPrice(payment.annualTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Today's deposit (20%)</span>
                      <span className="font-medium">{formatPrice(payment.downPayment)}</span>
                    </div>
                    <div className="flex justify-between text-primary font-semibold border-t pt-2">
                      <span>Then 11 payments of</span>
                      <span>{formatPrice(payment.monthlyPayment)}</span>
                    </div>
                  </div>

                  <Separator />

                  {/* Enabled Services Summary */}
                  <div className="space-y-1.5">
                    {enabledServices.map(s => (
                      <div key={s.id} className="flex items-center gap-1.5 text-xs">
                        <Check className="w-3 h-3 text-success flex-shrink-0" />
                        <span className="truncate">{s.name}</span>
                        <span className="text-muted-foreground">({s.frequency}x)</span>
                      </div>
                    ))}
                  </div>

                  {/* CTAs */}
                  <div className="space-y-2 pt-2">
                    <Button 
                      onClick={onContinue}
                      className="w-full shadow-md"
                      size="lg"
                      disabled={enabledServices.length === 0 || !hasValidPricing}
                    >
                      <Lock className="w-4 h-4 mr-2" />
                      Lock in This Plan
                    </Button>
                    <Button 
                      onClick={onCompare}
                      variant="ghost"
                      className="w-full text-sm"
                    >
                      Compare Plans
                    </Button>
                  </div>

                  {/* Reassurance */}
                  <p className="text-xs text-center text-muted-foreground">
                    Review everything before booking
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
