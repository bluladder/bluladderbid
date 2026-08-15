export const KLAMATH_PUBLIC_HOSTNAME = 'klamath.bluladder.com';
export const DFW_PUBLIC_HOSTNAME = 'bid.bluladder.com';

export const KLAMATH_COMPLIANCE_ROUTES = ['/privacy', '/terms', '/contact'] as const;
export type KlamathComplianceRoute = (typeof KLAMATH_COMPLIANCE_ROUTES)[number];

export interface PublishedPublicContact {
  channel: 'phone' | 'email';
  label: string;
  value: string;
}

export interface PublicSiteBootstrap {
  status: 'resolved';
  tenantKey: string;
  publicName: string;
  tagline: string;
  accessMode: 'customer' | 'compliance_only';
  complianceRoutes: KlamathComplianceRoute[];
  customerRuntimeReady: false;
  publicContactReady: boolean;
  publicContacts: PublishedPublicContact[];
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
    publicContactReady: boolean;
    publicContacts: PublishedPublicContact[];
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
  const contacts = parsePublicContacts(record.publicContacts);
  if (
    record.status !== 'resolved' ||
    record.tenantKey !== 'bluladder-klamath' ||
    record.publicName !== 'BluLadder Klamath' ||
    record.tagline !== 'Next Level Clean' ||
    (record.accessMode !== 'customer' && record.accessMode !== 'compliance_only') ||
    record.customerRuntimeReady !== false ||
    typeof record.publicContactReady !== 'boolean' ||
    contacts === null ||
    (record.publicContactReady ? contacts.length === 0 : contacts.length !== 0) ||
    !Array.isArray(routes) || routes.length !== KLAMATH_COMPLIANCE_ROUTES.length ||
    !KLAMATH_COMPLIANCE_ROUTES.every((route, index) => routes[index] === route)
  ) {
    return null;
  }
  return { ...record, publicContacts: contacts } as unknown as PublicSiteBootstrap;
}

function validLabel(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 &&
    value.length <= 80 && ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

function parsePublicContacts(value: unknown): PublishedPublicContact[] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const contacts: PublishedPublicContact[] = [];
  const channels = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const contact = candidate as Record<string, unknown>;
    if (!validLabel(contact.label) || typeof contact.value !== 'string') return null;
    if (contact.channel === 'phone' && /^\+[1-9][0-9]{7,14}$/.test(contact.value)) {
      contacts.push({ channel: 'phone', label: contact.label, value: contact.value });
    } else if (
      contact.channel === 'email' && contact.value === contact.value.toLowerCase() &&
      contact.value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value)
    ) {
      contacts.push({ channel: 'email', label: contact.label, value: contact.value });
    } else return null;
    if (channels.has(String(contact.channel))) return null;
    channels.add(String(contact.channel));
  }
  return contacts;
}

export function publicContactHref(contact: PublishedPublicContact): string {
  return contact.channel === 'phone' ? `tel:${contact.value}` : `mailto:${contact.value}`;
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
    publicContacts: bootstrap.publicContacts,
  };
}
