import { useState } from 'react';
import { usePlanBuilder } from '@/hooks/usePlanBuilder';
import { Header, ViewMode } from '@/components/Header';
import { BuilderView } from '@/components/BuilderView';
import { PresentationView } from '@/components/PresentationView';
import { AgreementView } from '@/components/AgreementView';

const Index = () => {
  const [currentView, setCurrentView] = useState<ViewMode>('builder');
  const builder = usePlanBuilder();

  return (
    <div className="min-h-screen bg-background">
      <Header
        businessName={builder.businessDetails.businessName}
        onBusinessNameChange={(name) => builder.updateBusinessDetails('businessName', name)}
        currentView={currentView}
        onViewChange={setCurrentView}
      />

      <main className="container">
        {currentView === 'builder' && (
          <BuilderView
            services={builder.services}
            customServiceIds={builder.customServiceIds}
            perks={builder.perks}
            customPerkIds={builder.customPerkIds}
            discounts={builder.discounts}
            memberDiscounts={builder.memberDiscounts}
            packages={builder.packages}
            warnings={builder.warnings}
            depositPercent={builder.depositPercent}
            pricingDisplayMode={builder.pricingDisplayMode}
            onToggleService={builder.toggleService}
            onServicePriceChange={builder.updateServicePrice}
            onServiceNoteChange={builder.updateServiceNote}
            onServiceFrequencyChange={builder.updateServiceFrequency}
            onServiceTierAvailabilityChange={builder.updateServiceTierAvailability}
            onServiceTierFrequencyChange={builder.updateServiceTierFrequency}
            onServiceBestOnlyChange={builder.updateServiceBestOnly}
            onAddService={builder.addCustomService}
            onDeleteService={builder.deleteService}
            onReorderServices={builder.reorderServices}
            onTogglePerk={builder.togglePerk}
            onPerkTierChange={builder.updatePerkTier}
            onAddPerk={builder.addCustomPerk}
            onDeletePerk={builder.deletePerk}
            onApplyBundle={builder.applyBundle}
            onDiscountChange={builder.updateDiscount}
            onMemberDiscountChange={builder.updateMemberDiscount}
            onDepositChange={builder.setDepositPercent}
            onPricingDisplayModeChange={builder.setPricingDisplayMode}
            onGoToProposal={() => {
              setCurrentView('preview');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}

        {currentView === 'preview' && (
          <PresentationView
            packages={builder.packages}
            businessDetails={builder.businessDetails}
            customerName={builder.customerName}
            customerAddress={builder.customerAddress}
            onCustomerNameChange={builder.setCustomerName}
            onCustomerAddressChange={builder.setCustomerAddress}
            onBusinessDetailsChange={builder.updateBusinessDetails}
            showLimitedTimeOffer={builder.showLimitedTimeOffer}
            limitedTimeOfferText={builder.limitedTimeOfferText}
            limitedTimeOfferExpiry={builder.limitedTimeOfferExpiry}
            onShowLimitedTimeOfferChange={builder.setShowLimitedTimeOffer}
            onLimitedTimeOfferTextChange={builder.setLimitedTimeOfferText}
            onLimitedTimeOfferExpiryChange={builder.setLimitedTimeOfferExpiry}
            pricingDisplayMode={builder.pricingDisplayMode}
          />
        )}

        {currentView === 'agreement' && (
          <AgreementView
            packages={builder.packages}
            businessDetails={builder.businessDetails}
            agreementTerms={builder.agreementTerms}
            customerName={builder.customerName}
            customerAddress={builder.customerAddress}
            selectedTier={builder.selectedTier}
            pricingDisplayMode={builder.pricingDisplayMode}
            onBusinessDetailsChange={builder.updateBusinessDetails}
            onAgreementTermsChange={builder.updateAgreementTerms}
            onCustomerNameChange={builder.setCustomerName}
            onCustomerAddressChange={builder.setCustomerAddress}
            onSelectedTierChange={builder.setSelectedTier}
          />
        )}
      </main>

      <footer className="border-t border-border mt-16">
        <div className="container py-6 text-center text-sm text-muted-foreground">
          Service Plan Builder by Next Level Clean Pro
        </div>
      </footer>
    </div>
  );
};

export default Index;
