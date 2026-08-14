import { CANONICAL_PRODUCTION_APP_URL, getAppUrl } from "./appUrl.ts";
import { DFW_ORGANIZATION_ID } from "./organizationRouting.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type CustomerSiteMappingStatus =
  | "unprovisioned"
  | "provisioning"
  | "active"
  | "disabled";

export interface OrganizationCustomerSiteRoute {
  tenantKey: string;
  organizationId: string | null;
  organizationStatus:
    | "planning"
    | "provisioning"
    | "active"
    | "suspended"
    | "archived";
  canonicalHostname: string;
  baseUrl: string;
  mappingStatus: CustomerSiteMappingStatus;
  runtimeRoutingEnabled: boolean;
  sitePublished: boolean;
  customerTrafficAllowed: boolean;
}

export type OrganizationCustomerSiteResult =
  | {
    status: "resolved";
    tenantKey: string;
    organizationId: string;
    canonicalHostname: string;
    baseUrl: string;
  }
  | {
    status: "blocked";
    code:
      | "invalid_organization_authority"
      | "customer_site_unavailable"
      | "ambiguous_customer_site"
      | "organization_inactive"
      | "site_mapping_inactive"
      | "runtime_routing_disabled"
      | "site_unpublished"
      | "customer_traffic_disabled"
      | "invalid_customer_site_url";
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeHostname(value: string): string | null {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  return HOSTNAME_PATTERN.test(hostname) ? hostname : null;
}

function normalizeCustomerBaseUrl(
  baseUrl: string,
  expectedHostname: string,
): string | null {
  try {
    const url = new URL(baseUrl);
    const canonicalHostname = normalizeHostname(expectedHostname);
    if (
      url.protocol !== "https:" || !canonicalHostname ||
      url.hostname.toLowerCase() !== canonicalHostname || url.port ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "") ||
      /lovable\.(?:app|dev)$/i.test(url.hostname)
    ) {
      return null;
    }
    return `https://${canonicalHostname}`;
  } catch {
    return null;
  }
}

/**
 * Exact compatibility record for the already-live DFW customer site. This is
 * an organization match, not a default: all other organizations remain
 * blocked unless a separately reviewed route is supplied.
 */
export function buildDfwCustomerSiteRoute(
  baseUrl = getAppUrl(),
): OrganizationCustomerSiteRoute {
  return {
    tenantKey: "bluladder-dfw",
    organizationId: DFW_ORGANIZATION_ID,
    organizationStatus: "active",
    canonicalHostname: new URL(CANONICAL_PRODUCTION_APP_URL).hostname,
    baseUrl,
    mappingStatus: "active",
    runtimeRoutingEnabled: true,
    sitePublished: true,
    customerTrafficAllowed: true,
  };
}

function validOrganizationStatus(
  value: unknown,
): value is OrganizationCustomerSiteRoute["organizationStatus"] {
  return ["planning", "provisioning", "active", "suspended", "archived"]
    .includes(String(value));
}

function validMappingStatus(
  value: unknown,
): value is CustomerSiteMappingStatus {
  return ["unprovisioned", "provisioning", "active", "disabled"].includes(
    String(value),
  );
}

/**
 * Load the exact customer-site rows for one server-resolved organization.
 *
 * DFW keeps its reviewed static compatibility record because the live DFW
 * site predates the tenant table. Every other organization is database-backed
 * and fails closed on malformed authority, read errors, missing organization
 * state, malformed rows, or partial evidence. Duplicate valid site rows are
 * deliberately returned so the pure resolver can classify them as ambiguous.
 */
