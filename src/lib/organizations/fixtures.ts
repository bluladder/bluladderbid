import type {
  OrganizationMembership,
  OrganizationSummary,
} from './applicationContracts';

export const DFW_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
export const OREGON_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000002';

export const DFW_ORGANIZATION: OrganizationSummary = {
  id: DFW_ORGANIZATION_ID,
  slug: 'bluladder-dfw',
  name: 'BluLadder DFW',
  status: 'active',
};

export const INACTIVE_OREGON_ORGANIZATION: OrganizationSummary = {
  id: OREGON_ORGANIZATION_ID,
  slug: 'bluladder-oregon',
  name: 'BluLadder Oregon',
  status: 'inactive',
};

export function dfwAdminMembership(userId: string): OrganizationMembership {
  return {
    organizationId: DFW_ORGANIZATION_ID,
    userId,
    role: 'admin',
    active: true,
  };
}
