export type ServiceFrequency = 'monthly' | 'quarterly' | 'biannual' | 'annual';

export type TierKey = 'good' | 'better' | 'best';

// Tier-specific availability configuration
export interface TierAvailability {
  good: boolean;
  better: boolean;
  best: boolean;
}

// Tier-specific frequency configuration
export interface TierFrequencyConfig {
  good: ServiceFrequency;
  better: ServiceFrequency;
  best: ServiceFrequency;
}

export interface Service {
  id: string;
  name: string;
  basePrice: number;
  frequency: ServiceFrequency; // Base/default frequency
  description: string;
  icon: string;
  enabled: boolean;
  note?: string; // Optional custom note for the service
  // Tier-specific settings
  tierAvailability: TierAvailability;
  tierFrequencies: TierFrequencyConfig;
  bestOnly: boolean; // "Exclusive to Best Plan" flag
}

export interface Perk {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tier: 'good' | 'better' | 'best';
}

export interface DiscountSettings {
  goodDiscount: number;
  betterDiscount: number;
  bestDiscount: number;
  payInFullDiscount: number;
}

// Separate member discount settings (for additional services discount perk)
export interface MemberDiscountSettings {
  goodMemberDiscount: number;
  betterMemberDiscount: number;
  bestMemberDiscount: number;
}

// Service configuration per tier with frequency overrides
export interface TierServiceConfig {
  service: Service;
  tierFrequency: ServiceFrequency;  // Frequency for this tier (may differ from base)
  annualVisits: number;             // Number of visits per year
  annualValue: number;              // Price × visits
}

export interface PackageTier {
  name: 'Good' | 'Better' | 'Best';
  tier: 'good' | 'better' | 'best';
  tierLabel: string;                 // e.g., "Basic Coverage", "Consistent Maintenance", "Total Coverage"
  services: Service[];
  tierServices: TierServiceConfig[]; // Services with tier-specific frequencies
  perks: Perk[];
  annualTotal: number;
  monthlyPrice: number;
  depositAmount: number;
  savings: number;
  savingsPercent: number;
  payInFullPrice: number;
  payInFullSavings: number;
  baseAnnualValue: number;           // Value before discount (for comparison)
}

export interface BusinessDetails {
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  serviceArea: string;
  licenseStatement: string;
  logo: string;
}

export interface AgreementTerms {
  membershipLength: number;
  cancellationNotice: string;
  refundPolicy: string;
  weatherPolicy: string;
  touchUpPolicy: string;
  accessPolicy: string;
  customerResponsibilities: string;
  serviceLimitations: string;
}

export interface PlanConfig {
  businessName: string;
  customerName: string;
  services: Service[];
  perks: Perk[];
  discounts: DiscountSettings;
  depositPercent: number;
}

export const FREQUENCY_MULTIPLIERS: Record<ServiceFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  biannual: 2,
  annual: 1,
};

export const FREQUENCY_LABELS: Record<ServiceFrequency, string> = {
  monthly: 'Monthly (12x/year)',
  quarterly: 'Quarterly (4x/year)',
  biannual: 'Twice a Year',
  annual: 'Once a Year',
};

export const FREQUENCY_TEXT: Record<ServiceFrequency, string> = {
  monthly: 'monthly',
  quarterly: 'quarterly (4 times per year)',
  biannual: 'twice per year',
  annual: 'once per year',
};

// Helper to create default tier availability (all tiers enabled)
export const createDefaultTierAvailability = (): TierAvailability => ({
  good: true,
  better: true,
  best: true,
});

// Helper to create tier frequencies from a base frequency
export const createTierFrequencies = (baseFreq: ServiceFrequency): TierFrequencyConfig => ({
  good: baseFreq,
  better: baseFreq,
  best: baseFreq,
});

// Helper to create "Best Only" tier availability
export const createBestOnlyAvailability = (): TierAvailability => ({
  good: false,
  better: false,
  best: true,
});

