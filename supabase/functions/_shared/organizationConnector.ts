import {
  type ConnectorAudit,
  type ConnectorCapability,
  type ConnectorContext,
  type ConnectorFailureCode,
  type ConnectorResult,
  type OrganizationConnectorConfig,
} from "./connectorContracts.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ConnectorSelection =
  | { status: "resolved"; context: ConnectorContext }
  | {
    status: "manual_review";
    code:
      | "connector_missing"
      | "connector_ambiguous"
      | "connector_inactive"
      | "capability_unsupported"
      | "credential_reference_missing";
    candidateConnectorIds: string[];
  };

export function selectOrganizationConnector(
  organizationId: string,
  operation: ConnectorCapability,
  configs: OrganizationConnectorConfig[],
): ConnectorSelection {
  if (!UUID_PATTERN.test(organizationId)) {
    return {
      status: "manual_review",
      code: "connector_missing",
      candidateConnectorIds: [],
    };
  }

  const organizationConfigs = configs.filter((config) =>
    config.organizationId.toLowerCase() === organizationId.toLowerCase()
  );
  if (!organizationConfigs.length) {
    return {
      status: "manual_review",
      code: "connector_missing",
      candidateConnectorIds: [],
    };
  }

  const active = organizationConfigs.filter((config) =>
    config.status === "active"
  );
  if (!active.length) {
    return {
      status: "manual_review",
      code: "connector_inactive",
      candidateConnectorIds: organizationConfigs.map((config) => config.id)
        .sort(),
    };
  }

  const capable = active.filter((config) =>
    config.capabilities.includes(operation)
  );
  if (!capable.length) {
    return {
      status: "manual_review",
      code: "capability_unsupported",
      candidateConnectorIds: active.map((config) => config.id).sort(),
    };
  }

  const configured = capable.filter((config) =>
    config.kind === "manual" || !!config.credentialReference?.trim()
  );
  if (!configured.length) {
    return {
      status: "manual_review",
      code: "credential_reference_missing",
      candidateConnectorIds: capable.map((config) => config.id).sort(),
    };
  }

  const ranked = [...configured].sort((left, right) =>
    right.priority - left.priority || left.id.localeCompare(right.id)
  );
  const peers = ranked.filter((config) =>
    config.priority === ranked[0].priority
  );
  if (peers.length !== 1) {
    return {
      status: "manual_review",
      code: "connector_ambiguous",
      candidateConnectorIds: peers.map((config) => config.id).sort(),
    };
  }

  const winner = ranked[0];
  return {
    status: "resolved",
    context: {
      connectorId: winner.id,
      organizationId: winner.organizationId,
      kind: winner.kind,
    },
  };
}

export function connectorAudit(
  context: ConnectorContext,
  operation: ConnectorCapability,
  idempotencyKey: string | null,
  attempt = 1,
): ConnectorAudit {
  return {
    organizationId: context.organizationId,
    connectorId: context.connectorId,
    operation,
    idempotencyKey,
    attempt,
  };
}

export function guardConnectorRequest(
  context: ConnectorContext,
  requestOrganizationId: string,
  operation: ConnectorCapability,
  idempotencyKey: string | null,
): ConnectorResult<never> | null {
  const audit = connectorAudit(context, operation, idempotencyKey);
  if (
    !UUID_PATTERN.test(requestOrganizationId) ||
    context.organizationId.toLowerCase() !==
      requestOrganizationId.toLowerCase()
  ) {
    return {
      status: "manual_review",
      code: "organization_lineage_mismatch",
      retryable: false,
      audit,
    };
  }
  const writes: ConnectorCapability[] = [
    "customer_sync",
    "quote_sync",
    "booking_create",
    "booking_update",
    "booking_cancel",
    "invoice_handoff",
    "communications_handoff",
  ];
  if (writes.includes(operation) && !idempotencyKey?.trim()) {
    return {
      status: "manual_review",
      code: "idempotency_key_missing",
      retryable: false,
      audit,
    };
  }
  return null;
}

export function providerFailure<T>(
  context: ConnectorContext,
  operation: ConnectorCapability,
  idempotencyKey: string | null,
  code: Extract<
    ConnectorFailureCode,
    "provider_unavailable" | "provider_rejected" | "retry_exhausted"
  >,
  attempt = 1,
): ConnectorResult<T> {
  return {
    status: "manual_review",
    code,
    retryable: code === "provider_unavailable",
    audit: connectorAudit(context, operation, idempotencyKey, attempt),
  };
}
