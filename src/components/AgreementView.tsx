import { useState, useRef } from 'react';
import { PackageTier, BusinessDetails, AgreementTerms } from '@/types/servicePlan';
import { CompanyDetailsCard } from './CompanyDetailsCard';
import { AgreementTermsEditor } from './AgreementTermsEditor';
import { AgreementDocument } from './AgreementDocument';
import { Copy, Check, FileText, ChevronDown, ChevronUp, Download, Loader2, User, MapPin, Sliders } from 'lucide-react';
import { toast } from 'sonner';
import html2pdf from 'html2pdf.js';

interface AgreementViewProps {
  packages: PackageTier[];
  businessDetails: BusinessDetails;
  agreementTerms: AgreementTerms;
  customerName: string;
  customerAddress: string;
  selectedTier: 'good' | 'better' | 'best';
  pricingDisplayMode: 'monthly' | 'deposit';
  onBusinessDetailsChange: (key: keyof BusinessDetails, value: string) => void;
  onAgreementTermsChange: (key: keyof AgreementTerms, value: string | number) => void;
  onCustomerNameChange: (name: string) => void;
  onCustomerAddressChange: (address: string) => void;
  onSelectedTierChange: (tier: 'good' | 'better' | 'best') => void;
}

export function AgreementView({
  packages,
  businessDetails,
  agreementTerms,
  customerName,
  customerAddress,
  selectedTier,
  pricingDisplayMode,
  onBusinessDetailsChange,
  onAgreementTermsChange,
  onCustomerNameChange,
  onCustomerAddressChange,
  onSelectedTierChange,
}: AgreementViewProps) {
  const [copied, setCopied] = useState(false);
  const [showTermsEditor, setShowTermsEditor] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);

  const selectedPackage = packages.find((p) => p.tier === selectedTier);

  if (packages.length === 0) {
    return (
      <div className="py-16 text-center">
        <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="font-display text-xl font-semibold text-foreground mb-2">
          No Plan Configured
        </h2>
        <p className="text-muted-foreground">
          Go to the Builder tab and enable services to generate an agreement.
        </p>
      </div>
    );
  }

  if (!selectedPackage) {
    return null;
  }

  const handleCopyToClipboard = async () => {
    if (!documentRef.current) return;

    const text = documentRef.current.innerText;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Agreement copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy. Try selecting and copying manually.');
    }
  };

  const handleDownloadPdf = async () => {
    if (!documentRef.current || isGeneratingPdf) return;

    setIsGeneratingPdf(true);
    
    const filename = `${customerName || 'Customer'}-${selectedPackage.name}-Agreement.pdf`;
    
    const opt = {
      margin: [0.6, 0.5, 0.6, 0.5] as [number, number, number, number],
      filename,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { 
        scale: 2,
        useCORS: true,
        letterRendering: true,
      },
      jsPDF: { 
        unit: 'in' as const, 
        format: 'letter' as const, 
        orientation: 'portrait' as const 
      },
      pagebreak: { 
        mode: ['avoid-all', 'css', 'legacy'] as const,
        before: '.page-break-before',
        after: '.page-break-after',
        avoid: '.avoid-break'
      },
    };

    try {
      await html2pdf().set(opt).from(documentRef.current).save();
      toast.success('PDF downloaded successfully!');
    } catch (err) {
      toast.error('Failed to generate PDF. Please try again.');
      console.error('PDF generation error:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="py-8 animate-fade-in">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-2">
          Service Agreement
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Review and customize the agreement, then download or share with your customer.
        </p>
      </div>

      {/* Settings Panel */}
      <div className="max-w-3xl mx-auto mb-6 space-y-4">
        {/* Company Details - Prominent placement */}
        <CompanyDetailsCard 
          details={businessDetails}
          onChange={onBusinessDetailsChange}
        />

        {/* Customer & Plan Selection */}
        <div className="card-elevated p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Plan Selector */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Selected Plan
              </label>
              <div className="flex gap-1">
                {packages.map((pkg) => (
                  <button
                    key={pkg.tier}
                    onClick={() => onSelectedTierChange(pkg.tier)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedTier === pkg.tier
                        ? pkg.tier === 'good'
                          ? 'bg-tier-good text-primary-foreground shadow-sm'
                          : pkg.tier === 'better'
                          ? 'bg-tier-better text-accent-foreground shadow-sm'
                          : 'bg-tier-best text-success-foreground shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {pkg.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Customer Name */}
            <div className="flex-1 min-w-[160px]">
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

            {/* Customer Address */}
            <div className="flex-1 min-w-[160px]">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Customer Address
              </label>
              <input
                type="text"
                value={customerAddress}
                onChange={(e) => onCustomerAddressChange(e.target.value)}
                placeholder="Enter address"
                className="input-field"
                maxLength={200}
              />
            </div>
          </div>
        </div>

        {/* Agreement Terms Editor (Collapsible) */}
        <div className="card-elevated overflow-hidden">
          <button
            onClick={() => setShowTermsEditor(!showTermsEditor)}
            className="w-full p-4 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <Sliders className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-foreground text-sm">Agreement Terms</h3>
                <p className="text-xs text-muted-foreground">
                  Customize policies, cancellation terms, and more
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-primary">
                {showTermsEditor ? 'Hide' : 'Edit'}
              </span>
              {showTermsEditor ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </button>
          {showTermsEditor && (
            <div className="p-4 pt-0 border-t border-border animate-fade-in">
              <AgreementTermsEditor
                terms={agreementTerms}
                onChange={onAgreementTermsChange}
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleCopyToClipboard}
            className="btn-secondary"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy Text
              </>
            )}
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={isGeneratingPdf}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGeneratingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Download Agreement
              </>
            )}
          </button>
        </div>
      </div>

      {/* Document Preview */}
      <AgreementDocument
        ref={documentRef}
        pkg={selectedPackage}
        businessDetails={businessDetails}
        terms={agreementTerms}
        customerName={customerName}
        customerAddress={customerAddress}
        pricingDisplayMode={pricingDisplayMode}
      />
    </div>
  );
}