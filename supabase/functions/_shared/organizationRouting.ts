export const DFW_ORGANIZATION_ID = "b1addf00-0000-4000-8000-000000000001";
export const OREGON_TEST_ORGANIZATION_ID =
  "b1addf00-0000-4000-8000-000000000002";

export interface RoutingLocation {
  countryCode: string;
  stateCode: string;
  county: string;
  city: string;
  postalCode: string;
}

export interface TerritoryRule {
  id: string;
  name: string;
  organizationId: string;
  organizationStatus: "provisioning" | "active" | "suspended" | "archived";
  countryCode: string;
  stateCode?: string | null;
  county?: string | null;
  city?: string | null;
  postalCode?: string | null;
  effect: "include" | "exclude";
  priority: number;
  status: "active" | "inactive";
}

export type TerritoryRoutingResult =
  | {
    status: "routed";
    organizationId: string;
    matchedRuleId: string;
    region: string;
    matchedBy: "postal_code" | "city" | "county" | "state";
  }
  | {
    status: "manual_review";
    reason:
      | "location_incomplete"
      | "unknown_territory"
      | "overlapping_territory"
      | "conflicting_rules"
      | "organization_inactive";
    candidateOrganizationIds: string[];
  };

export interface OrganizationServiceRule {
  organizationId: string;
  serviceKey: string;
  availability: "available" | "manual_review" | "unavailable";
  status: "active" | "inactive";
  reason?: string | null;
}

export interface OrganizationContact {
  id: string;
  organizationId: string;
  contactType:
    | "escalation_phone"
    | "escalation_sms"
    | "escalation_email"
    | "notification_email"
    | "manager";
  destination: string;
  priority: number;
  status: "active" | "inactive";
}

export interface LeadRoutingTags {
  organizationId: string | null;
  region: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  postalCode: string | null;
  entrySource: string;
  routingStatus: TerritoryRoutingResult["status"];
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function specificity(rule: TerritoryRule): number {
  if (rule.postalCode) return 4;
  if (rule.city) return 3;
  if (rule.county) return 2;
  return rule.stateCode ? 1 : 0;
}

function matches(rule: TerritoryRule, location: RoutingLocation): boolean {
  if (norm(rule.countryCode) !== norm(location.countryCode)) return false;
  if (rule.stateCode && norm(rule.stateCode) !== norm(location.stateCode)) {
    return false;
  }
  if (rule.county && norm(rule.county) !== norm(location.county)) return false;
  if (rule.city && norm(rule.city) !== norm(location.city)) return false;
  if (
    rule.postalCode &&
    norm(rule.postalCode) !== norm(location.postalCode)
  ) {
    return false;
  }
  return specificity(rule) > 0;
}

export function routeOrganizationByTerritory(
  location: RoutingLocation,
  rules: TerritoryRule[],
): TerritoryRoutingResult {
  if (!norm(location.countryCode) || !norm(location.stateCode)) {
    return {
      status: "manual_review",
      reason: "location_incomplete",
      candidateOrganizationIds: [],
    };
  }

  const matched = rules.filter((rule) =>
    rule.status === "active" && matches(rule, location)
  );
  if (!matched.length) {
    return {
      status: "manual_review",
      reason: "unknown_territory",
      candidateOrganizationIds: [],
    };
  }

  const active = matched.filter((rule) => rule.organizationStatus === "active");
  if (!active.length) {
    return {
      status: "manual_review",
      reason: "organization_inactive",
      candidateOrganizationIds: [
        ...new Set(matched.map((rule) => rule.organizationId)),
      ].sort(),
    };
  }

  const ranked = [...active].sort((left, right) =>
    right.priority - left.priority ||
    specificity(right) - specificity(left) ||
    (left.effect === right.effect ? 0 : left.effect === "exclude" ? -1 : 1) ||
    left.id.localeCompare(right.id)
  );
  const top = ranked[0];
  const peers = ranked.filter((rule) =>
    rule.priority === top.priority &&
    specificity(rule) === specificity(top)
  );
  const peerOrganizations = [
    ...new Set(peers.map((rule) => rule.organizationId)),
  ].sort();

  if (
    peers.some((rule) =>
      rule.organizationId === top.organizationId && rule.effect !== top.effect
    )
  ) {
    return {
      status: "manual_review",
      reason: "conflicting_rules",
      candidateOrganizationIds: peerOrganizations,
    };
  }
  if (peerOrganizations.length > 1) {
    return {
      status: "manual_review",
      reason: "overlapping_territory",
      candidateOrganizationIds: peerOrganizations,
    };
  }
  if (top.effect === "exclude") {
    return {
      status: "manual_review",
      reason: "unknown_territory",
      candidateOrganizationIds: [top.organizationId],
    };
  }

  const matchedBy = top.postalCode
    ? "postal_code"
    : top.city
    ? "city"
    : top.county
    ? "county"
    : "state";
  return {
    status: "routed",
    organizationId: top.organizationId,
    matchedRuleId: top.id,
    region: top.name,
    matchedBy,
  };
}

export function resolveServiceAvailability(
  organizationId: string,
  serviceKey: string,
  rules: OrganizationServiceRule[],
): { status: "available" | "manual_review" | "unavailable"; reason: string } {
  const rule = rules.find((candidate) =>
    candidate.organizationId === organizationId &&
    norm(candidate.serviceKey) === norm(serviceKey) &&
    candidate.status === "active"
  );
  if (!rule) {
    return {
      status: "manual_review",
      reason: "organization_service_not_configured",
    };
  }
  return {
    status: rule.availability,
    reason: rule.reason ?? `organization_service_${rule.availability}`,
  };
}

export function resolveOrganizationContact(
  organizationId: string,
  contactType: OrganizationContact["contactType"],
  contacts: OrganizationContact[],
):
  | { status: "resolved"; contact: OrganizationContact }
  | {
    status: "manual_review";
    reason: "missing_contact" | "ambiguous_contact";
  } {
  const candidates = contacts
    .filter((contact) =>
      contact.organizationId === organizationId &&
      contact.contactType === contactType &&
      contact.status === "active"
    )
    .sort((left, right) =>
      left.priority - right.priority || left.id.localeCompare(right.id)
    );
  if (!candidates.length) {
    return { status: "manual_review", reason: "missing_contact" };
  }
  if (
    candidates.length > 1 &&
    candidates[0].priority === candidates[1].priority
  ) {
    return { status: "manual_review", reason: "ambiguous_contact" };
  }
  return { status: "resolved", contact: candidates[0] };
}

export function buildLeadRoutingTags(
  location: RoutingLocation,
  route: TerritoryRoutingResult,
  entrySource: string,
): LeadRoutingTags {
  return {
    organizationId: route.status === "routed" ? route.organizationId : null,
    region: route.status === "routed" ? route.region : null,
    city: location.city || null,
    county: location.county || null,
    state: location.stateCode || null,
    postalCode: location.postalCode || null,
    entrySource: entrySource.trim() || "unknown",
    routingStatus: route.status,
  };
}
