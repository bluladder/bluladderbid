export const LAUNCH_DIAGNOSTIC_KINDS = [
  "booking_outcome",
  "manual_intervention",
  "bid_delivery",
  "quote_response",
  "communication",
  "follow_up",
  "voice_call",
  "launch_incident",
] as const;

export type LaunchDiagnosticKind = (typeof LAUNCH_DIAGNOSTIC_KINDS)[number];
export type LaunchDiagnosticRecord = {
  id: string;
  organizationId: string;
  kind: LaunchDiagnosticKind;
  occurredAt: string;
  updatedAt: string;
  correlationId: string;
  reasonCode: string;
  retryable: boolean;
  retryState: "none" | "available" | "claimed" | "uncertain" | "terminal";
  resolutionState: "unresolved" | "resolving" | "resolved";
  evidenceTier: "repository_fixture" | "hosted_persistence";
  customerRef: string | null;
  jobRef: string | null;
  quoteRef: string | null;
  bookingRef: string | null;
  callRef: string | null;
  customerWasToldInaccurateState: boolean;
  actionRequired: string | null;
};

export type DiagnosticAccessContext = {
  authenticated: boolean;
  adminAuthorized: boolean;
  organizationId: string | null;
};

export function selectLaunchDiagnostics(
  records: LaunchDiagnosticRecord[],
  context: DiagnosticAccessContext,
  filter: {
    kinds?: LaunchDiagnosticKind[];
    unresolvedOnly?: boolean;
    retryableOnly?: boolean;
  } = {},
): LaunchDiagnosticRecord[] {
  if (!context.authenticated || !context.adminAuthorized || !context.organizationId) return [];
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : null;
  return records
    .filter((record) => record.organizationId === context.organizationId)
    .filter((record) => !kinds || kinds.has(record.kind))
    .filter((record) => !filter.unresolvedOnly || record.resolutionState !== "resolved")
    .filter((record) => !filter.retryableOnly || record.retryable)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function unresolvedLaunchDiagnosticCount(
  records: LaunchDiagnosticRecord[],
  context: DiagnosticAccessContext,
): number {
  return selectLaunchDiagnostics(records, context, { unresolvedOnly: true }).length;
}

export function canResolveLaunchDiagnostic(
  record: LaunchDiagnosticRecord,
  context: DiagnosticAccessContext,
  expectedUpdatedAt: string,
): boolean {
  return context.authenticated && context.adminAuthorized &&
    context.organizationId === record.organizationId &&
    record.resolutionState === "unresolved" &&
    record.updatedAt === expectedUpdatedAt;
}

export function resolveDiagnosticsMode(value: string | undefined): "disabled" | "repository_fixture" {
  return value === "repository_fixture" ? "repository_fixture" : "disabled";
}

