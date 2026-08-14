import { CANONICAL_PRODUCTION_APP_URL } from "./appUrl.ts";
import { DFW_ORGANIZATION_ID } from "./organizationRouting.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type PortalOrganizationAuthority =
  | {
    status: "resolved";
    organizationId: string;
    hostname: string;
    source: "exact_dfw_compatibility" | "active_customer_site";
  }
  | {
    status: "blocked";
    code:
      | "missing_origin"
      | "invalid_origin"
      | "customer_site_unavailable"
      | "ambiguous_customer_site"
      | "organization_inactive";
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DFW_HOSTNAME = new URL(CANONICAL_PRODUCTION_APP_URL).hostname;

/**
 * Normalize the browser-controlled Origin into a non-authoritative hostname
 * selector. The hostname gains authority only after an exact server-side site
 * lookup (or the reviewed DFW compatibility match) succeeds.
 */
export function normalizePortalOrigin(rawOrigin: string | null):
  | { ok: true; hostname: string }
  | { ok: false; code: "missing_origin" | "invalid_origin" } {
  if (!rawOrigin) return { ok: false, code: "missing_origin" };
  try {
    const url = new URL(rawOrigin);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash ||
      !HOSTNAME_PATTERN.test(hostname) ||
      /lovable\.(?:app|dev)$/i.test(hostname)
    ) {
      return { ok: false, code: "invalid_origin" };
    }
    return { ok: true, hostname };
  } catch {
    return { ok: false, code: "invalid_origin" };
  }
}

/**
 * Resolve one active organization from an exact customer-site Origin.
 *
 * No organization ID, tenant key, geography, or provider value is accepted
 * from the browser. Klamath remains blocked until its organization and every
 * customer-site activation flag are separately enabled.
 */
export async function resolvePortalOrganizationAuthority(
  supabase: SB,
  req: Request,
): Promise<PortalOrganizationAuthority> {
  const origin = normalizePortalOrigin(req.headers.get("origin"));
  if (!origin.ok) return { status: "blocked", code: origin.code };

  if (origin.hostname === DFW_HOSTNAME) {
    return {
      status: "resolved",
      organizationId: DFW_ORGANIZATION_ID,
      hostname: origin.hostname,
      source: "exact_dfw_compatibility",
    };
  }
  if (!supabase || typeof supabase.from !== "function") {
    return { status: "blocked", code: "customer_site_unavailable" };
  }

  try {
    const { data: siteRows, error: siteError } = await supabase
      .from("organization_customer_sites")
      .select(
        "organization_id,canonical_hostname,mapping_status,runtime_routing_enabled,site_published,customer_traffic_allowed",
      )
      .eq("canonical_hostname", origin.hostname)
      .limit(2);
    if (siteError) {
      return { status: "blocked", code: "customer_site_unavailable" };
    }
    const sites = Array.isArray(siteRows) ? siteRows : [];
    if (sites.length > 1) {
      return { status: "blocked", code: "ambiguous_customer_site" };
    }
    if (sites.length !== 1) {
      return { status: "blocked", code: "customer_site_unavailable" };
    }
    const site = sites[0] as Record<string, unknown>;
    const organizationId = typeof site.organization_id === "string"
      ? site.organization_id.toLowerCase()
      : "";
    if (
      !UUID_PATTERN.test(organizationId) ||
      site.canonical_hostname !== origin.hostname ||
      site.mapping_status !== "active" ||
      site.runtime_routing_enabled !== true ||
      site.site_published !== true ||
      site.customer_traffic_allowed !== true
    ) {
      return { status: "blocked", code: "customer_site_unavailable" };
    }

    const { data: organizationRows, error: organizationError } = await supabase
      .from("organizations")
      .select("id,status")
      .eq("id", organizationId)
      .limit(2);
    if (organizationError) {
      return { status: "blocked", code: "customer_site_unavailable" };
    }
    const organizations = Array.isArray(organizationRows)
      ? organizationRows
      : [];
    if (organizations.length > 1) {
      return { status: "blocked", code: "ambiguous_customer_site" };
    }
    if (
      organizations.length !== 1 ||
      organizations[0]?.id !== organizationId ||
      organizations[0]?.status !== "active"
    ) {
      return { status: "blocked", code: "organization_inactive" };
    }

    return {
      status: "resolved",
      organizationId,
      hostname: origin.hostname,
      source: "active_customer_site",
    };
  } catch {
    return { status: "blocked", code: "customer_site_unavailable" };
  }
}

export function portalOrganizationMatches(
  expectedOrganizationId: string,
  actualOrganizationId: unknown,
): boolean {
  return typeof actualOrganizationId === "string" &&
    UUID_PATTERN.test(expectedOrganizationId) &&
    actualOrganizationId.toLowerCase() === expectedOrganizationId.toLowerCase();
}
