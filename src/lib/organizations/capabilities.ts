import type { OrganizationRole } from './applicationContracts';

export interface OrganizationCapabilities {
  viewOrganization: boolean;
  manageSettings: boolean;
  manageMembers: boolean;
  manageRouting: boolean;
}

const NO_CAPABILITIES: OrganizationCapabilities = {
  viewOrganization: false,
  manageSettings: false,
  manageMembers: false,
  manageRouting: false,
};

const CAPABILITIES_BY_ROLE: Record<
  OrganizationRole,
  OrganizationCapabilities
> = {
  owner: {
    viewOrganization: true,
    manageSettings: true,
    manageMembers: true,
    manageRouting: true,
  },
  admin: {
    viewOrganization: true,
    manageSettings: true,
    manageMembers: true,
    manageRouting: true,
  },
  member: {
    viewOrganization: true,
    manageSettings: false,
    manageMembers: false,
    manageRouting: false,
  },
};

export function organizationCapabilities(
  role: OrganizationRole | null | undefined,
): OrganizationCapabilities {
  return role ? { ...CAPABILITIES_BY_ROLE[role] } : { ...NO_CAPABILITIES };
}
