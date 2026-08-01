import {
  type OrganizationResolution,
  type OrganizationSignal,
  type OrganizationSignalSource,
  resolveOrganizationContext,
} from "./organizationResolver.ts";

export type OrganizationResourceKind =
  | "conversation"
  | "quote_session"
  | "customer"
  | "property"
  | "quote"
  | "booking";

export type OrganizationResolutionKeyType =
  | "hostname"
  | "site"
  | "embed"
  | "territory"
  | "jobber_account"
  | "callrail_number"
  | "email_address"
  | "vapi_assistant"
  | "vapi_phone_number";

export interface OrganizationResourceSelector {
  kind: OrganizationResourceKind;
  /** A selector only. The repository must read organization_id from the row. */
  id: string;
}

export interface OrganizationMappedSelector {
  source: "provider" | "site";
  keyType: OrganizationResolutionKeyType;
  /** Raw only at this boundary; it is normalized, hashed, and never logged. */
  value: string;
}

export interface VerifiedTerritorySelector {
  verification: "trusted_territory_rule";
  organizationId: string;
  ruleId: string;
}

export interface OrganizationAuthorityRequest {
  resources?: readonly OrganizationResourceSelector[];
  membership?: {
    authenticatedUserId: string;
    /** Client choice is a selector and must match an active membership. */
    requestedOrganizationId?: string | null;
  } | null;
  mapped?: readonly OrganizationMappedSelector[];
  territory?: VerifiedTerritorySelector | null;
  legacy?: {
    route: "public_booking_service_area";
    explicitlyAllowed: true;
  } | null;
}

export type OrganizationLookupFailure =
  | "lookup_unavailable"
  | "ambiguous";

export type OrganizationLookupResult =
  | { ok: true; signals: OrganizationSignal[] }
  | { ok: false; reason: OrganizationLookupFailure };

export interface OrganizationAuthorityRepository {
  findResourceSignals(
    selectors: readonly OrganizationResourceSelector[],
  ): Promise<OrganizationLookupResult>;
  findMembershipSignals(args: {
    authenticatedUserId: string;
    requestedOrganizationId?: string | null;
  }): Promise<OrganizationLookupResult>;
  findMappedSignals(
    selectors: readonly {
      source: "provider" | "site";
      keyType: OrganizationResolutionKeyType;
      keyHash: string;
    }[],
  ): Promise<OrganizationLookupResult>;
  findOrganizationStatuses(
    organizationIds: readonly string[],
  ): Promise<
    | { ok: true; statuses: Record<string, string> }
    | { ok: false; reason: "lookup_unavailable" }
  >;
}

export type OrganizationAuthorityResolution =
  | {
    status: "resolved";
    organizationId: string;
    source: OrganizationSignalSource;
    evidence: string[];
    sensitiveActionsAllowed: boolean;
  }
  | {
    status: "blocked";
    code:
      | "missing_authority"
      | "ambiguous_authority"
      | "conflicting_authority"
      | "inactive_organization"
      | "legacy_not_allowed"
      | "lookup_unavailable";
  };

const PROVIDER_KEYS = new Set<OrganizationResolutionKeyType>([
  "jobber_account",
  "callrail_number",
  "vapi_assistant",
  "vapi_phone_number",
]);
const SITE_KEYS = new Set<OrganizationResolutionKeyType>([
  "hostname",
  "site",
  "embed",
]);

