import { BusinessDetails } from '@/types/servicePlan';
import { Building2, Mail, Phone, ChevronDown, ChevronUp, ImagePlus, X } from 'lucide-react';
import { useState, useRef } from 'react';

interface CompanyDetailsCardProps {
  details: BusinessDetails;
  onChange: (key: keyof BusinessDetails, value: string) => void;
  defaultExpanded?: boolean;
}

export function CompanyDetailsCard({ details, onChange, defaultExpanded = false }: CompanyDetailsCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isComplete = details.businessName && details.email && details.phone;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      onChange('logo', dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="card-gradient border-2 border-primary/20 overflow-hidden">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between gap-4 hover:bg-primary/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <Building2 className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="text-left">
            <h3 className="font-display font-bold text-foreground">
              {details.businessName || 'Your Company'}
            </h3>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {details.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {details.phone}
                </span>
              )}
              {details.email && (
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {details.email}
                </span>
              )}
              {!details.phone && !details.email && (
                <span className="text-warning">Add your contact info →</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isComplete && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-warning/10 text-warning border border-warning/20">
              Incomplete
            </span>
          )}
          <span className="text-xs font-medium text-primary">
            {isExpanded ? 'Hide' : 'Edit'}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded Form */}
      {isExpanded && (
        <div className="p-4 pt-0 border-t border-border/40 animate-fade-in">
          <p className="text-xs text-muted-foreground mb-4">
            This information appears on your proposals and agreements.
          </p>

          {/* Logo Upload */}
          <div className="mb-4">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              Company Logo
            </label>
            {details.logo ? (
              <div className="flex items-center gap-3">
                <div className="w-24 h-12 bg-muted rounded-lg overflow-hidden border border-border">
                  <img src={details.logo} alt="Logo" className="w-full h-full object-contain" />
                </div>
                <button
                  onClick={() => onChange('logo', '')}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Remove
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-3 p-3 border border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              >
                <ImagePlus className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Upload logo (PNG, JPG up to 2MB)</span>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </div>

          {/* Quick fields */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                Company Name
              </label>
              <input
                type="text"
                value={details.businessName}
                onChange={(e) => onChange('businessName', e.target.value)}
                placeholder="Next Level Clean"
                className="input-field py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                Contact Name
              </label>
              <input
                type="text"
                value={details.ownerName}
                onChange={(e) => onChange('ownerName', e.target.value)}
                placeholder="John Smith"
                className="input-field py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                Email
              </label>
              <input
                type="email"
                value={details.email}
                onChange={(e) => onChange('email', e.target.value)}
                placeholder="info@company.com"
                className="input-field py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                Phone
              </label>
              <input
                type="tel"
                value={details.phone}
                onChange={(e) => onChange('phone', e.target.value)}
                placeholder="(555) 123-4567"
                className="input-field py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                Service Area
              </label>
              <input
                type="text"
                value={details.serviceArea}
                onChange={(e) => onChange('serviceArea', e.target.value)}
                placeholder="Greater Atlanta Area"
                className="input-field py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                License Statement
              </label>
              <input
                type="text"
                value={details.licenseStatement}
                onChange={(e) => onChange('licenseStatement', e.target.value)}
                placeholder="Fully licensed and insured"
                className="input-field py-2 text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}