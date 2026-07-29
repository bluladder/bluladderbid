import { describe, expect, it, vi } from 'vitest';

import { organizationCapabilities } from './capabilities';
import { resolveOrganizationContext } from './context';
import {
  DFW_ORGANIZATION,
  INACTIVE_OREGON_ORGANIZATION,
  OREGON_ORGANIZATION_ID,
  dfwAdminMembership,
} from './fixtures';
import {
  OrganizationLineageError,
  listForOrganization,
} from './tenantRepository';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('organization application context', () => {
  it('preserves the single active DFW membership path', () => {
    const result = resolveOrganizationContext({
      authenticatedUserId: USER_ID,
      organizations: [DFW_ORGANIZATION],
      memberships: [dfwAdminMembership(USER_ID)],
    });

    expect(result).toEqual({
      ok: true,
      context: {
        organization: DFW_ORGANIZATION,
        membership: dfwAdminMembership(USER_ID),
      },
    });
  });

  it.each([
    {
      name: 'missing identity',
      input: { authenticatedUserId: null },
      reason: 'unauthenticated',
    },
    {
      name: 'missing membership',
      input: { authenticatedUserId: USER_ID, memberships: [] },
      reason: 'no_active_membership',
    },
    {
      name: 'untrusted requested organization',
      input: {
        authenticatedUserId: USER_ID,
        requestedOrganizationId: OREGON_ORGANIZATION_ID,
      },
      reason: 'organization_membership_conflict',
    },
  ])('fails closed for $name', ({ input, reason }) => {
    expect(
      resolveOrganizationContext({
        organizations: [DFW_ORGANIZATION, INACTIVE_OREGON_ORGANIZATION],
        memberships: [dfwAdminMembership(USER_ID)],
        ...input,
      }),
    ).toEqual({ ok: false, reason });
  });

  it('requires an explicit trusted selection for multiple memberships', () => {
    const oregonMembership = {
      ...dfwAdminMembership(USER_ID),
      organizationId: OREGON_ORGANIZATION_ID,
    };
    const input = {
      authenticatedUserId: USER_ID,
      organizations: [DFW_ORGANIZATION, INACTIVE_OREGON_ORGANIZATION],
      memberships: [dfwAdminMembership(USER_ID), oregonMembership],
    };

    expect(resolveOrganizationContext(input)).toEqual({
      ok: false,
      reason: 'ambiguous_membership',
    });
    expect(
      resolveOrganizationContext({
        ...input,
        requestedOrganizationId: OREGON_ORGANIZATION_ID,
      }),
    ).toEqual({ ok: false, reason: 'inactive_organization' });
  });
});

describe('organization authorization and data access', () => {
  it('defaults to no capabilities and grants members read-only access', () => {
    expect(organizationCapabilities(undefined)).toEqual({
      viewOrganization: false,
      manageSettings: false,
      manageMembers: false,
      manageRouting: false,
    });
    expect(organizationCapabilities('member')).toEqual({
      viewOrganization: true,
      manageSettings: false,
      manageMembers: false,
      manageRouting: false,
    });
  });

  it('passes only the resolved organization to the data source', async () => {
    const source = {
      listByOrganizationId: vi.fn().mockResolvedValue([
        { id: 'customer-1', organizationId: DFW_ORGANIZATION.id },
      ]),
    };
    const context = {
      organization: DFW_ORGANIZATION,
      membership: dfwAdminMembership(USER_ID),
    };

    await expect(listForOrganization(context, source)).resolves.toHaveLength(1);
    expect(source.listByOrganizationId).toHaveBeenCalledWith(
      DFW_ORGANIZATION.id,
    );
  });

  it('rejects cross-organization records returned by an adapter', async () => {
    const context = {
      organization: DFW_ORGANIZATION,
      membership: dfwAdminMembership(USER_ID),
    };
    const source = {
      listByOrganizationId: vi.fn().mockResolvedValue([
        { id: 'oregon-record', organizationId: OREGON_ORGANIZATION_ID },
      ]),
    };

    await expect(listForOrganization(context, source)).rejects.toBeInstanceOf(
      OrganizationLineageError,
    );
  });
});