export const DEFAULT_SERVICES: Service[] = [
  {
    id: 'window-cleaning',
    name: 'Window Cleaning (Int. & Ext.)',
    basePrice: 175,
    frequency: 'quarterly',
    description: 'Complete interior & exterior window cleaning',
    icon: 'Sparkles',
    enabled: false,
    tierAvailability: createDefaultTierAvailability(),
    tierFrequencies: { good: 'biannual', better: 'quarterly', best: 'quarterly' },
    bestOnly: false,
  },
  {
    id: 'exterior-window-cleaning',
    name: 'Exterior Window Cleaning',
    basePrice: 100,
    frequency: 'quarterly',
    description: 'Exterior window cleaning only',
    icon: 'Sparkles',
    enabled: false,
    tierAvailability: createDefaultTierAvailability(),
    tierFrequencies: { good: 'biannual', better: 'quarterly', best: 'quarterly' },
    bestOnly: false,
  },
  {
    id: 'interior-window-cleaning',
    name: 'Interior Window Cleaning',
    basePrice: 100,
    frequency: 'biannual',
    description: 'Interior window cleaning only',
    icon: 'Sparkles',
    enabled: false,
    tierAvailability: createBestOnlyAvailability(),
    tierFrequencies: { good: 'annual', better: 'annual', best: 'biannual' },
    bestOnly: true,
  },
  {
    id: 'screen-cleaning',
    name: 'Screen Cleaning',
    basePrice: 75,
    frequency: 'quarterly',
    description: 'Window screen removal, cleaning & reinstallation',
    icon: 'Grid3X3',
    enabled: false,
    tierAvailability: { good: false, better: true, best: true },
    tierFrequencies: { good: 'annual', better: 'biannual', best: 'quarterly' },
    bestOnly: false,
  },
  {
    id: 'pressure-washing',
    name: 'Pressure Washing',
    basePrice: 250,
    frequency: 'annual',
    description: 'Flat surfaces, walkways, and patios',
    icon: 'Droplets',
    enabled: false,
    tierAvailability: createDefaultTierAvailability(),
    tierFrequencies: createTierFrequencies('annual'),
    bestOnly: false,
  },
  {
    id: 'driveway-cleaning',
    name: 'Driveway Cleaning',
    basePrice: 175,
    frequency: 'annual',
    description: 'Complete driveway pressure washing and restoration',
    icon: 'Droplets',
    enabled: false,
    tierAvailability: createDefaultTierAvailability(),
    tierFrequencies: createTierFrequencies('annual'),
    bestOnly: false,
  },
  {
    id: 'gutter-cleaning',
    name: 'Gutter Cleaning',
    basePrice: 200,
    frequency: 'biannual',
    description: 'Full gutter and downspout cleaning',
    icon: 'Home',
    enabled: false,
    tierAvailability: createDefaultTierAvailability(),
    tierFrequencies: { good: 'annual', better: 'biannual', best: 'biannual' },
    bestOnly: false,
  },
  {
    id: 'roof-cleaning',
    name: 'Soft Wash Roof Cleaning',
    basePrice: 450,
    frequency: 'annual',
    description: 'Safe, low-pressure roof treatment',
    icon: 'Cloud',
    enabled: false,
    tierAvailability: { good: false, better: true, best: true },
    tierFrequencies: createTierFrequencies('annual'),
    bestOnly: false,
  },
  {
    id: 'house-soft-wash',
    name: 'House Soft Wash',
    basePrice: 400,
    frequency: 'annual',
    description: 'Gentle exterior house washing',
    icon: 'Warehouse',
    enabled: false,
    tierAvailability: createBestOnlyAvailability(),
    tierFrequencies: createTierFrequencies('annual'),
    bestOnly: true,
  },
  {
    id: 'deck-cleaning',
    name: 'Deck Cleaning',
    basePrice: 275,
    frequency: 'annual',
    description: 'Wood or composite deck restoration',
    icon: 'TreeDeciduous',
    enabled: false,
    tierAvailability: { good: false, better: true, best: true },
    tierFrequencies: createTierFrequencies('annual'),
    bestOnly: false,
  },
  {
    id: 'solar-panel-cleaning',
    name: 'Solar Panel Cleaning',
    basePrice: 225,
    frequency: 'biannual',
    description: 'Safe cleaning to maximize efficiency',
    icon: 'Sun',
    enabled: false,
    tierAvailability: { good: false, better: true, best: true },
    tierFrequencies: { good: 'annual', better: 'annual', best: 'biannual' },
    bestOnly: false,
  },
  {
    id: 'concrete-sealing',
    name: 'Concrete Sealing',
    basePrice: 500,
    frequency: 'annual',
    description: 'Protective sealant for driveways & patios',
    icon: 'Layers',
    enabled: false,
    tierAvailability: createBestOnlyAvailability(),
    tierFrequencies: createTierFrequencies('annual'),
    bestOnly: true,
  },
];

