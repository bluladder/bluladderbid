export type MessagingChannel = "sms" | "email";

export type MessagingProvider = "callrail" | "twilio" | "resend";

export interface OrganizationMessagingConnectorConfig {
  id: string;
  organizationId: string;
  channel: MessagingChannel;
  provider: MessagingProvider;
  status: "active" | "inactive" | "degraded";
  priority: number;
  credentialReference: string | null;
  senderIdentityReference: string | null;
}

export type MessagingConnectorFailureCode =
  | "connector_missing"
  | "connector_inactive"
  | "connector_ambiguous"
  | "credential_reference_missing"
  | "sender_identity_missing"
  | "organization_lineage_mismatch"
  | "channel_mismatch"
  | "idempotency_key_missing";

export type MessagingConnectorSelection =
  | {
    status: "resolved";
    connector: OrganizationMessagingConnectorConfig;
  }
  | {
    status: "blocked";
    code: Extract<
      MessagingConnectorFailureCode,
      | "connector_missing"
      | "connector_inactive"
      | "connector_ambiguous"
      | "credential_reference_missing"
      | "sender_identity_missing"
    >;
    candidateConnectorIds: string[];
  };

export interface MessagingDispatchAuthority {
  organizationId: string;
  connectorId: string;
  channel: MessagingChannel;
  idempotencyKey: string;
}

export type MessagingDispatchGuard =
  | { status: "authorized" }
  | {
    status: "blocked";
    code: Extract<
      MessagingConnectorFailureCode,
      | "organization_lineage_mismatch"
      | "channel_mismatch"
      | "idempotency_key_missing"
    >;
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ids(configs: OrganizationMessagingConnectorConfig[]): string[] {
  return configs.map((config) => config.id).sort();
}

/**
 * Resolve exactly one active organization-owned sender for one channel.
 *
 * The caller must supply server-derived organization authority. Recipient
 * identity, browser input, message content, and provider response data are
 * never accepted as organization selectors.
 */
export function selectOrganizationMessagingConnector(
  organizationId: string,
  channel: MessagingChannel,
  configs: OrganizationMessagingConnectorConfig[],
): MessagingConnectorSelection {
  if (!UUID_PATTERN.test(organizationId)) {
    return {
      status: "blocked",
      code: "connector_missing",
      candidateConnectorIds: [],
    };
  }

  const organization = configs.filter((config) =>
    config.organizationId.toLowerCase() === organizationId.toLowerCase() &&
    config.channel === channel
  );
  if (!organization.length) {
    return {
      status: "blocked",
      code: "connector_missing",
      candidateConnectorIds: [],
    };
  }

  const active = organization.filter((config) => config.status === "active");
  if (!active.length) {
    return {
      status: "blocked",
      code: "connector_inactive",
      candidateConnectorIds: ids(organization),
    };
  }

  const ranked = [...active].sort((left, right) =>
    right.priority - left.priority || left.id.localeCompare(right.id)
  );
  const peers = ranked.filter((config) =>
    config.priority === ranked[0].priority
  );
  if (peers.length !== 1) {
    return {
      status: "blocked",
      code: "connector_ambiguous",
      candidateConnectorIds: ids(peers),
    };
  }

  const connector = ranked[0];
  if (!connector.credentialReference?.trim()) {
    return {
      status: "blocked",
      code: "credential_reference_missing",
      candidateConnectorIds: [connector.id],
    };
  }
  if (!connector.senderIdentityReference?.trim()) {
    return {
      status: "blocked",
      code: "sender_identity_missing",
      candidateConnectorIds: [connector.id],
    };
  }

  return { status: "resolved", connector };
}

/**
 * Bind one durable outbox attempt to the connector selected for the same
 * organization and channel before any provider call can occur.
 */
export function guardMessagingDispatch(
  selected: OrganizationMessagingConnectorConfig,
  authority: MessagingDispatchAuthority,
): MessagingDispatchGuard {
  if (
    !UUID_PATTERN.test(authority.organizationId) ||
    selected.organizationId.toLowerCase() !==
      authority.organizationId.toLowerCase() ||
    selected.id !== authority.connectorId
  ) {
    return { status: "blocked", code: "organization_lineage_mismatch" };
  }
  if (selected.channel !== authority.channel) {
    return { status: "blocked", code: "channel_mismatch" };
  }
  if (!authority.idempotencyKey.trim()) {
    return { status: "blocked", code: "idempotency_key_missing" };
  }
  return { status: "authorized" };
}
