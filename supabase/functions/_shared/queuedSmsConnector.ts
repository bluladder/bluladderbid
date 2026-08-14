// deno-lint-ignore-file no-explicit-any
import {
  guardMessagingDispatch,
  type OrganizationMessagingConnectorConfig,
} from "./messagingConnectorContracts.ts";
import { queuedProviderIdempotencyKey } from "./queueDelivery.ts";
import { selectSmsConnector } from "./smsOutbox.ts";

type Supa = any;
type QueueMessage = Record<string, any>;

export type QueuedSmsConnectorAuthorization =
  | {
    status: "authorized";
    connector: OrganizationMessagingConnectorConfig;
  }
  | { status: "blocked"; reason: string };

/**
 * Select, persist, and recheck the organization-owned connector for one
 * already-claimed queued SMS. No provider call is made here.
 */
export async function authorizeQueuedSmsConnector(
  supabase: Supa,
  msg: QueueMessage,
): Promise<QueuedSmsConnectorAuthorization> {
  const organizationId = typeof msg.organization_id === "string"
    ? msg.organization_id
    : "";
  if (!organizationId) {
    return { status: "blocked", reason: "organization_missing" };
  }
  const selection = await selectSmsConnector(supabase, organizationId);
  if (selection.status !== "resolved") {
    return { status: "blocked", reason: selection.reason };
  }

  const persistedConnectorId = typeof msg.messaging_connector_id === "string"
    ? msg.messaging_connector_id
    : null;
  if (
    persistedConnectorId && persistedConnectorId !== selection.connector.id
  ) {
    return { status: "blocked", reason: "connector_lineage_mismatch" };
  }

  // Persist the selected connector under the current queue claim before the
  // provider boundary. The Phase 1G trigger independently rejects an
  // organization/channel mismatch. A stale or replaced claim updates no row.
  let bind = supabase
    .from("sms_messages")
    .update({ messaging_connector_id: selection.connector.id })
    .eq("id", msg.id)
    .eq("send_claim_token", msg.send_claim_token)
    .eq("outbox_state", "pending_send")
    .eq("organization_id", organizationId)
    .eq("channel", "sms");
  bind = persistedConnectorId
    ? bind.eq("messaging_connector_id", persistedConnectorId)
    : bind.is("messaging_connector_id", null);
  const { data: bound, error: bindError } = await bind
    .select(
      "id, organization_id, messaging_connector_id, channel, outbound_idempotency_key",
    )
    .maybeSingle();
  if (bindError || !bound) {
    return { status: "blocked", reason: "connector_binding_failed" };
  }

  const guard = guardMessagingDispatch(selection.connector, {
    organizationId: String(bound.organization_id ?? ""),
    connectorId: String(bound.messaging_connector_id ?? ""),
    channel: "sms",
    idempotencyKey: queuedProviderIdempotencyKey({
      id: String(bound.id ?? msg.id ?? ""),
      outbound_idempotency_key:
        typeof bound.outbound_idempotency_key === "string"
          ? bound.outbound_idempotency_key
          : typeof msg.outbound_idempotency_key === "string"
          ? msg.outbound_idempotency_key
          : null,
    }),
  });
  return guard.status === "authorized"
    ? { status: "authorized", connector: selection.connector }
    : { status: "blocked", reason: guard.code };
}