export async function loadOrganizationCustomerSiteRoutes(
  supabase: SB,
  organizationId: string,
  options: { dfwBaseUrl?: string } = {},
): Promise<OrganizationCustomerSiteRoute[]> {
  const authority = organizationId.trim().toLowerCase();
  if (!UUID_PATTERN.test(authority)) return [];
  if (authority === DFW_ORGANIZATION_ID) {
    return [buildDfwCustomerSiteRoute(options.dfwBaseUrl ?? getAppUrl())];
  }
  if (!supabase || typeof supabase.from !== "function") return [];

  try {
    const [organizationResult, siteResult] = await Promise.all([
      supabase.from("organizations")
        .select("id,status")
        .eq("id", authority)
        .limit(2),
      supabase.from("organization_customer_sites")
        .select(
          "tenant_key,organization_id,canonical_hostname,mapping_status,runtime_routing_enabled,site_published,customer_traffic_allowed",
        )
        .eq("organization_id", authority)
        .limit(2),
    ]);
    if (organizationResult.error || siteResult.error) return [];

    const organizations = Array.isArray(organizationResult.data)
      ? organizationResult.data
      : [];
    const sites = Array.isArray(siteResult.data) ? siteResult.data : [];
    if (organizations.length !== 1 || sites.length === 0) return [];
    const organization = organizations[0] as Record<string, unknown>;
    if (
      organization.id !== authority ||
      !validOrganizationStatus(organization.status)
    ) return [];
    const organizationStatus = organization.status;

    const routes: Array<OrganizationCustomerSiteRoute | null> = sites.map(
      (candidate: unknown) => {
        const row = candidate && typeof candidate === "object"
          ? candidate as Record<string, unknown>
          : {};
        if (
          typeof row.tenant_key !== "string" || !row.tenant_key.trim() ||
          row.organization_id !== authority ||
          typeof row.canonical_hostname !== "string" ||
          !validMappingStatus(row.mapping_status) ||
          typeof row.runtime_routing_enabled !== "boolean" ||
          typeof row.site_published !== "boolean" ||
          typeof row.customer_traffic_allowed !== "boolean"
        ) return null;
        const canonicalHostname = row.canonical_hostname.trim().toLowerCase();
        return {
          tenantKey: row.tenant_key.trim(),
          organizationId: authority,
          organizationStatus,
          canonicalHostname,
          baseUrl: `https://${canonicalHostname}`,
          mappingStatus: row.mapping_status,
          runtimeRoutingEnabled: row.runtime_routing_enabled,
          sitePublished: row.site_published,
          customerTrafficAllowed: row.customer_traffic_allowed,
        } satisfies OrganizationCustomerSiteRoute;
      },
    );
    return routes.every((route) => route !== null)
      ? routes as OrganizationCustomerSiteRoute[]
      : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a customer-facing site from trusted organization authority only.
 * There is no geographic, hostname, DFW, or first-record fallback.
 */
export function resolveOrganizationCustomerSite(
  organizationId: string,
  routes: readonly OrganizationCustomerSiteRoute[],
): OrganizationCustomerSiteResult {
  const authority = organizationId.trim().toLowerCase();
  if (!UUID_PATTERN.test(authority)) {
    return { status: "blocked", code: "invalid_organization_authority" };
  }

  const matches = routes.filter((route) =>
    route.organizationId?.trim().toLowerCase() === authority
  );
  if (!matches.length) {
    return { status: "blocked", code: "customer_site_unavailable" };
  }
  if (matches.length !== 1) {
    return { status: "blocked", code: "ambiguous_customer_site" };
  }

  const route = matches[0];
  if (route.organizationStatus !== "active") {
    return { status: "blocked", code: "organization_inactive" };
  }
  if (route.mappingStatus !== "active") {
    return { status: "blocked", code: "site_mapping_inactive" };
  }
  if (!route.runtimeRoutingEnabled) {
    return { status: "blocked", code: "runtime_routing_disabled" };
  }
  if (!route.sitePublished) {
    return { status: "blocked", code: "site_unpublished" };
  }
  if (!route.customerTrafficAllowed) {
    return { status: "blocked", code: "customer_traffic_disabled" };
  }

  const baseUrl = normalizeCustomerBaseUrl(
    route.baseUrl,
    route.canonicalHostname,
  );
  if (!baseUrl) {
    return { status: "blocked", code: "invalid_customer_site_url" };
  }

  return {
    status: "resolved",
    tenantKey: route.tenantKey,
    organizationId: authority,
    canonicalHostname: route.canonicalHostname.trim().toLowerCase(),
    baseUrl,
  };
}
