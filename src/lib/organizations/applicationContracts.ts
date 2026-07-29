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
