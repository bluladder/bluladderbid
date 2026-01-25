import { ServiceFrequency, TierAvailability, TierFrequencyConfig } from '@/types/servicePlan';

// Full service configuration within a bundle
export interface BundleServiceConfig {
  id: string;
  basePrice?: number;
  tierAvailability: TierAvailability;
  tierFrequencies: TierFrequencyConfig;
  bestOnly?: boolean;
}

// Discount configuration for the bundle
export interface BundleDiscounts {
  goodDiscount: number;
  betterDiscount: number;
  bestDiscount: number;
}

export interface ServiceBundle {
  id: string;
  name: string;
  description: string;
  services: BundleServiceConfig[];
  discounts?: BundleDiscounts;
  /** Which tier this bundle is optimized for */
  optimizedFor?: 'good' | 'better' | 'best';
  /** Whether this bundle should be visually emphasized as recommended */
  recommended?: boolean;
}

// Helper to create availability for "All tiers"
const allTiers = (): TierAvailability => ({ good: true, better: true, best: true });

// Helper to create availability for "Better + Best"
const betterAndBest = (): TierAvailability => ({ good: false, better: true, best: true });

// Helper to create availability for "Best only"
const bestOnly = (): TierAvailability => ({ good: false, better: false, best: true });

export const SUGGESTED_BUNDLES: ServiceBundle[] = [
  {
    id: 'starter-exterior',
    name: 'Starter Exterior Care',
    description: 'Essential services at baseline frequency — a solid Good tier foundation',
    optimizedFor: 'good',
    services: [
      {
        id: 'exterior-window-cleaning',
        basePrice: 100,
        tierAvailability: allTiers(),
        tierFrequencies: { good: 'biannual', better: 'biannual', best: 'quarterly' },
      },
      {
        id: 'gutter-cleaning',
        basePrice: 200,
        tierAvailability: allTiers(),
        tierFrequencies: { good: 'annual', better: 'annual', best: 'biannual' },
      },
    ],
    discounts: { goodDiscount: 0, betterDiscount: 5, bestDiscount: 10 },
  },
  {
    id: 'popular-home',
    name: 'Popular Home Protection',
    description: 'Most requested — balanced coverage with increased frequency',
    optimizedFor: 'better',
    recommended: true,
    services: [
      {
        id: 'exterior-window-cleaning',
        basePrice: 100,
        tierAvailability: allTiers(),
        tierFrequencies: { good: 'biannual', better: 'quarterly', best: 'quarterly' },
      },
      {
        id: 'gutter-cleaning',
        basePrice: 200,
        tierAvailability: allTiers(),
        tierFrequencies: { good: 'annual', better: 'biannual', best: 'biannual' },
      },
      {
        id: 'driveway-cleaning',
        basePrice: 175,
        tierAvailability: betterAndBest(),
        tierFrequencies: { good: 'annual', better: 'annual', best: 'annual' },
      },
      {
        id: 'pressure-washing',
        basePrice: 250,
        tierAvailability: betterAndBest(),
        tierFrequencies: { good: 'annual', better: 'annual', best: 'annual' },
      },
    ],
    discounts: { goodDiscount: 0, betterDiscount: 5, bestDiscount: 10 },
  },
  {
    id: 'premium-whole-home',
    name: 'Premium Whole-Home Care',
    description: 'Comprehensive coverage with exclusive Best-only services',
    optimizedFor: 'best',
    services: [
      {
        id: 'exterior-window-cleaning',
        basePrice: 100,
        tierAvailability: allTiers(),
        tierFrequencies: { good: 'biannual', better: 'quarterly', best: 'quarterly' },
      },
      {
        id: 'interior-window-cleaning',
        basePrice: 100,
        tierAvailability: bestOnly(),
        tierFrequencies: { good: 'annual', better: 'annual', best: 'biannual' },
        bestOnly: true,
      },
      {
        id: 'screen-cleaning',
        basePrice: 75,
        tierAvailability: betterAndBest(),
        tierFrequencies: { good: 'annual', better: 'biannual', best: 'quarterly' },
      },
      {
        id: 'gutter-cleaning',
        basePrice: 200,
        tierAvailability: allTiers(),
        tierFrequencies: { good: 'annual', better: 'biannual', best: 'biannual' },
      },
      {
        id: 'pressure-washing',
        basePrice: 250,
        tierAvailability: allTiers(),
        tierFrequencies: { good: 'annual', better: 'annual', best: 'annual' },
      },
      {
        id: 'driveway-cleaning',
        basePrice: 175,
        tierAvailability: betterAndBest(),
        tierFrequencies: { good: 'annual', better: 'annual', best: 'annual' },
      },
      {
        id: 'house-soft-wash',
        basePrice: 400,
        tierAvailability: bestOnly(),
        tierFrequencies: { good: 'annual', better: 'annual', best: 'annual' },
        bestOnly: true,
      },
    ],
    discounts: { goodDiscount: 0, betterDiscount: 5, bestDiscount: 12 },
  },
];
