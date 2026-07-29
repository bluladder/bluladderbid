import type {
  OrganizationAdminWorkspace,
  OrganizationContext,
  OrganizationSettings,
} from './applicationContracts';
import {
  assertWorkspaceLineage,
  type OrganizationAdminAdapter,
  type UpdateOrganizationSettingsInput,
} from './adminAdapters';
import {
  DFW_ORGANIZATION_ID,
  OREGON_ORGANIZATION_ID,
  dfwAdminMembership,
} from './fixtures';

const DFW_WORKSPACE: OrganizationAdminWorkspace = {
  organizationId: DFW_ORGANIZATION_ID,
  settings: {
    displayName: 'BluLadder DFW',
    timezone: 'America/Chicago',
    locale: 'en-US',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  contacts: [
    {
      id: 'dfw-operations',
      label: 'DFW Operations',
      email: 'operations@example.invalid',
      purpose: 'operations',
    },
  ],
  memberships: [
    dfwAdminMembership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ],
  territories: [
    {
      id: 'dfw-territory',
      label: 'Dallas–Fort Worth',
      kind: 'state',
      value: 'TX',
      mode: 'include',
      priority: 100,
      active: true,
    },
  ],
  services: [
    {
      serviceKey: 'window_cleaning',
      displayName: 'Window Cleaning',
      available: true,
    },
  ],
};

const OREGON_WORKSPACE: OrganizationAdminWorkspace = {
  organizationId: OREGON_ORGANIZATION_ID,
  settings: {
    displayName: 'BluLadder Oregon',
    timezone: 'America/Los_Angeles',
    locale: 'en-US',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  contacts: [],
  memberships: [],
  territories: [],
  services: [],
};

export function createMockOrganizationAdminAdapter(): OrganizationAdminAdapter {
  return {
    async loadWorkspace(context) {
      const workspace =
        context.organization.id === DFW_ORGANIZATION_ID
          ? DFW_WORKSPACE
          : context.organization.id === OREGON_ORGANIZATION_ID
            ? OREGON_WORKSPACE
            : null;
      if (!workspace) {
        throw new Error('organization_not_found');
      }
      return assertWorkspaceLineage(context, structuredClone(workspace));
    },

    async updateSettings(
      context: OrganizationContext,
      input: UpdateOrganizationSettingsInput,
    ): Promise<OrganizationSettings> {
      if (context.organization.status !== 'active') {
        throw new Error('inactive_organization');
      }
      if (!['owner', 'admin'].includes(context.membership.role)) {
        throw new Error('organization_capability_denied');
      }
      const current = assertWorkspaceLineage(
        context,
        structuredClone(DFW_WORKSPACE),
      ).settings;
      if (input.expectedUpdatedAt !== current.updatedAt) {
        throw new Error('organization_settings_conflict');
      }
      return {
        displayName: input.displayName,
        timezone: input.timezone,
        locale: input.locale,
        updatedAt: '2026-07-29T00:01:00.000Z',
      };
    },
  };
}
