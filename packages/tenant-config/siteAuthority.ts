import type {
  SiteMappingStatus,
  TenantLifecycle,
} from "./contracts";

export interface TenantSiteAuthorityRecord {
  tenantKey: string;
  organizationId: string | null;
  organizationLifecycle: TenantLifecycle;
  hostname: string;
  mappingStatus: SiteMappingStatus;
  runtimeRoutingEnabled: boolean;
}

export type TenantSiteAuthorityResult =
  | {
    status: "resolved";
    tenantKey: string;
    organizationId: string;
    hostname: string;
  }
  | {
    status: "blocked";
    code:
      | "invalid_hostname"
      | "unsupported_hostname"
      | "ambiguous_site_mapping"
      | "site_mapping_unavailable"
      | "organization_inactive"
      | "runtime_routing_disabled";
    hostname: string | null;
    candidateTenantKeys: string[];
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeAuthorityHostname(rawHostname: string): string | null {
  const raw = rawHostname.trim().toLowerCase();
  if (
    !raw || raw.includes("://") || raw.includes("/") || raw.includes("\\") ||
    raw.includes("@") || raw.includes("?") || raw.includes("#") ||
    /\s/.test(raw)
  ) {
    return null;
  }

  const portMatch = raw.match(/:(\d{1,5})$/);
  if (raw.includes(":")) {
    if (!portMatch) return null;
    const port = Number(portMatch[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  }

  const withoutPort = (portMatch ? raw.slice(0, -portMatch[0].length) : raw)
    .replace(/\.$/, "");
  if (!HOSTNAME_PATTERN.test(withoutPort)) return null;
  return withoutPort;
}

/**
 * Resolves only server-supplied site records. A browser-provided organization
 * ID is never an input, and a hostname alone cannot activate a tenant.
 */
export function resolveTenantSiteAuthority(
  rawHostname: string,
  records: readonly TenantSiteAuthorityRecord[],
): TenantSiteAuthorityResult {
  const hostname = normalizeAuthorityHostname(rawHostname);
  if (!hostname) {
    return {
      status: "blocked",
      code: "invalid_hostname",
      hostname: null,
      candidateTenantKeys: [],
    };
  }

  const matches = records.filter((record) =>
    normalizeAuthorityHostname(record.hostname) === hostname
  );
  if (!matches.length) {
    return {
      status: "blocked",
      code: "unsupported_hostname",
      hostname,
      candidateTenantKeys: [],
    };
  }

  const candidateTenantKeys = [
    ...new Set(matches.map((record) => record.tenantKey)),
  ].sort();
  const distinctMappings = new Set(
    matches.map((record) =>
      `${record.tenantKey}:${record.organizationId ?? "unprovisioned"}`
    ),
  );
  if (matches.length !== 1 || distinctMappings.size !== 1) {
    return {
      status: "blocked",
      code: "ambiguous_site_mapping",
      hostname,
      candidateTenantKeys,
    };
  }

  const match = matches[0];
  if (
    match.mappingStatus !== "active" || !match.organizationId ||
    !UUID_PATTERN.test(match.organizationId)
  ) {
    return {
      status: "blocked",
      code: "site_mapping_unavailable",
      hostname,
      candidateTenantKeys,
    };
  }
  if (match.organizationLifecycle !== "active") {
    return {
      status: "blocked",
      code: "organization_inactive",
      hostname,
      candidateTenantKeys,
    };
  }
  if (!match.runtimeRoutingEnabled) {
    return {
      status: "blocked",
      code: "runtime_routing_disabled",
      hostname,
      candidateTenantKeys,
    };
  }

  return {
    status: "resolved",
    tenantKey: match.tenantKey,
    organizationId: match.organizationId.toLowerCase(),
    hostname,
  };
}
