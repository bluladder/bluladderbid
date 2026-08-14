import {
  type AvailabilityReadRequest,
  type BookingCancelRequest,
  type BookingWriteRequest,
  type ConnectorCapability,
  type ConnectorContext,
  type ConnectorHealth,
  type ConnectorResult,
  type CustomerSyncRequest,
  type HandoffRequest,
  type OrganizationConnector,
  type QuoteSyncRequest,
} from "./connectorContracts.ts";
import {
  connectorAudit,
  guardConnectorRequest,
  providerFailure,
} from "./organizationConnector.ts";

type Payload = Record<string, unknown>;

export interface JobTreadOperations {
  readonly supportedCapabilities: readonly ConnectorCapability[];
  health(): Promise<ConnectorHealth>;
  syncCustomer(request: CustomerSyncRequest): Promise<Payload>;
  syncQuote(request: QuoteSyncRequest): Promise<Payload>;
  readAvailability(request: AvailabilityReadRequest): Promise<Payload>;
  createBooking(request: BookingWriteRequest): Promise<Payload>;
  updateBooking(request: BookingWriteRequest): Promise<Payload>;
  cancelBooking(request: BookingCancelRequest): Promise<Payload>;
  handoffInvoice(request: HandoffRequest): Promise<Payload>;
  handoffCommunication(request: HandoffRequest): Promise<Payload>;
}

/**
 * Dormant provider seam for JobTread. The explicit capability allow-list is
 * independent of the provider schema: a documented API primitive is not an
 * approved BluLadder business mapping until the corresponding operation is
 * reviewed and enabled by the server-owned connector configuration.
 */
export function createJobTreadConnectorAdapter(
  context: ConnectorContext,
  operations: JobTreadOperations,
): OrganizationConnector {
  if (context.kind !== "jobtread") {
    throw new Error("jobtread_connector_context_required");
  }

  const supported = new Set(operations.supportedCapabilities);

  const unsupported = <T>(
    operation: ConnectorCapability,
    idempotencyKey: string | null,
  ): ConnectorResult<T> => ({
    status: "manual_review",
    code: "capability_unsupported",
    retryable: false,
    audit: connectorAudit(context, operation, idempotencyKey),
  });

  const invoke = async <T extends { organizationId: string }>(
    operation: ConnectorCapability,
    request: T,
    call: () => Promise<Payload>,
    idempotencyKey: string | null,
  ): Promise<ConnectorResult<Payload>> => {
    const blocked = guardConnectorRequest(
      context,
      request.organizationId,
      operation,
      idempotencyKey,
    );
    if (blocked) return blocked;
    if (!supported.has(operation)) {
      return unsupported(operation, idempotencyKey);
    }
    try {
      return {
        status: "ok",
        value: await call(),
        audit: connectorAudit(context, operation, idempotencyKey),
      };
    } catch {
      return providerFailure(
        context,
        operation,
        idempotencyKey,
        "provider_unavailable",
      );
    }
  };

  return {
    context,
    async health() {
      if (!supported.has("health")) return unsupported("health", null);
      try {
        return {
          status: "ok",
          value: await operations.health(),
          audit: connectorAudit(context, "health", null),
        };
      } catch {
        return providerFailure(
          context,
          "health",
          null,
          "provider_unavailable",
        );
      }
    },
    syncCustomer: (request) =>
      invoke(
        "customer_sync",
        request,
        () => operations.syncCustomer(request),
        request.idempotencyKey,
      ),
    syncQuote: (request) =>
      invoke(
        "quote_sync",
        request,
        () => operations.syncQuote(request),
        request.idempotencyKey,
      ),
    readAvailability: (request) =>
      invoke(
        "availability_read",
        request,
        () => operations.readAvailability(request),
        null,
      ),
    createBooking: (request) =>
      invoke(
        "booking_create",
        request,
        () => operations.createBooking(request),
        request.idempotencyKey,
      ),
    updateBooking: (request) =>
      invoke(
        "booking_update",
        request,
        () => operations.updateBooking(request),
        request.idempotencyKey,
      ),
    cancelBooking: (request) =>
      invoke(
        "booking_cancel",
        request,
        () => operations.cancelBooking(request),
        request.idempotencyKey,
      ),
    handoffInvoice: (request) =>
      invoke(
        "invoice_handoff",
        request,
        () => operations.handoffInvoice(request),
        request.idempotencyKey,
      ),
    handoffCommunication: (request) =>
      invoke(
        "communications_handoff",
        request,
        () => operations.handoffCommunication(request),
        request.idempotencyKey,
      ),
  };
}
