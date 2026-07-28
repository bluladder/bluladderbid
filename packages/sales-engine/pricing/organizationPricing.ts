export type PricingStrategyKind =
  | "square_footage"
  | "window_count"
  | "pane_count"
  | "manual_quote"
  | "promotional_package"
  | "hybrid";

export type EstimateStrategyKind =
  | "configured_formula"
  | "fixed"
  | "manual_review";

export interface OrganizationServiceCatalogEntry {
  id: string;
  organizationId: string;
  serviceKey: string;
  name: string;
  kind: "standard" | "custom";
  approvalStatus: "draft" | "approved" | "retired";
  quoteAvailability: "enabled" | "disabled" | "manual_review";
  planAvailability: "enabled" | "disabled" | "manual_review";
  pricingStrategies: PricingStrategyKind[];
  pricingPriority: PricingStrategyKind[];
  laborStrategy: EstimateStrategyKind;
  durationStrategy: EstimateStrategyKind;
}

export interface OrganizationPricingProfile<TConfig = unknown> {
  id: string;
  organizationId: string;
  version: number;
  status: "draft" | "approved" | "retired";
  effectiveFrom: string | null;
  config: TConfig;
  minimums: Record<string, number>;
  laborTargets: Record<string, number>;
  travelRules: Record<string, unknown>;
  discounts: Record<string, unknown>;
  taxRules: Record<string, unknown>;
  buffers: Record<string, unknown>;
  manualReviewThresholds: Record<string, number>;
}

export interface PricingAudit {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  serviceKey: string;
  strategy: PricingStrategyKind;
  inputsHash: string;
}

export type CatalogResolution =
  | {
    status: "resolved";
    service: OrganizationServiceCatalogEntry;
    strategy: PricingStrategyKind;
  }
  | {
    status: "manual_review";
    reason:
      | "service_missing"
      | "service_ambiguous"
      | "service_disabled"
      | "service_unapproved"
      | "strategy_missing"
      | "inputs_unsupported";
  };

export function resolveCatalogStrategy(
  organizationId: string,
  serviceKey: string,
  channel: "quote" | "plan",
  requestedStrategy: PricingStrategyKind | null,
  supportedInputs: PricingStrategyKind[],
  catalog: OrganizationServiceCatalogEntry[],
): CatalogResolution {
  const matches = catalog.filter((entry) =>
    entry.organizationId === organizationId &&
    entry.serviceKey === serviceKey
  );
  if (!matches.length) {
    return { status: "manual_review", reason: "service_missing" };
  }
  if (matches.length > 1) {
    return { status: "manual_review", reason: "service_ambiguous" };
  }
  const service = matches[0];
  if (service.approvalStatus !== "approved") {
    return { status: "manual_review", reason: "service_unapproved" };
  }
  const availability = channel === "quote"
    ? service.quoteAvailability
    : service.planAvailability;
  if (availability !== "enabled") {
    return { status: "manual_review", reason: "service_disabled" };
  }

  const usable = service.pricingPriority.filter((strategy) =>
    service.pricingStrategies.includes(strategy) &&
    (strategy === "manual_quote" || supportedInputs.includes(strategy))
  );
  if (requestedStrategy) {
    if (!service.pricingStrategies.includes(requestedStrategy)) {
      return { status: "manual_review", reason: "strategy_missing" };
    }
    if (
      requestedStrategy !== "manual_quote" &&
      !supportedInputs.includes(requestedStrategy)
    ) {
      return { status: "manual_review", reason: "inputs_unsupported" };
    }
    return { status: "resolved", service, strategy: requestedStrategy };
  }
  if (!usable.length) {
    return { status: "manual_review", reason: "inputs_unsupported" };
  }
  return { status: "resolved", service, strategy: usable[0] };
}

export type PricingProfileResolution<TConfig> =
  | { status: "resolved"; profile: OrganizationPricingProfile<TConfig> }
  | {
    status: "manual_review";
    reason:
      | "profile_missing"
      | "profile_ambiguous"
      | "profile_unapproved";
  };

export function resolvePricingProfile<TConfig>(
  organizationId: string,
  profiles: OrganizationPricingProfile<TConfig>[],
): PricingProfileResolution<TConfig> {
  const organizationProfiles = profiles.filter((profile) =>
    profile.organizationId === organizationId
  );
  const approved = organizationProfiles.filter((profile) =>
    profile.status === "approved"
  );
  if (!organizationProfiles.length) {
    return { status: "manual_review", reason: "profile_missing" };
  }
  if (!approved.length) {
    return { status: "manual_review", reason: "profile_unapproved" };
  }
  const highestVersion = Math.max(...approved.map((profile) => profile.version));
  const current = approved.filter((profile) =>
    profile.version === highestVersion
  );
  if (current.length !== 1) {
    return { status: "manual_review", reason: "profile_ambiguous" };
  }
  return { status: "resolved", profile: current[0] };
}

export type OrganizationPricingResult<T> =
  | { status: "ok"; value: T; profileId: string; profileVersion: number }
  | {
    status: "manual_review";
    reason:
      | "organization_lineage_mismatch"
      | "profile_missing"
      | "profile_ambiguous"
      | "profile_unapproved";
  };

export function calculateWithOrganizationProfile<TInput, TConfig, TResult>(
  organizationId: string,
  requestOrganizationId: string,
  input: TInput,
  profiles: OrganizationPricingProfile<TConfig>[],
  calculate: (input: TInput, config: TConfig) => TResult,
): OrganizationPricingResult<TResult> {
  if (organizationId !== requestOrganizationId) {
    return {
      status: "manual_review",
      reason: "organization_lineage_mismatch",
    };
  }
  const resolved = resolvePricingProfile(organizationId, profiles);
  if (resolved.status !== "resolved") return resolved;
  return {
    status: "ok",
    value: calculate(input, resolved.profile.config),
    profileId: resolved.profile.id,
    profileVersion: resolved.profile.version,
  };
}
