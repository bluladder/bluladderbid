import { BusinessDetails } from '@/types/servicePlan';
import { Building2, User, Mail, Phone, MapPin, Shield, ImagePlus, X } from 'lucide-react';
import { useRef } from 'react';

interface BusinessDetailsFormProps {
  details: BusinessDetails;
  onChange: (key: keyof BusinessDetails, value: string) => void;
}

export function BusinessDetailsForm({ details, onChange }: BusinessDetailsFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      onChange('logo', dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    onChange('logo', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="card-elevated p-6">
      <h3 className="font-display text-lg font-semibold text-foreground mb-4">
        Company Details
      </h3>
      <p className="text-sm text-muted-foreground mb-6">
        This information will appear on your proposals and agreements.
      </p>

      {/* Logo Upload Section */}
      <div className="mb-6">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          <ImagePlus className="w-4 h-4" />
          Company Logo
        </label>
        
        {details.logo ? (
          <div className="flex items-center gap-4">
            <div className="relative w-32 h-16 bg-muted rounded-lg overflow-hidden border border-border">
              <img
                src={details.logo}
                alt="Company logo"
                className="w-full h-full object-contain"
              />
            </div>
            <button
              onClick={handleRemoveLogo}
              className="btn-secondary text-sm"
              type="button"
            >
              <X className="w-4 h-4" />
              Remove
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="w-full p-6 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors text-center"
          >
            <ImagePlus className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Click to upload your logo
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              PNG, JPG up to 2MB
            </p>
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

      <div className="grid sm:grid-cols-2 gap-4">
        <InputField
          icon={<Building2 className="w-4 h-4" />}
          label="Company Name"
          value={details.businessName}
          onChange={(v) => onChange('businessName', v)}
          placeholder="Next Level Clean"
        />
        <InputField
          icon={<User className="w-4 h-4" />}
          label="Contact Name"
          value={details.ownerName}
          onChange={(v) => onChange('ownerName', v)}
          placeholder="John Smith"
        />
        <InputField
          icon={<Mail className="w-4 h-4" />}
          label="Company Email"
          value={details.email}
          onChange={(v) => onChange('email', v)}
          placeholder="info@yourcompany.com"
          type="email"
        />
        <InputField
          icon={<Phone className="w-4 h-4" />}
          label="Company Phone"
          value={details.phone}
          onChange={(v) => onChange('phone', v)}
          placeholder="(555) 123-4567"
          type="tel"
        />
        <InputField
          icon={<MapPin className="w-4 h-4" />}
          label="Service Area"
          value={details.serviceArea}
          onChange={(v) => onChange('serviceArea', v)}
          placeholder="Greater Atlanta Area"
        />
        <InputField
          icon={<Shield className="w-4 h-4" />}
          label="License/Insurance Statement"
          value={details.licenseStatement}
          onChange={(v) => onChange('licenseStatement', v)}
          placeholder="Fully licensed and insured"
        />
      </div>
    </div>
  );
}

interface InputFieldProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}

function InputField({ icon, label, value, onChange, placeholder, type = 'text' }: InputFieldProps) {
  return (
    <div>
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
        {icon}
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field"
        maxLength={type === 'email' ? 255 : 100}
      />
    </div>
  );
}