export const DEFAULT_PERKS: Perk[] = [
  {
    id: 'tier-discount-good',
    name: '5% Member Discount',
    description: 'Exclusive member pricing on all additional services',
    enabled: true,
    tier: 'good',
  },
  {
    id: 'tier-discount-better',
    name: '10% Member Discount',
    description: 'Exclusive member pricing on all additional services',
    enabled: true,
    tier: 'better',
  },
  {
    id: 'tier-discount-best',
    name: '15% Member Discount',
    description: 'Exclusive member pricing on all additional services',
    enabled: true,
    tier: 'best',
  },
  {
    id: 'priority-scheduling',
    name: 'Priority Scheduling',
    description: 'Skip the line with guaranteed booking windows',
    enabled: true,
    tier: 'better',
  },
  {
    id: 'satisfaction-guarantee',
    name: 'Satisfaction Guarantee',
    description: 'Not happy? We come back free within 7 days',
    enabled: true,
    tier: 'good',
  },
  {
    id: 'unlimited-touchups',
    name: 'Unlimited Exterior Touch-Ups',
    description: 'Free exterior touch-ups between scheduled visits',
    enabled: true,
    tier: 'best',
  },
  {
    id: 'priority-response',
    name: 'Priority Response',
    description: '24-hour response for urgent needs',
    enabled: true,
    tier: 'best',
  },
  {
    id: 'clog-free-guarantee',
    name: 'Clog-Free Gutter Guarantee',
    description: 'Guaranteed clog-free gutters between cleanings',
    enabled: true,
    tier: 'best',
  },
  {
    id: 'referral-bonus',
    name: 'Referral Bonus',
    description: '$50 credit for every referred customer',
    enabled: true,
    tier: 'good',
  },
];

export const DEFAULT_DISCOUNTS: DiscountSettings = {
  goodDiscount: 0,
  betterDiscount: 5,
  bestDiscount: 10,
  payInFullDiscount: 5,
};

export const DEFAULT_MEMBER_DISCOUNTS: MemberDiscountSettings = {
  goodMemberDiscount: 5,
  betterMemberDiscount: 10,
  bestMemberDiscount: 15,
};

// Tier-specific frequency mappings
// These define how frequencies change per tier for frequency-differentiated services
export const TIER_FREQUENCY_UPGRADES: Record<'good' | 'better' | 'best', Partial<Record<ServiceFrequency, ServiceFrequency>>> = {
  good: {
    // Good tier: reduce frequency (quarterly → biannual for exterior windows)
    quarterly: 'biannual',
    monthly: 'quarterly',
  },
  better: {
    // Better tier: keep base frequency as configured
  },
  best: {
    // Best tier: keep base frequency, but adds interior services
  },
};

// Tier labels for display
export const TIER_LABELS: Record<'good' | 'better' | 'best', string> = {
  good: 'Basic Coverage',
  better: 'Consistent Maintenance', 
  best: 'Total Coverage',
};

export const DEFAULT_BUSINESS_DETAILS: BusinessDetails = {
  businessName: 'Next Level Clean',
  ownerName: '',
  email: '',
  phone: '',
  serviceArea: '',
  licenseStatement: 'Fully licensed and insured.',
  logo: '',
};

export const DEFAULT_AGREEMENT_TERMS: AgreementTerms = {
  membershipLength: 12,
  cancellationNotice: 'You may cancel this membership at any time with 30 days written notice. Any services already completed will not be refunded.',
  refundPolicy: 'Completed services are non-refundable. If you cancel mid-term, any unused prepaid balance (if applicable) will be forfeited unless otherwise agreed in writing.',
  weatherPolicy: 'Services may be rescheduled due to inclement weather, unsafe conditions, or other circumstances beyond our control. We will make every reasonable effort to reschedule within 7 days.',
  touchUpPolicy: 'Touch-ups are available for reasonable requests within 7 days of a completed service. Abuse of touch-up requests or requests outside the service scope may be declined.',
  accessPolicy: 'Customer agrees to provide reasonable access to the property on scheduled service days. If access is not available, the visit may count as a completed service or require rescheduling at our discretion.',
  customerResponsibilities: 'Customer is responsible for securing pets, moving fragile items away from work areas, and ensuring water/power access as needed for services.',
  serviceLimitations: 'Services are limited to standard residential properties. Additional fees may apply for excessive dirt, staining, or conditions outside normal scope. We reserve the right to decline unsafe work.',
};
