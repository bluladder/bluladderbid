import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User, Mail, Phone, MessageSquare, Megaphone } from 'lucide-react';
import { z } from 'zod';
import { AddressAutocomplete } from './AddressAutocomplete';
import { setSelfReportedSource } from '@/lib/attribution/attribution';

const US_STATE_REGEX = /^[A-Za-z]{2}$/;
const ZIP_REGEX = /^\d{5}(-\d{4})?$/;

const LEAD_SOURCES = [
  ['google_search', 'Google Search'],
  ['google_business_profile', 'Google Maps / Google Business Profile'],
  ['facebook_instagram', 'Facebook / Instagram'],
  ['nextdoor', 'Nextdoor'],
  ['door_hanger', 'Door Hanger'],
  ['direct_mail', 'Postcard / Direct Mail'],
  ['yard_sign', 'Yard Sign'],
  ['referral', 'Referral from Friend or Family'],
  ['existing_customer', 'Existing Customer'],
  ['neighborhood', 'Neighborhood / Saw Us Working'],
  ['youtube_social', 'YouTube / Social Media'],
  ['jobber_partner', 'Jobber Marketplace / Partner'],
  ['other', 'Other'],
] as const;

const customerSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().min(10, 'Please enter a valid phone number').max(20),
  street: z.string().min(3, 'Please enter your street address').max(120),
  city: z.string().min(2, 'Please enter your city').max(80),
  state: z.string().regex(US_STATE_REGEX, 'Use 2-letter state (e.g., TX)'),
  zip: z.string().regex(ZIP_REGEX, 'Enter a valid ZIP code'),
  notes: z.string().max(500).optional(),
  leadSource: z.string().min(1, 'Please tell us how you heard about BluLadder'),
  leadSourceDetail: z.string().max(200).optional(),
}).superRefine((value, ctx) => {
  if (value.leadSource === 'other' && !value.leadSourceDetail?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['leadSourceDetail'], message: 'Please describe how you heard about us' });
  }
});

const composeAddress = (p: { street: string; unit?: string; city: string; state: string; zip: string }) => {
  const streetLine = [p.street.trim(), (p.unit ?? '').trim()].filter(Boolean).join(' ');
  const stateZip = [p.state.trim().toUpperCase(), p.zip.trim()].filter(Boolean).join(' ');
  return [streetLine, p.city.trim(), stateZip].filter(Boolean).join(', ');
};

const parseAddress = (address?: string) => {
  const result = { street: '', city: '', state: '', zip: '' };
  if (!address) return result;
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    result.street = parts.slice(0, parts.length - 2).join(', ');
    result.city = parts[parts.length - 2];
    const stateZip = parts[parts.length - 1].split(/\s+/);
    result.state = stateZip[0] || '';
    result.zip = stateZip.slice(1).join(' ') || '';
  } else {
    result.street = address;
  }
  return result;
};

export interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  notes?: string;
  leadSource?: string;
  leadSourceDetail?: string;
}

interface CustomerInfoFormProps {
  onSubmit: (info: CustomerInfo) => void;
  initialData?: Partial<CustomerInfo>;
  isSubmitting?: boolean;
  submitButtonText?: string;
}

