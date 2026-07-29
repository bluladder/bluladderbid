import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DFW_ORGANIZATION,
  INACTIVE_OREGON_ORGANIZATION,
  dfwAdminMembership,
} from '@/lib/organizations/fixtures';
import { createMockOrganizationAdminAdapter } from '@/lib/organizations/mockAdminAdapter';

import { OrganizationAdminHarness } from './OrganizationAdminHarness';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('OrganizationAdminHarness', () => {
  it('is unmounted and does not load data in production mode', () => {
    const adapter = createMockOrganizationAdminAdapter();
    const load = vi.spyOn(adapter, 'loadWorkspace');

    const { container } = render(
      <OrganizationAdminHarness
        context={{
          organization: DFW_ORGANIZATION,
          membership: dfwAdminMembership(USER_ID),
        }}
        adapter={adapter}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(load).not.toHaveBeenCalled();
  });

  it('renders tangible DFW administration surfaces in the test harness', async () => {
    render(
      <OrganizationAdminHarness
        mode="test-harness"
        context={{
          organization: DFW_ORGANIZATION,
          membership: dfwAdminMembership(USER_ID),
        }}
        adapter={createMockOrganizationAdminAdapter()}
      />,
    );

    expect(await screen.findByText('BluLadder DFW')).toBeInTheDocument();
    expect(screen.getByText('Organization settings')).toBeInTheDocument();
    expect(screen.getByText('Memberships')).toBeInTheDocument();
    expect(screen.getByText('Service areas')).toBeInTheDocument();
    expect(screen.getByText('Service availability')).toBeInTheDocument();
    expect(screen.getByText('Communication contacts')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Organization switching unavailable',
      }),
    ).toBeDisabled();
  });

  it('shows inactive Oregon without activation or edit authority', async () => {
    const adapter = createMockOrganizationAdminAdapter();
    render(
      <OrganizationAdminHarness
        mode="test-harness"
        context={{
          organization: INACTIVE_OREGON_ORGANIZATION,
          membership: {
            organizationId: INACTIVE_OREGON_ORGANIZATION.id,
            userId: USER_ID,
            role: 'admin',
            active: true,
          },
        }}
        adapter={adapter}
      />,
    );

    expect(await screen.findByText('BluLadder Oregon')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
    expect(screen.getByText(/Traffic remains inactive/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Add member' })).toBeDisabled();
    });
    expect(screen.queryByRole('button', { name: /activate/i })).not.toBeInTheDocument();
  });
});
