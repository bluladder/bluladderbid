import type { PlanTier } from './TierSelector';

export interface PlanDefinition {
  id: PlanTier;
  shortName: string;
  name: string;
  positioning: string;
  outcome: string;
  exteriorWindows: string;
  interiorWindows: string;
  gutterCleaning: string;
  houseWash: string;
  drivewayCleaning: string;
  pressureWashing: string;
  minimumCategories: string;
  discount: string;
  guarantee: string;
  guaranteeSupport: string;
  hardWater: string;
  coating: string;
  priority: string;
  keyServices: string[];
  recommended?: boolean;
}

export const MAINTENANCE_PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  good: {
    id: 'good',
    shortName: 'Essential',
    name: 'Essential Window Care',
    positioning: 'Simple quarterly window care that keeps your glass consistently clean throughout the year.',
    outcome: 'Reliable year-round window clarity with a straightforward maintenance rhythm.',
    exteriorWindows: '4x/year',
    interiorWindows: '1x/year, paired with an exterior visit',
    gutterCleaning: '—',
    houseWash: '—',
    drivewayCleaning: '—',
    pressureWashing: '—',
    minimumCategories: 'Window-only plan',
    discount: 'Save 5% on eligible additional services',
    guarantee: '14-day touch-up guarantee',
    guaranteeSupport: 'Let us know within 14 days if an isolated window spot or workmanship issue needs attention.',
    hardWater: 'Initial treatable hard-water stain removal included',
    coating: 'Preventive glass coating included when recurring sprinkler exposure makes it appropriate.',
    priority: 'Standard priority',
    keyServices: ['Exterior windows 4x/year', 'Interior windows 1x/year, paired with exterior'],
  },
  better: {
    id: 'better',
    shortName: 'Signature',
    name: 'Signature Home Care',
    positioning: 'Quarterly window care combined with the exterior maintenance services your home needs most.',
    outcome: 'A balanced home-care rhythm for windows, gutters and annual exterior washing.',
    exteriorWindows: '4x/year',
    interiorWindows: '1–2x/year',
    gutterCleaning: 'Included',
    houseWash: 'Recommended and included',
    drivewayCleaning: 'Easy annual addition',
    pressureWashing: '—',
    minimumCategories: '2 categories, including windows',
    discount: 'Save 5% on eligible additional services',
    guarantee: '14-day touch-up guarantee',
    guaranteeSupport: 'Let us know within 14 days if an isolated window spot or workmanship issue needs attention.',
    hardWater: 'Initial treatable hard-water stain removal included',
    coating: 'Preventive glass coating included when recurring sprinkler exposure makes it appropriate.',
    priority: 'Priority',
    keyServices: [
      'Exterior windows 4x/year',
      'Interior windows 1–2x/year',
      'Gutter cleaning included',
      'House wash recommended and included',
      'Driveway cleaning is an easy annual addition',
    ],
    recommended: true,
  },
  best: {
    id: 'best',
    shortName: 'Next Level',
    name: 'Next Level Clean',
    positioning: 'BluLadder’s most complete whole-property maintenance plan with maximum protection, priority and savings.',
    outcome: 'The broadest recurring care for your glass, home exterior, gutters and driveway.',
    exteriorWindows: '4x/year',
    interiorWindows: '2x/year',
    gutterCleaning: 'Included',
    houseWash: 'Included',
    drivewayCleaning: 'Included',
    pressureWashing: 'Additional pressure-washing benefit available',
    minimumCategories: '3 categories, including windows',
    discount: 'Save 10% on eligible additional services',
    guarantee: 'Unlimited qualifying window touch-ups',
    guaranteeSupport: 'Request qualifying window touch-ups between your scheduled quarterly visits.',
    hardWater: 'Initial treatable hard-water stain removal included',
    coating: 'Preventive glass coating included when recurring sprinkler exposure makes it appropriate.',
    priority: 'Highest priority',
    keyServices: [
      'Exterior windows 4x/year',
      'Interior windows 2x/year',
      'Gutter cleaning included',
      'House wash included',
      'Driveway cleaning included',
      'Additional pressure-washing benefit available',
    ],
  },
};

export const PLAN_DISCOUNT_EXCLUSIONS =
  'Additional-service discounts exclude Christmas lights, gutter repairs and gutter-guard installation.';

export const HARD_WATER_SUPPORT =
  'Includes treatable surface deposits. Permanent etching, construction damage and extensive restoration may require a separate assessment.';
