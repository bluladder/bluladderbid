import { useState, useRef } from 'react';
import { PackageTier, BusinessDetails } from '@/types/servicePlan';
import { PackageCard } from './PackageCard';
import { CompanyDetailsCard } from './CompanyDetailsCard';
import { TierUpgradePath } from './TierUpgradePath';
import { Download, Loader2, Clock, CalendarIcon, User, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import html2pdf from 'html2pdf.js';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format, differenceInDays } from 'date-fns';

interface PresentationViewProps {
  packages: PackageTier[];
  businessDetails: BusinessDetails;
  customerName: string;
  customerAddress: string;
  onCustomerNameChange: (name: string) => void;
  onCustomerAddressChange: (address: string) => void;
  onBusinessDetailsChange: (key: keyof BusinessDetails, value: string) => void;
  showLimitedTimeOffer: boolean;
  limitedTimeOfferText: string;
  limitedTimeOfferExpiry: Date | undefined;
  onShowLimitedTimeOfferChange: (show: boolean) => void;
  onLimitedTimeOfferTextChange: (text: string) => void;
  onLimitedTimeOfferExpiryChange: (date: Date | undefined) => void;
  pricingDisplayMode: 'monthly' | 'deposit';
}

export function PresentationView({
  packages,
  businessDetails,
  customerName,
  customerAddress,
  onCustomerNameChange,
  onCustomerAddressChange,
  onBusinessDetailsChange,
  showLimitedTimeOffer,
  limitedTimeOfferText,
  limitedTimeOfferExpiry,
  onShowLimitedTimeOfferChange,
  onLimitedTimeOfferTextChange,
  onLimitedTimeOfferExpiryChange,
  pricingDisplayMode,
}: PresentationViewProps) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const proposalRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  if (packages.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">
          Select at least one service to build your plan.
        </p>
      </div>
    );
  }

  const handleDownloadPdf = async () => {
    if (!pdfRef.current || isGeneratingPdf) return;

    setIsGeneratingPdf(true);
    
    const filename = `${customerName || 'Customer'}-Service-Plan.pdf`;
    
    // Temporarily show the PDF-optimized layout
    pdfRef.current.style.display = 'block';
    
    const opt = {
      margin: [0.4, 0.5, 0.4, 0.5] as [number, number, number, number],
      filename,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { 
        scale: 2.5,
        useCORS: true,
        letterRendering: true,
      },
      jsPDF: { 
        unit: 'in' as const, 
        format: 'letter' as const, 
        orientation: 'portrait' as const 
      },
    };

    try {
      await html2pdf().set(opt).from(pdfRef.current).save();
      toast.success('Service plan downloaded!');
    } catch (err) {
      toast.error('Failed to generate PDF. Please try again.');
      console.error('PDF generation error:', err);
    } finally {
      // Hide the PDF layout again
      pdfRef.current.style.display = 'none';
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="py-8 animate-fade-in">
      {/* Settings Panel */}
      <div className="max-w-4xl mx-auto mb-8 space-y-4">
        {/* Company Details - Prominent placement */}
        <CompanyDetailsCard 
          details={businessDetails}
          onChange={onBusinessDetailsChange}
        />

        {/* Customer & Proposal Settings */}
        <div className="card-elevated p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Customer Info */}
            <div className="flex-1 min-w-[200px]">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                <User className="w-3.5 h-3.5" />
                Customer Name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => onCustomerNameChange(e.target.value)}
                placeholder="Enter customer name"
                className="input-field"
                maxLength={100}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Property Address
              </label>
              <input
                type="text"
                value={customerAddress}
                onChange={(e) => onCustomerAddressChange(e.target.value)}
                placeholder="Enter property address"
                className="input-field"
                maxLength={200}
              />
            </div>
            <button
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf}
              className="btn-primary h-10"
            >
              {isGeneratingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Download Proposal
                </>
              )}
            </button>
          </div>
        </div>

        {/* Limited Time Offer Controls */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Show Limited Time Offer</span>
            </div>
            <Switch
              checked={showLimitedTimeOffer}
              onCheckedChange={onShowLimitedTimeOfferChange}
            />
          </div>
          {showLimitedTimeOffer && (
            <div className="mt-3 space-y-3 animate-fade-in">
              <input
                type="text"
                value={limitedTimeOfferText}
                onChange={(e) => onLimitedTimeOfferTextChange(e.target.value)}
                placeholder="Enter offer message..."
                className="input-field text-sm w-full"
                maxLength={100}
              />
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Expires:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 justify-start text-left font-normal h-9",
                        !limitedTimeOfferExpiry && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {limitedTimeOfferExpiry ? format(limitedTimeOfferExpiry, "PPP") : <span>Pick expiration date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                    <Calendar
                      mode="single"
                      selected={limitedTimeOfferExpiry}
                      onSelect={onLimitedTimeOfferExpiryChange}
                      disabled={(date) => date < new Date()}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                {limitedTimeOfferExpiry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onLimitedTimeOfferExpiryChange(undefined)}
                    className="text-xs text-muted-foreground"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Proposal Preview */}
      <div ref={proposalRef} className="bg-background p-4">
        {/* Header with logo and company info */}
        <div className="text-center mb-6">
          {businessDetails.logo && (
            <div className="flex justify-center mb-4">
              <img
                src={businessDetails.logo}
                alt={businessDetails.businessName}
                className="h-12 object-contain"
              />
            </div>
          )}
          <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-2">
            Your Service Plan Options
          </h1>
          <p className="text-muted-foreground">
            Prepared by {businessDetails.businessName}{customerName && ` for ${customerName}`}
          </p>
          {(businessDetails.phone || businessDetails.email) && (
            <p className="text-sm text-muted-foreground mt-1">
              {businessDetails.phone}{businessDetails.phone && businessDetails.email && ' • '}{businessDetails.email}
            </p>
          )}
        </div>

        {/* Limited Time Offer Banner */}
        {showLimitedTimeOffer && (
          <div className="max-w-5xl mx-auto mb-6 animate-fade-in">
            <div className="bg-primary text-primary-foreground rounded-lg py-3 px-6 text-center">
              <span className="font-display text-lg font-bold">
                {limitedTimeOfferText}
              </span>
              {limitedTimeOfferExpiry && (
                <span className="ml-3 inline-flex items-center gap-1.5 bg-primary-foreground/20 px-3 py-1 rounded-full text-sm font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  {(() => {
                    const daysLeft = differenceInDays(limitedTimeOfferExpiry, new Date());
                    if (daysLeft <= 0) return 'Expires today!';
                    if (daysLeft === 1) return '1 day left';
                    return `${daysLeft} days left`;
                  })()}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {packages.map((pkg, index) => (
            <PackageCard
              key={pkg.tier}
              pkg={pkg}
              isHighlighted={index === 1}
              showPayInFull={true}
              pricingDisplayMode={pricingDisplayMode}
            />
          ))}
        </div>

        {/* Upgrade Path - Shows value of upgrading between tiers */}
        <div className="max-w-5xl mx-auto mt-8">
          <TierUpgradePath packages={packages} />
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            All plans include our satisfaction guarantee.{' '}
            {pricingDisplayMode === 'deposit' 
              ? 'Deposit collected at signup, remaining balance divided into 11 monthly payments.' 
              : 'Billed monthly for your convenience.'}{' '}
            Pay-in-full discount available.
          </p>
        </div>
      </div>

      {/* Hidden PDF-optimized layout - Portrait with enhanced visual design */}
      <div 
        ref={pdfRef} 
        className="bg-white text-foreground"
        style={{ 
          display: 'none',
          width: '7.5in',
          padding: '0.4in',
          fontSize: '13px',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* === PAGE 1: Header + Package Cards === */}
        <div style={{ minHeight: '9.5in', pageBreakAfter: 'always' }}>
          {/* Header with gradient accent */}
          <div className="text-center mb-6 pb-4" style={{ borderBottom: '3px solid #00CFFF' }}>
            {businessDetails.logo && (
              <div className="flex justify-center mb-4">
                <img
                  src={businessDetails.logo}
                  alt={businessDetails.businessName}
                  style={{ height: '100px', objectFit: 'contain' }}
                />
              </div>
            )}
            <h1 style={{ 
              fontSize: '28px', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              color: '#1a1a1a',
              letterSpacing: '-0.02em'
            }}>
              Your Service Plan Options
            </h1>
            <p style={{ fontSize: '15px', color: '#555', marginBottom: '4px' }}>
              Prepared by {businessDetails.businessName}{customerName && ` for ${customerName}`}
            </p>
            {customerAddress && (
              <p style={{ fontSize: '13px', color: '#777', marginTop: '4px' }}>
                📍 {customerAddress}
              </p>
            )}
            {(businessDetails.phone || businessDetails.email) && (
              <p style={{ fontSize: '13px', color: '#777', marginTop: '4px' }}>
                {businessDetails.phone}{businessDetails.phone && businessDetails.email && ' • '}{businessDetails.email}
              </p>
            )}
          </div>

          {/* Limited Time Offer */}
          {showLimitedTimeOffer && (
            <div className="mb-5">
              <div style={{ 
                background: 'linear-gradient(135deg, #00CFFF 0%, #00a8d4 100%)',
                color: 'white',
                borderRadius: '10px',
                padding: '14px 20px',
                textAlign: 'center',
                boxShadow: '0 4px 12px rgba(0, 207, 255, 0.25)'
              }}>
                <span style={{ fontSize: '16px', fontWeight: 'bold' }}>
                  🎉 {limitedTimeOfferText}
                </span>
                {limitedTimeOfferExpiry && (
                  <span style={{ 
                    marginLeft: '12px', 
                    background: 'rgba(255,255,255,0.2)', 
                    padding: '4px 12px', 
                    borderRadius: '20px',
                    fontSize: '13px'
                  }}>
                    ⏰ {differenceInDays(limitedTimeOfferExpiry, new Date())} days left
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Package Cards - Side by side columns for comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {packages.map((pkg, index) => (
              <PdfPackageCardVertical
                key={pkg.tier}
                pkg={pkg}
                isHighlighted={index === 1}
                pricingDisplayMode={pricingDisplayMode}
              />
            ))}
          </div>

          {/* Page 1 Footer */}
          <div className="mt-4 text-center" style={{ paddingTop: '12px', borderTop: '1px solid #e5e5e5' }}>
            <p style={{ fontSize: '11px', color: '#888' }}>
              All plans include our satisfaction guarantee. See next page for detailed comparison and payment options.
            </p>
          </div>
        </div>

        {/* === PAGE 2: Upgrade Path + Details === */}
        <div style={{ minHeight: '9.5in' }}>
          {/* Page 2 Header */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            marginBottom: '16px', 
            paddingBottom: '10px', 
            borderBottom: '3px solid #00CFFF' 
          }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '2px' }}>
                Plan Comparison
              </h2>
              <p style={{ fontSize: '12px', color: '#666' }}>See what you gain at each tier</p>
            </div>
            {businessDetails.logo && (
              <img
                src={businessDetails.logo}
                alt={businessDetails.businessName}
                style={{ height: '36px', objectFit: 'contain' }}
              />
            )}
          </div>

          {/* Tier Comparison Table */}
          <div style={{ marginBottom: '18px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e5e5' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: '600', color: '#666' }}>Feature</th>
                  {packages.map((pkg, index) => (
                    <th 
                      key={pkg.tier} 
                      style={{ 
                        textAlign: 'center', 
                        padding: '10px 12px', 
                        fontWeight: 'bold',
                        background: index === 1 ? 'rgba(0, 207, 255, 0.1)' : 'transparent',
                        borderRadius: index === 1 ? '8px 8px 0 0' : '0'
                      }}
                    >
                      {pkg.name}
                      <div style={{ fontSize: '11px', fontWeight: 'normal', color: '#888' }}>{pkg.tierLabel}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Pricing Row */}
                <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '10px 12px', fontWeight: '500' }}>Monthly Price</td>
                  {packages.map((pkg, index) => (
                    <td key={pkg.tier} style={{ 
                      textAlign: 'center', 
                      padding: '10px 12px', 
                      fontWeight: 'bold', 
                      fontSize: '16px',
                      color: index === 1 ? '#00CFFF' : '#1a1a1a',
                      background: index === 1 ? 'rgba(0, 207, 255, 0.1)' : 'transparent'
                    }}>
                      ${pkg.monthlyPrice.toFixed(0)}/mo
                    </td>
                  ))}
                </tr>
                {/* Annual Total Row */}
                <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '10px 12px', fontWeight: '500' }}>Annual Total</td>
                  {packages.map((pkg, index) => (
                    <td key={pkg.tier} style={{ 
                      textAlign: 'center', 
                      padding: '10px 12px',
                      background: index === 1 ? 'rgba(0, 207, 255, 0.1)' : 'transparent'
                    }}>
                      ${pkg.annualTotal.toFixed(0)}/year
                    </td>
                  ))}
                </tr>
                {/* Savings Row */}
                <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '10px 12px', fontWeight: '500' }}>Member Discount</td>
                  {packages.map((pkg, index) => (
                    <td key={pkg.tier} style={{ 
                      textAlign: 'center', 
                      padding: '10px 12px', 
                      fontWeight: '600', 
                      color: '#16a34a',
                      background: index === 1 ? 'rgba(0, 207, 255, 0.1)' : 'transparent'
                    }}>
                      {pkg.savingsPercent}% (Save ${pkg.savings.toFixed(0)})
                    </td>
                  ))}
                </tr>
                {/* Service Visits Row */}
                <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '10px 12px', fontWeight: '500' }}>Total Service Visits</td>
                  {packages.map((pkg, index) => (
                    <td key={pkg.tier} style={{ 
                      textAlign: 'center', 
                      padding: '10px 12px',
                      background: index === 1 ? 'rgba(0, 207, 255, 0.1)' : 'transparent'
                    }}>
                      {pkg.tierServices.reduce((sum, ts) => sum + ts.annualVisits, 0)} visits/year
                    </td>
                  ))}
                </tr>
                {/* Services Count Row */}
                <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '10px 12px', fontWeight: '500' }}>Services Included</td>
                  {packages.map((pkg, index) => (
                    <td key={pkg.tier} style={{ 
                      textAlign: 'center', 
                      padding: '10px 12px',
                      background: index === 1 ? 'rgba(0, 207, 255, 0.1)' : 'transparent'
                    }}>
                      {pkg.tierServices.length} services
                    </td>
                  ))}
                </tr>
                {/* Benefits Row */}
                <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                  <td style={{ padding: '10px 12px', fontWeight: '500' }}>Member Benefits</td>
                  {packages.map((pkg, index) => (
                    <td key={pkg.tier} style={{ 
                      textAlign: 'center', 
                      padding: '10px 12px',
                      background: index === 1 ? 'rgba(0, 207, 255, 0.1)' : 'transparent',
                      borderRadius: index === 1 ? '0 0 8px 8px' : '0'
                    }}>
                      {pkg.perks.length} benefits
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Service Details by Tier */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#1a1a1a' }}>
              Services by Tier
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {packages.map((pkg, index) => (
                <div 
                  key={pkg.tier} 
                  style={{ 
                    padding: '14px',
                    borderRadius: '10px',
                    border: index === 1 ? '2px solid #00CFFF' : '1px solid #e5e5e5',
                    background: index === 1 ? 'rgba(0, 207, 255, 0.05)' : '#fafafa'
                  }}
                >
                  <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px', color: '#1a1a1a' }}>
                    {pkg.name} Plan
                  </h4>
                  <ul style={{ fontSize: '12px', margin: 0, padding: 0, listStyle: 'none' }}>
                    {pkg.tierServices.map((ts, i) => (
                      <li key={`${ts.service.id}-${i}`} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        padding: '4px 0',
                        borderBottom: i < pkg.tierServices.length - 1 ? '1px solid #eee' : 'none'
                      }}>
                        <span>{ts.service.name}</span>
                        <span style={{ color: '#666', fontWeight: '500' }}>
                          {ts.annualVisits === 1 ? '1x/yr' : ts.annualVisits === 2 ? '2x/yr' : ts.annualVisits === 4 ? '4x/yr' : `${ts.annualVisits}x/yr`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Payment Options */}
          <div style={{ 
            marginBottom: '16px', 
            padding: '14px 16px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #f8f9fa 0%, #f0f4f8 100%)',
            border: '1px solid #e5e5e5'
          }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px', color: '#1a1a1a' }}>
              💳 Payment Options
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', fontSize: '11px' }}>
              <div>
                <h4 style={{ fontWeight: '600', marginBottom: '4px', color: '#1a1a1a', fontSize: '12px' }}>Monthly Payment Plan</h4>
                <p style={{ color: '#555', margin: 0, lineHeight: '1.4' }}>
                  Small deposit upfront, then 11 equal monthly payments. No interest.
                </p>
              </div>
              <div>
                <h4 style={{ fontWeight: '600', marginBottom: '4px', color: '#1a1a1a', fontSize: '12px' }}>Pay in Full Discount</h4>
                <p style={{ color: '#555', margin: 0, lineHeight: '1.4' }}>
                  Save an additional 5% when you pay for the full year upfront.
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ 
            textAlign: 'center', 
            paddingTop: '16px', 
            borderTop: '2px solid #e5e5e5',
            fontSize: '13px'
          }}>
            <p style={{ color: '#555', marginBottom: '6px' }}>
              Questions? Contact us at {businessDetails.phone || businessDetails.email || 'your convenience'}.
            </p>
            {businessDetails.licenseStatement && (
              <p style={{ color: '#888', fontSize: '11px', margin: 0 }}>
                {businessDetails.licenseStatement}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Vertical PDF package card for side-by-side comparison on page 1
function PdfPackageCardVertical({ pkg, isHighlighted, pricingDisplayMode = 'deposit' }: { pkg: PackageTier; isHighlighted?: boolean; pricingDisplayMode?: 'monthly' | 'deposit' }) {
  const isBest = pkg.tier === 'best';
  const isBetter = pkg.tier === 'better';
  
  // Get tier-specific label
  const getHelperLabel = () => {
    if (isBetter) return { label: 'Most Popular', icon: '⭐' };
    if (isBest) return { label: 'Best Value', icon: '👑' };
    return null;
  };
  
  const helperLabel = getHelperLabel();
  
  return (
    <div
      style={{
        border: isBest ? '2px solid #16a34a' : isBetter ? '2px solid #00CFFF' : '1px solid #e0e0e0',
        borderRadius: '10px',
        overflow: 'hidden',
        background: isBest 
          ? 'linear-gradient(180deg, rgba(22, 163, 74, 0.08) 0%, #fff 100%)' 
          : isBetter 
          ? 'linear-gradient(180deg, rgba(0, 207, 255, 0.08) 0%, #fff 100%)' 
          : '#fff',
        boxShadow: isBest 
          ? '0 4px 16px rgba(22, 163, 74, 0.2)' 
          : isBetter 
          ? '0 4px 16px rgba(0, 207, 255, 0.2)' 
          : '0 1px 4px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Header */}
      <div style={{ 
        background: isBest 
          ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' 
          : isBetter 
          ? 'linear-gradient(135deg, #00CFFF 0%, #00a8d4 100%)' 
          : '#f5f5f5',
        color: (isBetter || isBest) ? 'white' : '#333',
        textAlign: 'center',
        padding: '10px 8px',
      }}>
        <h3 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0 }}>
          {pkg.name}
        </h3>
        <p style={{ fontSize: '10px', margin: '2px 0 0 0', opacity: 0.85 }}>
          {pkg.tierLabel}
        </p>
        {helperLabel && (
          <span style={{ 
            display: 'inline-block',
            marginTop: '4px',
            fontSize: '9px', 
            fontWeight: 'bold', 
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            background: 'rgba(255,255,255,0.2)',
            padding: '2px 8px',
            borderRadius: '10px'
          }}>
            {helperLabel.icon} {helperLabel.label}
          </span>
        )}
      </div>

      {/* Pricing */}
      <div style={{ 
        textAlign: 'center', 
        padding: '14px 10px',
        background: isBest ? 'rgba(22, 163, 74, 0.05)' : isBetter ? 'rgba(0, 207, 255, 0.05)' : '#fafafa',
        borderBottom: '1px solid #eee'
      }}>
        {/* Monthly Price (Hero) */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '2px' }}>
          <span style={{ fontSize: '28px', fontWeight: 'bold', color: isBest ? '#16a34a' : isBetter ? '#00CFFF' : '#1a1a1a' }}>
            ${(
              pricingDisplayMode === 'monthly'
                ? pkg.monthlyPrice
                : (pkg.annualTotal - pkg.depositAmount) / 11
            ).toFixed(0)}
          </span>
          <span style={{ fontSize: '12px', color: '#888' }}>/mo</span>
        </div>

        {pricingDisplayMode === 'deposit' ? (
          <p style={{ fontSize: '10px', color: '#666', margin: '4px 0 0 0' }}>
            after ${pkg.depositAmount.toFixed(0)} deposit (11 monthly payments)
          </p>
        ) : (
          <p style={{ fontSize: '10px', color: '#666', margin: '4px 0 0 0' }}>
            flat monthly rate
          </p>
        )}

        <p style={{ fontSize: '10px', color: '#888', margin: '6px 0 0 0' }}>
          ${pkg.annualTotal.toFixed(0)}/year total
        </p>

        {/* Savings Highlight - Always shown */}
        <div style={{ 
          background: pkg.tier === 'best' ? 'rgba(22, 163, 74, 0.12)' : pkg.tier === 'better' ? 'rgba(0, 207, 255, 0.12)' : '#f0f0f0',
          border: pkg.tier === 'best' ? '1px solid rgba(22, 163, 74, 0.25)' : pkg.tier === 'better' ? '1px solid rgba(0, 207, 255, 0.25)' : '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '8px 10px',
          marginTop: '10px'
        }}>
          <p style={{ fontSize: '8px', fontWeight: '700', letterSpacing: '0.06em', color: '#666', margin: 0, textTransform: 'uppercase' }}>
            Total Savings
          </p>
          <p style={{ 
            fontSize: '18px', 
            fontWeight: 'bold', 
            color: pkg.tier === 'best' ? '#16a34a' : pkg.tier === 'better' ? '#00CFFF' : '#333',
            margin: '2px 0 0 0'
          }}>
            Save ${Math.max(0, pkg.savings).toFixed(0)}
          </p>
          <p style={{ fontSize: '9px', color: '#666', margin: '2px 0 0 0' }}>
            {Math.max(0, pkg.savingsPercent)}% off retail
          </p>
        </div>
      </div>

      {/* Services */}
      <div style={{ padding: '10px', flex: 1 }}>
        <p style={{ 
          fontSize: '9px', 
          fontWeight: '600', 
          color: '#888', 
          textTransform: 'uppercase', 
          marginBottom: '6px',
          letterSpacing: '0.04em'
        }}>
          Services
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {pkg.tierServices.map((ts, index) => (
            <li key={`${ts.service.id}-${index}`} style={{ 
              fontSize: '10px',
              padding: '3px 0',
              borderBottom: index < pkg.tierServices.length - 1 ? '1px solid #f0f0f0' : 'none'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#16a34a', fontSize: '9px' }}>✓</span>
                  {ts.service.name}
                </span>
                <span style={{ color: '#888', fontWeight: '500', fontSize: '9px' }}>
                  {ts.annualVisits}x/yr
                </span>
              </div>
              {ts.service.note && (
                <p style={{ fontSize: '8px', color: '#888', margin: '2px 0 0 14px', fontStyle: 'italic' }}>
                  {ts.service.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Benefits */}
      {pkg.perks.length > 0 && (
        <div style={{ padding: '10px', borderTop: '1px solid #eee', background: '#fafafa' }}>
          <p style={{ 
            fontSize: '9px', 
            fontWeight: '600', 
            color: '#888', 
            textTransform: 'uppercase', 
            marginBottom: '6px',
            letterSpacing: '0.04em'
          }}>
            Benefits
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {pkg.perks.map((perk) => {
              const isBestOnly = perk.tier === 'best' && pkg.tier === 'best';
              return (
                <li key={perk.id} style={{ 
                  fontSize: '9px', 
                  padding: '2px 0',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '4px',
                  color: isBestOnly ? '#16a34a' : '#555',
                  fontWeight: isBestOnly ? '600' : '400'
                }}>
                  <span style={{ color: isBestOnly ? '#16a34a' : '#00CFFF', flexShrink: 0 }}>
                    {isBestOnly ? '⚡' : '★'}
                  </span>
                  <span style={{ lineHeight: 1.3 }}>
                    {perk.name}
                    {isBestOnly && (
                      <span style={{ 
                        marginLeft: '4px',
                        fontSize: '7px', 
                        fontWeight: 'bold',
                        color: '#16a34a',
                        background: 'rgba(22, 163, 74, 0.1)',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em'
                      }}>
                        Exclusive
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// PDF-specific package card with enhanced visual design for portrait layout
function PdfPackageCard({ pkg, isHighlighted }: { pkg: PackageTier; isHighlighted?: boolean }) {
  return (
    <div
      style={{
        border: isHighlighted ? '2px solid #00CFFF' : '1px solid #e5e5e5',
        borderRadius: '12px',
        overflow: 'hidden',
        background: isHighlighted ? 'linear-gradient(135deg, rgba(0, 207, 255, 0.05) 0%, rgba(0, 207, 255, 0.1) 100%)' : '#fff',
        boxShadow: isHighlighted ? '0 4px 20px rgba(0, 207, 255, 0.15)' : '0 2px 8px rgba(0,0,0,0.05)'
      }}
    >
      {isHighlighted && (
        <div style={{ 
          background: 'linear-gradient(135deg, #00CFFF 0%, #00a8d4 100%)',
          color: 'white',
          textAlign: 'center',
          padding: '6px 0',
          fontWeight: 'bold',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontSize: '11px'
        }}>
          ⭐ Recommended
        </div>
      )}
      
      <div style={{ padding: '18px', display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {/* Left: Header + Pricing */}
        <div style={{ flex: '0 0 180px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: '#1a1a1a' }}>
            {pkg.name}
          </h3>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>{pkg.tierLabel}</p>

          <div style={{ 
            background: '#f8f9fa', 
            borderRadius: '10px', 
            padding: '12px',
            textAlign: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '4px' }}>
              <span style={{ fontSize: '28px', fontWeight: 'bold', color: isHighlighted ? '#00CFFF' : '#1a1a1a' }}>
                ${pkg.monthlyPrice.toFixed(0)}
              </span>
              <span style={{ fontSize: '14px', color: '#888' }}>/mo</span>
            </div>
            <p style={{ fontSize: '12px', color: '#666', marginTop: '4px', marginBottom: '0' }}>
              ${pkg.annualTotal.toFixed(0)}/year total
            </p>
            {pkg.savings > 0 && (
              <p style={{ 
                fontSize: '12px', 
                fontWeight: '600', 
                color: '#16a34a', 
                marginTop: '6px',
                marginBottom: '0',
                background: 'rgba(22, 163, 74, 0.1)',
                padding: '4px 8px',
                borderRadius: '6px',
                display: 'inline-block'
              }}>
                💰 Save ${pkg.savings.toFixed(0)} ({pkg.savingsPercent}% off)
              </p>
            )}
          </div>
        </div>

        {/* Middle: Services */}
        <div style={{ flex: '1', minWidth: '0' }}>
          <p style={{ 
            fontSize: '11px', 
            fontWeight: '600', 
            color: '#888', 
            textTransform: 'uppercase', 
            marginBottom: '8px',
            letterSpacing: '0.05em'
          }}>
            Services Included
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {pkg.tierServices.map((ts, index) => (
              <li key={`${ts.service.id}-${index}`} style={{ 
                fontSize: '12px',
                padding: '4px 0',
                borderBottom: index < pkg.tierServices.length - 1 ? '1px solid #eee' : 'none'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#16a34a' }}>✓</span>
                    {ts.service.name}
                  </span>
                  <span style={{ color: '#666', fontWeight: '500', fontSize: '11px' }}>
                    {ts.annualVisits === 1 ? '1x/yr' : ts.annualVisits === 2 ? '2x/yr' : ts.annualVisits === 4 ? '4x/yr' : `${ts.annualVisits}x/yr`}
                  </span>
                </div>
                {ts.service.note && (
                  <p style={{ fontSize: '10px', color: '#888', margin: '2px 0 0 20px', fontStyle: 'italic' }}>
                    {ts.service.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: Benefits */}
        {pkg.perks.length > 0 && (
          <div style={{ flex: '0 0 180px' }}>
            <p style={{ 
              fontSize: '11px', 
              fontWeight: '600', 
              color: '#888', 
              textTransform: 'uppercase', 
              marginBottom: '8px',
              letterSpacing: '0.05em'
            }}>
              Member Benefits
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {pkg.perks.map((perk) => {
                const isBestOnly = perk.tier === 'best' && pkg.tier === 'best';
                return (
                  <li key={perk.id} style={{ 
                    fontSize: '12px', 
                    padding: '4px 0',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    color: isBestOnly ? '#16a34a' : 'inherit',
                    fontWeight: isBestOnly ? '600' : '400'
                  }}>
                    <span style={{ color: isBestOnly ? '#16a34a' : '#00CFFF', flexShrink: 0 }}>
                      {isBestOnly ? '⚡' : '★'}
                    </span>
                    <span>
                      {perk.name}
                      {isBestOnly && (
                        <span style={{ 
                          marginLeft: '6px',
                          fontSize: '9px', 
                          fontWeight: 'bold',
                          color: '#16a34a',
                          background: 'rgba(22, 163, 74, 0.1)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}>
                          Exclusive
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}