import { AgreementTerms } from '@/types/servicePlan';
import { Clock, Ban, CloudRain, Wrench, Key, User, AlertCircle } from 'lucide-react';

interface AgreementTermsEditorProps {
  terms: AgreementTerms;
  onChange: (key: keyof AgreementTerms, value: string | number) => void;
}

export function AgreementTermsEditor({ terms, onChange }: AgreementTermsEditorProps) {
  return (
    <div className="card-elevated p-6">
      <h3 className="font-display text-lg font-semibold text-foreground mb-2">
        Agreement Terms
      </h3>
      <p className="text-sm text-muted-foreground mb-6">
        These are safe defaults that protect your business. Edit as needed.
      </p>

      <div className="space-y-5">
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            <Clock className="w-4 h-4" />
            Membership Length (Months)
          </label>
          <select
            value={terms.membershipLength}
            onChange={(e) => onChange('membershipLength', parseInt(e.target.value))}
            className="input-field"
          >
            <option value={6}>6 Months</option>
            <option value={12}>12 Months (Recommended)</option>
            <option value={24}>24 Months</option>
          </select>
        </div>

        <TermTextarea
          icon={<Ban className="w-4 h-4" />}
          label="Cancellation Policy"
          value={terms.cancellationNotice}
          onChange={(v) => onChange('cancellationNotice', v)}
        />

        <TermTextarea
          icon={<AlertCircle className="w-4 h-4" />}
          label="Refund Policy"
          value={terms.refundPolicy}
          onChange={(v) => onChange('refundPolicy', v)}
        />

        <TermTextarea
          icon={<CloudRain className="w-4 h-4" />}
          label="Weather & Rescheduling Policy"
          value={terms.weatherPolicy}
          onChange={(v) => onChange('weatherPolicy', v)}
        />

        <TermTextarea
          icon={<Wrench className="w-4 h-4" />}
          label="Touch-Up Policy"
          value={terms.touchUpPolicy}
          onChange={(v) => onChange('touchUpPolicy', v)}
        />

        <TermTextarea
          icon={<Key className="w-4 h-4" />}
          label="Property Access Policy"
          value={terms.accessPolicy}
          onChange={(v) => onChange('accessPolicy', v)}
        />

        <TermTextarea
          icon={<User className="w-4 h-4" />}
          label="Customer Responsibilities"
          value={terms.customerResponsibilities}
          onChange={(v) => onChange('customerResponsibilities', v)}
        />

        <TermTextarea
          icon={<AlertCircle className="w-4 h-4" />}
          label="Service Limitations"
          value={terms.serviceLimitations}
          onChange={(v) => onChange('serviceLimitations', v)}
        />
      </div>
    </div>
  );
}

interface TermTextareaProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function TermTextarea({ icon, label, value, onChange }: TermTextareaProps) {
  return (
    <div>
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
        {icon}
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="input-field resize-none"
      />
    </div>
  );
}
