export const BLULADDER_DFW_ORGANIZATION_ID =
  "b1addf00-0000-4000-8000-000000000001";

export type OrganizationSignalSource =
  | "resource"
  | "membership"
  | "provider"
  | "site"
  | "territory"
  | "legacy_dfw";

export interface OrganizationSignal {
  organizationId: string;
  source: OrganizationSignalSource;
  evidence: string;
}

export type OrganizationResolution =
  | {
    ok: true;
    organizationId: string;
    source: OrganizationSignalSource;
    evidence: string[];
  }
  | {
    ok: false;
    reason: "missing" | "ambiguous" | "conflict" | "legacy_not_allowed";
  };

const precedence: Record<OrganizationSignalSource, number> = {
  resource: 600,
  membership: 500,
  provider: 400,
  site: 300,
  territory: 200,
  legacy_dfw: 100,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves only already-verified server-side signals. This function never
 * validates client payloads or performs a fallback implicitly.
 */
export function resolveOrganizationContext(
  signals: OrganizationSignal[],
  options: { allowLegacyDfw: boolean } = { allowLegacyDfw: false },
): OrganizationResolution {
  if (!signals.length) return { ok: false, reason: "missing" };
  if (signals.some((signal) => !UUID_PATTERN.test(signal.organizationId))) {
    return { ok: false, reason: "ambiguous" };
  }
  if (
    !options.allowLegacyDfw &&
    signals.some((signal) => signal.source === "legacy_dfw")
  ) {
    return { ok: false, reason: "legacy_not_allowed" };
  }

  const organizationIds = new Set(
    signals.map((signal) => signal.organizationId.toLowerCase()),
  );
  if (organizationIds.size > 1) return { ok: false, reason: "conflict" };

  const ordered = [...signals].sort(
    (left, right) => precedence[right.source] - precedence[left.source],
  );
  const winner = ordered[0];
  const samePrecedence = ordered.filter(
    (signal) => precedence[signal.source] === precedence[winner.source],
  );
  if (
    new Set(samePrecedence.map((signal) => signal.organizationId.toLowerCase()))
      .size > 1
  ) {
    return { ok: false, reason: "ambiguous" };
  }

  return {
    ok: true,
    organizationId: winner.organizationId.toLowerCase(),
    source: winner.source,
    evidence: ordered.map((signal) => signal.evidence),
  };
}

export function legacyDfwSignal(evidence: string): OrganizationSignal {
  return {
    organizationId: BLULADDER_DFW_ORGANIZATION_ID,
    source: "legacy_dfw",
    evidence,
  };
}

/**
 * Service-role callers must apply this guard before a tenant-owned read/write;
 * service credentials bypass RLS and are never organization authority.
 */
export function assertOrganizationLineage(
  resolvedOrganizationId: string,
  resourceOrganizationId: string | null | undefined,
  options: { allowUnscopedLegacy: boolean } = { allowUnscopedLegacy: false },
): void {
  if (!UUID_PATTERN.test(resolvedOrganizationId)) {
    throw new Error("organization_context_invalid");
  }
  if (!resourceOrganizationId) {
    if (options.allowUnscopedLegacy) return;
    throw new Error("organization_lineage_missing");
  }
  if (
    !UUID_PATTERN.test(resourceOrganizationId) ||
    resolvedOrganizationId.toLowerCase() !==
      resourceOrganizationId.toLowerCase()
  ) {
    throw new Error("organization_lineage_mismatch");
  }
}
