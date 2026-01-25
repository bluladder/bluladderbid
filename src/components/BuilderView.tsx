import { Service, Perk, DiscountSettings, MemberDiscountSettings, PackageTier, ServiceFrequency, TierKey } from '@/types/servicePlan';
import { ServiceBundle } from '@/types/bundles';
import { ServiceSelector } from './ServiceSelector';
import { TierServiceConfigCard } from './TierServiceConfigCard';
import { SuggestedBundles } from './SuggestedBundles';
import { PerkToggle } from './PerkToggle';
import { DiscountControls } from './DiscountControls';
import { PlanSummaryCompact } from './PlanSummaryCompact';
import { WarningBanner } from './WarningBanner';
import { AddServiceForm } from './AddServiceForm';
import { AddPerkForm } from './AddPerkForm';
import { Button } from '@/components/ui/button';
import { Settings2, Gift, ArrowRight } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';

interface BuilderViewProps {
  services: Service[];
  customServiceIds: Set<string>;
  perks: Perk[];
  customPerkIds: Set<string>;
  discounts: DiscountSettings;
  memberDiscounts: MemberDiscountSettings;
  packages: PackageTier[];
  warnings: string[];
  depositPercent: number;
  pricingDisplayMode: 'monthly' | 'deposit';
  onToggleService: (id: string) => void;
  onServicePriceChange: (id: string, price: number) => void;
  onServiceNoteChange: (id: string, note: string) => void;
  onServiceFrequencyChange: (id: string, frequency: ServiceFrequency) => void;
  onServiceTierAvailabilityChange: (id: string, tier: TierKey, available: boolean) => void;
  onServiceTierFrequencyChange: (id: string, tier: TierKey, frequency: ServiceFrequency) => void;
  onServiceBestOnlyChange: (id: string, bestOnly: boolean) => void;
  onAddService: (name: string, price: number, frequency: ServiceFrequency, description: string) => void;
  onDeleteService: (id: string) => void;
  onReorderServices: (activeId: string, overId: string) => void;
  onTogglePerk: (id: string) => void;
  onPerkTierChange: (id: string, tier: Perk['tier']) => void;
  onAddPerk: (name: string, description: string, tier: Perk['tier']) => void;
  onDeletePerk: (id: string) => void;
  onApplyBundle: (bundle: ServiceBundle) => void;
  onDiscountChange: (key: keyof DiscountSettings, value: number) => void;
  onMemberDiscountChange: (key: keyof MemberDiscountSettings, value: number) => void;
  onDepositChange: (value: number) => void;
  onPricingDisplayModeChange: (mode: 'monthly' | 'deposit') => void;
  onGoToProposal?: () => void;
}

