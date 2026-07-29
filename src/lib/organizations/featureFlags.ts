export const ORGANIZATION_ADMIN_SURFACES_ENABLED = false;

export function canRenderOrganizationAdminHarness(
  mode: 'production' | 'test-harness',
): boolean {
  return mode === 'test-harness';
}
