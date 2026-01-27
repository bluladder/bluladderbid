// Types for the 12-month service plan builder

export interface ServicePlanService {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  frequency: 1 | 2 | 3 | 4; // times per year
  calculatedPrice: number; // price per visit
  annualTotal: number; // price * frequency
}

export interface ServicePlanHomeDetails {
  squareFootage: number;
  stories: 1 | 2 | 3;
  condition: 'maintenance' | 'heavy';
  
  // Window-specific details
  windowCleaningType: 'exterior' | 'both';
  hardWaterStains: boolean;
  hardWaterPercent: 25 | 50 | 75 | 100;
  frenchPanes: boolean;
  frenchPanesPercent: 25 | 50 | 75 | 100;
  solarScreens: boolean;
  solarScreensPercent: 25 | 50 | 75 | 100;
  
  // Driveway details
  drivewaySqft: number;
  drivewaySurfaceType: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile';
  
  // Roof details
  roofType: 'asphalt' | 'tile' | 'metal' | 'flat';
  roofSeverity: 'light' | 'moderate' | 'heavy';
  
  // Flatwork details
  frontPorchSqft: number;
  backPatioSqft: number;
  poolDeckSqft: number;
  walkwaysSqft: number;
  flatworkSurfaceType: 'concrete' | 'stamped' | 'pavers' | 'brick' | 'stone' | 'tile';
}

export interface ServicePlanPayment {
  annualTotal: number;
  downPayment: number; // 20% of annual
  monthlyPayment: number; // remaining 80% / 11
  totalPayments: number; // 12 (1 down + 11 monthly)
}

export interface ServicePlanCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export const DEFAULT_PLAN_HOME_DETAILS: ServicePlanHomeDetails = {
  squareFootage: 0,
  stories: 1,
  condition: 'maintenance',
  windowCleaningType: 'exterior',
  hardWaterStains: false,
  hardWaterPercent: 25,
  frenchPanes: false,
  frenchPanesPercent: 25,
  solarScreens: false,
  solarScreensPercent: 25,
  drivewaySqft: 400,
  drivewaySurfaceType: 'concrete',
  roofType: 'asphalt',
  roofSeverity: 'light',
  frontPorchSqft: 80,
  backPatioSqft: 200,
  poolDeckSqft: 300,
  walkwaysSqft: 100,
  flatworkSurfaceType: 'concrete',
};

export const DEFAULT_PLAN_CUSTOMER: ServicePlanCustomer = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
};

// Available services for the plan builder
export const PLAN_BUILDER_SERVICES = [
  {
    id: 'window-cleaning-exterior',
    name: 'Exterior Window Cleaning',
    description: 'Crystal-clear exterior window cleaning for your entire home',
    icon: 'Sparkles',
    requiresDetails: ['squareFootage', 'stories', 'condition'],
    advancedDetails: ['hardWaterStains', 'frenchPanes', 'solarScreens'],
  },
  {
    id: 'window-cleaning-interior',
    name: 'Interior Window Cleaning',
    description: 'Professional interior window cleaning with streak-free results',
    icon: 'Sparkles',
    requiresDetails: ['squareFootage', 'stories', 'condition'],
    advancedDetails: ['hardWaterStains', 'frenchPanes'],
  },
  {
    id: 'gutter-cleaning',
    name: 'Gutter Cleaning',
    description: 'Complete gutter and downspout cleaning to prevent clogs',
    icon: 'Home',
    requiresDetails: ['squareFootage', 'stories'],
    advancedDetails: [],
  },
  {
    id: 'house-wash',
    name: 'House Soft Wash',
    description: 'Gentle exterior house washing that removes dirt and algae',
    icon: 'Warehouse',
    requiresDetails: ['squareFootage', 'stories'],
    advancedDetails: [],
  },
  {
    id: 'roof-cleaning',
    name: 'Soft Wash Roof Cleaning',
    description: 'Safe, low-pressure roof treatment to remove moss and algae',
    icon: 'Cloud',
    requiresDetails: ['squareFootage', 'stories', 'roofType', 'roofSeverity'],
    advancedDetails: [],
  },
  {
    id: 'driveway-cleaning',
    name: 'Driveway Cleaning',
    description: 'Professional pressure washing for your driveway',
    icon: 'Droplets',
    requiresDetails: ['drivewaySqft', 'drivewaySurfaceType'],
    advancedDetails: [],
  },
  {
    id: 'pressure-washing',
    name: 'Flatwork Pressure Washing',
    description: 'Pressure washing for patios, porches, walkways, and pool decks',
    icon: 'Droplets',
    requiresDetails: ['flatworkSurfaceType'],
    advancedDetails: ['frontPorchSqft', 'backPatioSqft', 'poolDeckSqft', 'walkwaysSqft'],
  },
] as const;

export type PlanBuilderServiceId = typeof PLAN_BUILDER_SERVICES[number]['id'];

export const FREQUENCY_OPTIONS = [
  { value: 1, label: 'Once per year', shortLabel: '1x/yr' },
  { value: 2, label: 'Twice per year', shortLabel: '2x/yr' },
  { value: 3, label: '3 times per year', shortLabel: '3x/yr' },
  { value: 4, label: '4 times per year', shortLabel: '4x/yr' },
] as const;
