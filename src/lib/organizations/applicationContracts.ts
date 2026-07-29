export type OrganizationStatus = 'active' | 'inactive';
export type OrganizationRole = 'owner' | 'admin' | 'member';

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
}

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  active: boolean;
}

export interface OrganizationScopedRecord {
  organizationId: string;
}

export interface OrganizationContext {
  organization: OrganizationSummary;
  membership: OrganizationMembership;
}

export interface OrganizationSettings {
  displayName: string;
  timezone: string;
  locale: string;
  updatedAt: string;
}

export interface OrganizationContact {
  id: string;
  label: string;
  email: string;
  purpose: 'operations' | 'escalation';
}

export interface OrganizationTerritory {
  id: string;
  label: string;
  kind: 'state' | 'county' | 'city' | 'zip';
  value: string;
  mode: 'include' | 'exclude';
  priority: number;
  active: boolean;
}

export interface OrganizationServiceAvailability {
  serviceKey: string;
  displayName: string;
  available: boolean;
}

export interface OrganizationAdminWorkspace {
  organizationId: string;
  settings: OrganizationSettings;
  contacts: readonly OrganizationContact[];
  memberships: readonly OrganizationMembership[];
  territories: readonly OrganizationTerritory[];
  services: readonly OrganizationServiceAvailability[];
}

export type OrganizationContextFailure =
  | 'unauthenticated'
  | 'organization_not_found'
  | 'inactive_organization'
  | 'no_active_membership'
  | 'ambiguous_membership'
  | 'organization_membership_conflict';

export type OrganizationContextResult =
  | { ok: true; context: OrganizationContext }
  | { ok: false; reason: OrganizationContextFailure };