export function BuilderView({
  services,
  customServiceIds,
  perks,
  customPerkIds,
  discounts,
  memberDiscounts,
  packages,
  warnings,
  depositPercent,
  pricingDisplayMode,
  onToggleService,
  onServicePriceChange,
  onServiceNoteChange,
  onServiceFrequencyChange,
  onServiceTierAvailabilityChange,
  onServiceTierFrequencyChange,
  onServiceBestOnlyChange,
  onAddService,
  onDeleteService,
  onReorderServices,
  onTogglePerk,
  onPerkTierChange,
  onAddPerk,
  onDeletePerk,
  onApplyBundle,
  onDiscountChange,
  onMemberDiscountChange,
  onDepositChange,
  onPricingDisplayModeChange,
  onGoToProposal,
}: BuilderViewProps) {
  const selectedServices = services.filter(s => s.enabled);
  const hasSelectedServices = selectedServices.length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderServices(active.id as string, over.id as string);
    }
  };

  return (
    <div className="py-8 animate-fade-in">
      {warnings.length > 0 && (
        <div className="mb-6">
          <WarningBanner warnings={warnings} />
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-8">
        {/* Step 1: Service Selection */}
        <section>
          <div className="section-header">
            <div className="section-icon">
              <span className="text-primary-foreground font-bold text-sm">1</span>
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">
                Select Your Services
              </h2>
              <p className="text-xs text-muted-foreground">
                Choose the services you want to include
              </p>
            </div>
          </div>
          
          {/* Suggested Bundles - collapsible */}
          <SuggestedBundles onApplyBundle={onApplyBundle} />
          
          <ServiceSelector 
            services={services} 
            onToggle={onToggleService} 
          />
          
          <div className="mt-4">
            <AddServiceForm onAdd={onAddService} />
          </div>
        </section>

        {/* Step 2: Configure Selected Services */}
        {hasSelectedServices && (
          <section className="animate-fade-in">
            <div className="section-header">
              <div className="section-icon">
                <span className="text-primary-foreground font-bold text-sm">2</span>
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">
                  Set Pricing & Frequency
                </h2>
                <p className="text-xs text-muted-foreground">
                  Drag to reorder • Customize pricing for each service
                </p>
              </div>
            </div>
            
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={selectedServices.map(s => s.id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid gap-4">
                  {selectedServices.map((service, index) => (
                    <TierServiceConfigCard
                      key={service.id}
                      service={service}
                      orderNumber={index + 1}
                      onPriceChange={onServicePriceChange}
                      onNoteChange={onServiceNoteChange}
                      onFrequencyChange={onServiceFrequencyChange}
                      onTierAvailabilityChange={onServiceTierAvailabilityChange}
                      onTierFrequencyChange={onServiceTierFrequencyChange}
                      onBestOnlyChange={onServiceBestOnlyChange}
                      onRemove={onToggleService}
                      onDelete={onDeleteService}
                      isCustom={customServiceIds.has(service.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </section>
        )}

        {/* Plan Summary */}
        {hasSelectedServices && (
          <section className="animate-fade-in">
            <PlanSummaryCompact packages={packages} />
          </section>
        )}

        {/* Step 3: Benefits & Discounts (Always visible) */}
        {hasSelectedServices && (
          <section className="animate-fade-in">
            <div className="section-header">
              <div className="section-icon">
                <span className="text-primary-foreground font-bold text-sm">3</span>
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">
                  Benefits & Discount Settings
                </h2>
                <p className="text-xs text-muted-foreground">
                  Customize member perks and tier discounts
                </p>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Member Benefits Card */}
              <div className="card-elevated p-6">
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-sm">
                    <Gift className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-foreground">Member Benefits</h3>
                    <p className="text-xs text-muted-foreground">Perks & discounts for members</p>
                  </div>
                </div>
                
                {/* Member Discount Perks */}
                <div className="space-y-3 mb-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Member Discounts</p>
                  {perks.filter(p => p.id.startsWith('tier-discount-')).map((perk) => (
                    <PerkToggle
                      key={perk.id}
                      perk={perk}
                      onToggle={onTogglePerk}
                      onTierChange={onPerkTierChange}
                      onDelete={onDeletePerk}
                      isCustom={customPerkIds.has(perk.id)}
                      memberDiscounts={memberDiscounts}
                      onMemberDiscountChange={onMemberDiscountChange}
                    />
                  ))}
                </div>
                
                {/* Other Benefits */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Additional Benefits</p>
                  {perks.filter(p => !p.id.startsWith('tier-discount-')).map((perk) => (
                    <PerkToggle
                      key={perk.id}
                      perk={perk}
                      onToggle={onTogglePerk}
                      onTierChange={onPerkTierChange}
                      onDelete={onDeletePerk}
                      isCustom={customPerkIds.has(perk.id)}
                      memberDiscounts={memberDiscounts}
                      onMemberDiscountChange={onMemberDiscountChange}
                    />
                  ))}
                  <AddPerkForm onAdd={onAddPerk} />
                </div>
              </div>

              {/* Discount Controls Card */}
              <DiscountControls
                discounts={discounts}
                depositPercent={depositPercent}
                pricingDisplayMode={pricingDisplayMode}
                onDiscountChange={onDiscountChange}
                onDepositChange={onDepositChange}
                onPricingDisplayModeChange={onPricingDisplayModeChange}
              />
            </div>
          </section>
        )}

        {/* Empty state */}
        {!hasSelectedServices && (
          <div className="text-center py-12 card-elevated">
            <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
              <Settings2 className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-display text-lg font-semibold text-foreground mb-2">
              No Services Selected
            </h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Click on the service cards above to add them to your plan. 
              Selected services will appear here for pricing configuration.
            </p>
          </div>
        )}

        {/* Go to Proposal CTA */}
        {hasSelectedServices && onGoToProposal && (
          <div className="pt-8 pb-4">
            <Button 
              onClick={onGoToProposal}
              size="lg"
              className="w-full sm:w-auto mx-auto flex items-center gap-2 bg-gradient-to-r from-primary to-accent hover:from-primary-dark hover:to-primary text-primary-foreground font-semibold px-8 py-6 text-base shadow-lg hover:shadow-xl transition-all"
            >
              Preview Proposal
              <ArrowRight className="w-5 h-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}