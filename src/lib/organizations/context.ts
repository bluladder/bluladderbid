import type {
  OrganizationContextResult,
  OrganizationMembership,
  OrganizationSummary,
} from './applicationContracts';

interface ResolveOrganizationContextInput {
  authenticatedUserId: string | null;
  requestedOrganizationId?: string;
  organizations: readonly OrganizationSummary[];
  memberships: readonly OrganizationMembership[];
}

export function resolveOrganizationContext(
  input: ResolveOrganizationContextInput,
): OrganizationContextResult {
  if (!input.authenticatedUserId) {
    return { ok: false, reason: 'unauthenticated' };
  }

  const activeMemberships = input.memberships.filter(
    (membership) =>
      membership.active && membership.userId === input.authenticatedUserId,
  );

  if (activeMemberships.length === 0) {
    return { ok: false, reason: 'no_active_membership' };
  }

  let membership: OrganizationMembership;
  if (input.requestedOrganizationId) {
    const matching = activeMemberships.filter(
      (candidate) =>
        candidate.organizationId === input.requestedOrganizationId,
    );
    if (matching.length !== 1) {
      return { ok: false, reason: 'organization_membership_conflict' };
    }
    membership = matching[0];
  } else {
    if (activeMemberships.length !== 1) {
      return { ok: false, reason: 'ambiguous_membership' };
    }
    membership = activeMemberships[0];
  }

  const matches = input.organizations.filter(
    (organization) => organization.id === membership.organizationId,
  );
  if (matches.length !== 1) {
    return { ok: false, reason: 'organization_not_found' };
  }
  if (matches[0].status !== 'active') {
    return { ok: false, reason: 'inactive_organization' };
  }

  return {
    ok: true,
    context: { organization: matches[0], membership },
  };
}