function normalizeMappedValue(
  keyType: OrganizationResolutionKeyType,
  value: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (keyType === "hostname") {
    return trimmed.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  }
  return trimmed;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function mappedKindIsValid(selector: OrganizationMappedSelector): boolean {
  return selector.source === "provider"
    ? PROVIDER_KEYS.has(selector.keyType)
    : SITE_KEYS.has(selector.keyType);
}

function blockedFromPureResolution(
  result: Extract<OrganizationResolution, { ok: false }>,
): OrganizationAuthorityResolution {
  if (result.reason === "missing") {
    return { status: "blocked", code: "missing_authority" };
  }
  if (result.reason === "ambiguous") {
    return { status: "blocked", code: "ambiguous_authority" };
  }
  if (result.reason === "conflict") {
    return { status: "blocked", code: "conflicting_authority" };
  }
  return { status: "blocked", code: "legacy_not_allowed" };
}

/**
 * Canonical server-derived organization authority boundary.
 *
 * The repository turns selectors into trusted database evidence. Raw client
 * organization IDs are never accepted. All evidence must agree and name one
 * active organization. Legacy DFW is an explicit route capability, never a
 * fallback for missing evidence.
 */
export async function resolveServerOrganizationAuthority(
  repository: OrganizationAuthorityRepository,
  request: OrganizationAuthorityRequest,
): Promise<OrganizationAuthorityResolution> {
  const signals: OrganizationSignal[] = [];

  const resources = request.resources ?? [];
  if (resources.length) {
    const result = await repository.findResourceSignals(resources);
    if (!result.ok) {
      return {
        status: "blocked",
        code: result.reason === "ambiguous"
          ? "ambiguous_authority"
          : "lookup_unavailable",
      };
    }
    // Every presented resource selector is mandatory evidence. A missing row
    // must not disappear merely because a provider or membership also maps.
    if (result.signals.length !== resources.length) {
      return { status: "blocked", code: "missing_authority" };
    }
    signals.push(...result.signals);
  }

  if (request.membership) {
    const result = await repository.findMembershipSignals(request.membership);
    if (!result.ok) {
      return {
        status: "blocked",
        code: result.reason === "ambiguous"
          ? "ambiguous_authority"
          : "lookup_unavailable",
      };
    }
    if (result.signals.length !== 1) {
      return { status: "blocked", code: "missing_authority" };
    }
    signals.push(...result.signals);
  }

  const mapped = request.mapped ?? [];
  if (mapped.some((selector) => !mappedKindIsValid(selector))) {
    return { status: "blocked", code: "ambiguous_authority" };
  }
  const normalizedMapped = (
    await Promise.all(mapped.map(async (selector) => {
      const normalized = normalizeMappedValue(selector.keyType, selector.value);
      if (!normalized) return null;
      return {
        source: selector.source,
        keyType: selector.keyType,
        keyHash: await sha256(normalized),
      };
    }))
  ).filter((selector) => selector !== null);
  if (normalizedMapped.length !== mapped.length) {
    return { status: "blocked", code: "missing_authority" };
  }
  if (normalizedMapped.length) {
    const result = await repository.findMappedSignals(normalizedMapped);
    if (!result.ok) {
      return {
        status: "blocked",
        code: result.reason === "ambiguous"
          ? "ambiguous_authority"
          : "lookup_unavailable",
      };
    }
    // A provider can present more than one trusted resource identifier. Each
    // one must have exactly one active mapping; partial matches fail closed.
    if (result.signals.length !== normalizedMapped.length) {
      return { status: "blocked", code: "missing_authority" };
    }
    signals.push(...result.signals);
  }

  if (request.territory) {
    signals.push({
      organizationId: request.territory.organizationId,
      source: "territory",
      evidence: `territory_rule:${request.territory.ruleId}`,
    });
  }
  if (request.legacy?.explicitlyAllowed === true) {
    signals.push({
      organizationId: "b1addf00-0000-4000-8000-000000000001",
      source: "legacy_dfw",
      evidence: `bounded_route:${request.legacy.route}`,
    });
  }

  const pure = resolveOrganizationContext(signals, {
    allowLegacyDfw: request.legacy?.explicitlyAllowed === true,
  });
  if (!pure.ok) return blockedFromPureResolution(pure);

  const statuses = await repository.findOrganizationStatuses([
    pure.organizationId,
  ]);
  if (!statuses.ok) {
    return { status: "blocked", code: "lookup_unavailable" };
  }
  if (statuses.statuses[pure.organizationId] !== "active") {
    return { status: "blocked", code: "inactive_organization" };
  }

  return {
    status: "resolved",
    organizationId: pure.organizationId,
    source: pure.source,
    evidence: pure.evidence,
    sensitiveActionsAllowed: pure.source !== "legacy_dfw",
  };
}
