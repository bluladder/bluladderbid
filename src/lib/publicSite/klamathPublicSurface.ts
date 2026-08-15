export const KLAMATH_PUBLIC_HOSTNAME = 'klamath.bluladder.com';
export const DFW_PUBLIC_HOSTNAME = 'bid.bluladder.com';

export const KLAMATH_COMPLIANCE_ROUTES = ['/privacy', '/terms', '/contact'] as const;
export type KlamathComplianceRoute = (typeof KLAMATH_COMPLIANCE_ROUTES)[number];

export interface PublicSiteBootstrap {
  status: 'resolved';
  tenantKey: string;
  publicName: string;
  tagline: string;
  accessMode: 'customer' | 'compliance_only';
  complianceRoutes: KlamathComplianceRoute[];
  customerRuntimeReady: false;
  publicContactReady: false;
}

export type PublicSurfaceDecision =
  | { mode: 'existing_dfw' }
  | { mode: 'development_preview' }
  | { mode: 'blocked'; reason: 'unknown_host' | 'site_unavailable' | 'route_unavailable' }
  | {
    mode: 'klamath_compliance';
    route: KlamathComplianceRoute;
    publicName: string;
    tagline: string;
    publicContactReady: false;
  };

function normalizedHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

function normalizedPathname(pathname: string): string {
  const path = pathname.trim() || '/';
  return path !== '/' ? path.replace(/\/+$/, '') : path;
}

function isDevelopmentPreview(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' ||
    hostname.endsWith('.lovable.app') || hostname.endsWith('.lovable.dev');
}

export function parsePublicSiteBootstrap(value: unknown): PublicSiteBootstrap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const routes = record.complianceRoutes;
  if (
    record.status !== 'resolved' ||
    record.tenantKey !== 'bluladder-klamath' ||
    record.publicName !== 'BluLadder Klamath' ||
    record.tagline !== 'Next Level Clean' ||
    (record.accessMode !== 'customer' && record.accessMode !== 'compliance_only') ||
    record.customerRuntimeReady !== false ||
    record.publicContactReady !== false ||
    !Array.isArray(routes) || routes.length !== KLAMATH_COMPLIANCE_ROUTES.length ||
    !KLAMATH_COMPLIANCE_ROUTES.every((route, index) => routes[index] === route)
  ) {
    return null;
  }
  return record as unknown as PublicSiteBootstrap;
}

/**
 * Keep the already-live DFW app unchanged, allow local/Lovable development,
 * and fail closed for every other host. Klamath can render only the exact
 * compliance routes after a server-authoritative bootstrap. Even a future
 * `customer` accessMode cannot enable the customer runtime in this release.
 */
export function decidePublicSurface(
  hostname: string,
  pathname: string,
  bootstrap: PublicSiteBootstrap | null,
): PublicSurfaceDecision {
  const host = normalizedHostname(hostname);
  if (host === DFW_PUBLIC_HOSTNAME) return { mode: 'existing_dfw' };
  if (isDevelopmentPreview(host)) return { mode: 'development_preview' };
  if (host !== KLAMATH_PUBLIC_HOSTNAME) {
    return { mode: 'blocked', reason: 'unknown_host' };
  }
  if (!bootstrap) return { mode: 'blocked', reason: 'site_unavailable' };

  const path = normalizedPathname(pathname);
  if (!KLAMATH_COMPLIANCE_ROUTES.includes(path as KlamathComplianceRoute)) {
    return { mode: 'blocked', reason: 'route_unavailable' };
  }
  return {
    mode: 'klamath_compliance',
    route: path as KlamathComplianceRoute,
    publicName: bootstrap.publicName,
    tagline: bootstrap.tagline,
    publicContactReady: bootstrap.publicContactReady,
  };
}
