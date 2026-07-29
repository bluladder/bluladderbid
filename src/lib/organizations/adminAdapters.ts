import type {
  OrganizationAdminWorkspace,
  OrganizationContext,
  OrganizationSettings,
} from './applicationContracts';

export interface UpdateOrganizationSettingsInput {
  displayName: string;
  timezone: string;
  locale: string;
  expectedUpdatedAt: string;
}

/**
 * Production implementations must resolve actor and organization again on the
 * server. The browser context is a display/request contract, not authority.
 */
export interface OrganizationAdminAdapter {
  loadWorkspace(
    context: OrganizationContext,
  ): Promise<OrganizationAdminWorkspace>;
  updateSettings(
    context: OrganizationContext,
    input: UpdateOrganizationSettingsInput,
  ): Promise<OrganizationSettings>;
}

export interface OrganizationAuditIntent {
  organizationId: string;
  actorUserId: string;
  action: 'settings.update' | 'membership.update' | 'territory.update';
  resourceId: string;
  correlationId: string;
}

export function createOrganizationAuditIntent(
  context: OrganizationContext,
  input: Omit<OrganizationAuditIntent, 'organizationId' | 'actorUserId'>,
): OrganizationAuditIntent {
  if (
    !context.organization.id ||
    context.membership.organizationId !== context.organization.id ||
    context.membership.userId.length === 0
  ) {
    throw new Error('organization_audit_lineage_mismatch');
  }

  return {
    ...input,
    organizationId: context.organization.id,
    actorUserId: context.membership.userId,
  };
}

export function assertWorkspaceLineage(
  context: OrganizationContext,
  workspace: OrganizationAdminWorkspace,
): OrganizationAdminWorkspace {
  if (
    workspace.organizationId !== context.organization.id ||
    workspace.memberships.some(
      (membership) =>
        membership.organizationId !== context.organization.id,
    )
  ) {
    throw new Error('organization_lineage_mismatch');
  }
  return workspace;
}