export function CustomerInfoForm({ onSubmit, initialData, isSubmitting, submitButtonText = 'Confirm Booking' }: CustomerInfoFormProps) {
  const parsedInitial = parseAddress(initialData?.address);
  const [formData, setFormData] = useState({
    firstName: initialData?.firstName || '',
    lastName: initialData?.lastName || '',
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    street: parsedInitial.street,
    unit: '',
    city: parsedInitial.city,
    state: parsedInitial.state,
    zip: parsedInitial.zip,
    notes: initialData?.notes || '',
    leadSource: initialData?.leadSource || '',
    leadSourceDetail: initialData?.leadSourceDetail || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const handleAddressSelect = (parts: { street: string; city: string; state: string; zip: string }) => {
    setFormData(prev => ({
      ...prev,
      street: parts.street || prev.street,
      city: parts.city || prev.city,
      state: (parts.state || prev.state).toUpperCase().slice(0, 2),
      zip: parts.zip || prev.zip,
    }));
    setErrors(prev => ({ ...prev, street: '', city: '', state: '', zip: '' }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = customerSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(err => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setSelfReportedSource(formData.leadSource, formData.leadSourceDetail);
    onSubmit({
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      address: composeAddress(formData),
      notes: formData.notes,
      leadSource: formData.leadSource,
      leadSourceDetail: formData.leadSourceDetail,
    });
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><User className="w-4 h-4" />Your Info</CardTitle>
        <CardDescription className="text-xs">We'll use this to confirm your appointment</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="firstName" className="text-xs">First Name *</Label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input id="firstName" value={formData.firstName} onChange={(e) => handleChange('firstName', e.target.value)} placeholder="John" className={`pl-8 h-9 text-sm ${errors.firstName ? 'border-destructive' : ''}`} />
              </div>
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="lastName" className="text-xs">Last Name *</Label>
              <Input id="lastName" value={formData.lastName} onChange={(e) => handleChange('lastName', e.target.value)} placeholder="Smith" className={`h-9 text-sm ${errors.lastName ? 'border-destructive' : ''}`} />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="email" className="text-xs">Email Address *</Label>
            <div className="relative">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input id="email" type="email" value={formData.email} onChange={(e) => handleChange('email', e.target.value)} placeholder="john@example.com" className={`pl-8 h-9 text-sm ${errors.email ? 'border-destructive' : ''}`} />
            </div>
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="phone" className="text-xs">Phone Number *</Label>
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input id="phone" type="tel" value={formData.phone} onChange={(e) => handleChange('phone', e.target.value)} placeholder="(555) 123-4567" className={`pl-8 h-9 text-sm ${errors.phone ? 'border-destructive' : ''}`} />
            </div>
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="street" className="text-xs">Service Address *</Label>
            <AddressAutocomplete id="street" value={formData.street} onChange={(v) => handleChange('street', v)} onSelect={handleAddressSelect} placeholder="Start typing your address..." className={`pl-8 h-9 text-sm ${errors.street ? 'border-destructive' : ''}`} />
            {errors.street && <p className="text-xs text-destructive">{errors.street}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="unit" className="text-xs text-muted-foreground">Unit / Suite (Optional)</Label>
            <Input id="unit" value={formData.unit} onChange={(e) => handleChange('unit', e.target.value)} placeholder="Apt 4B, Suite 200..." autoComplete="address-line2" className="h-9 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="city" className="text-xs">City *</Label>
              <Input id="city" value={formData.city} onChange={(e) => handleChange('city', e.target.value)} placeholder="Aubrey" autoComplete="address-level2" className={`h-9 text-sm ${errors.city ? 'border-destructive' : ''}`} />
              {errors.city && <p className="text-xs text-destructive">{errors.city}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="state" className="text-xs">State *</Label>
                <Input id="state" value={formData.state} onChange={(e) => handleChange('state', e.target.value.toUpperCase().slice(0, 2))} placeholder="TX" maxLength={2} autoComplete="address-level1" className={`h-9 text-sm uppercase ${errors.state ? 'border-destructive' : ''}`} />
                {errors.state && <p className="text-xs text-destructive">{errors.state}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="zip" className="text-xs">ZIP *</Label>
                <Input id="zip" value={formData.zip} onChange={(e) => handleChange('zip', e.target.value)} placeholder="76227" inputMode="numeric" autoComplete="postal-code" className={`h-9 text-sm ${errors.zip ? 'border-destructive' : ''}`} />
                {errors.zip && <p className="text-xs text-destructive">{errors.zip}</p>}
              </div>
            </div>
          </div>

          <div className="space-y-1 rounded-lg border p-3 bg-muted/20">
            <Label className="text-xs flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" />How did you hear about BluLadder? *</Label>
            <Select value={formData.leadSource} onValueChange={(value) => handleChange('leadSource', value)}>
              <SelectTrigger className={errors.leadSource ? 'border-destructive' : ''}><SelectValue placeholder="Select one" /></SelectTrigger>
              <SelectContent>{LEAD_SOURCES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            {errors.leadSource && <p className="text-xs text-destructive">{errors.leadSource}</p>}
            {formData.leadSource === 'other' && (
              <div className="pt-1">
                <Input value={formData.leadSourceDetail} onChange={(e) => handleChange('leadSourceDetail', e.target.value)} placeholder="Please tell us where you heard about us" className={errors.leadSourceDetail ? 'border-destructive' : ''} />
                {errors.leadSourceDetail && <p className="text-xs text-destructive mt-1">{errors.leadSourceDetail}</p>}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="notes" className="text-xs text-muted-foreground">Special Instructions (Optional)</Label>
            <div className="relative">
              <MessageSquare className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Textarea id="notes" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} placeholder="Gate code, pet info, specific concerns..." className="pl-8 min-h-[50px] text-sm" />
            </div>
          </div>

          <Button type="submit" className="w-full h-11 text-sm font-semibold shadow-sm" disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : submitButtonText}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
