import { describe, expect, it } from 'vitest';

import {
  assertWorkspaceLineage,
  createOrganizationAuditIntent,
} from './adminAdapters';
import {
  DFW_ORGANIZATION,
  DFW_ORGANIZATION_ID,
  INACTIVE_OREGON_ORGANIZATION,
  OREGON_ORGANIZATION_ID,
  dfwAdminMembership,
} from './fixtures';
import { ORGANIZATION_ADMIN_SURFACES_ENABLED } from './featureFlags';
import { createMockOrganizationAdminAdapter } from './mockAdminAdapter';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const context = {
  organization: DFW_ORGANIZATION,
  membership: dfwAdminMembership(USER_ID),
};

describe('organization admin contracts', () => {
  it('pins canonical fixtures and keeps runtime adoption disabled', () => {
    expect(DFW_ORGANIZATION_ID).toBe(
      'b1addf00-0000-4000-8000-000000000001',
    );
    expect(OREGON_ORGANIZATION_ID).toBe(
      'b1addf00-0000-4000-8000-000000000002',
    );
    expect(INACTIVE_OREGON_ORGANIZATION.status).toBe('inactive');
    expect(ORGANIZATION_ADMIN_SURFACES_ENABLED).toBe(false);
  });

  it('derives audit organization and actor from trusted context', () => {
    expect(
      createOrganizationAuditIntent(context, {
        action: 'settings.update',
        resourceId: 'settings',
        correlationId: 'correlation-1',
      }),
    ).toMatchObject({
      organizationId: DFW_ORGANIZATION_ID,
      actorUserId: USER_ID,
    });
  });

  it('rejects cross-organization adapter responses', () => {
    expect(() =>
      assertWorkspaceLineage(context, {
        organizationId: OREGON_ORGANIZATION_ID,
        settings: {
          displayName: 'Wrong tenant',
          timezone: 'UTC',
          locale: 'en-US',
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
        contacts: [],
        memberships: [],
        territories: [],
        services: [],
      }),
    ).toThrow('organization_lineage_mismatch');
  });

  it('denies inactive mutations and optimistic concurrency conflicts', async () => {
    const adapter = createMockOrganizationAdminAdapter();
    await expect(
      adapter.updateSettings(
        {
          organization: INACTIVE_OREGON_ORGANIZATION,
          membership: {
            organizationId: OREGON_ORGANIZATION_ID,
            userId: USER_ID,
            role: 'admin',
            active: true,
          },
        },
        {
          displayName: 'Activate Oregon',
          timezone: 'America/Los_Angeles',
          locale: 'en-US',
          expectedUpdatedAt: '2026-07-29T00:00:00.000Z',
        },
      ),
    ).rejects.toThrow('inactive_organization');

    await expect(
      adapter.updateSettings(context, {
        displayName: 'BluLadder DFW',
        timezone: 'America/Chicago',
        locale: 'en-US',
        expectedUpdatedAt: 'stale',
      }),
    ).rejects.toThrow('organization_settings_conflict');
  });
});
