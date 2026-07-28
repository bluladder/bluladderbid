export type ConnectorKind =
  | "jobber"
  | "jobtread"
  | "google_calendar"
  | "manual";

export type ConnectorCapability =
  | "customer_sync"
  | "quote_sync"
  | "availability_read"
  | "booking_create"
  | "booking_update"
  | "booking_cancel"
  | "invoice_handoff"
  | "communications_handoff"
  | "health";

export interface OrganizationConnectorConfig {
  id: string;
  organizationId: string;
  kind: ConnectorKind;
  status: "active" | "inactive" | "degraded";
  priority: number;
  capabilities: ConnectorCapability[];
  credentialReference: string | null;
}

export interface ConnectorContext {
  connectorId: string;
  organizationId: string;
  kind: ConnectorKind;
}

export type ConnectorFailureCode =
  | "connector_missing"
  | "connector_ambiguous"
  | "connector_inactive"
  | "capability_unsupported"
  | "credential_reference_missing"
  | "organization_lineage_mismatch"
  | "idempotency_key_missing"
  | "provider_unavailable"
  | "provider_rejected"
  | "retry_exhausted";

export type ConnectorResult<T> =
  | { status: "ok"; value: T; audit: ConnectorAudit }
  | {
    status: "manual_review";
    code: ConnectorFailureCode;
    retryable: boolean;
    audit: ConnectorAudit;
  };

export interface ConnectorAudit {
  organizationId: string;
  connectorId: string | null;
  operation: ConnectorCapability;
  idempotencyKey: string | null;
  attempt: number;
}

export interface CustomerSyncRequest {
  organizationId: string;
  idempotencyKey: string;
  customerRef: string;
  payload: Record<string, unknown>;
}

export interface QuoteSyncRequest {
  organizationId: string;
  idempotencyKey: string;
  quoteRef: string;
  payload: Record<string, unknown>;
}

export interface AvailabilityReadRequest {
  organizationId: string;
  serviceKeys: string[];
  startDate: string;
  endDate: string;
}

export interface BookingWriteRequest {
  organizationId: string;
  idempotencyKey: string;
  bookingRef: string;
  payload: Record<string, unknown>;
}

export interface BookingCancelRequest {
  organizationId: string;
  idempotencyKey: string;
  bookingRef: string;
  reason: string;
}

export interface HandoffRequest {
  organizationId: string;
  idempotencyKey: string;
  recordRef: string;
  payload: Record<string, unknown>;
}

export interface ConnectorHealth {
  status: "healthy" | "degraded" | "unavailable";
  checkedAt: string;
  detail?: string;
}

export interface OrganizationConnector {
  readonly context: ConnectorContext;
  health(): Promise<ConnectorResult<ConnectorHealth>>;
  syncCustomer(
    request: CustomerSyncRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
  syncQuote(
    request: QuoteSyncRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
  readAvailability(
    request: AvailabilityReadRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
  createBooking(
    request: BookingWriteRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
  updateBooking(
    request: BookingWriteRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
  cancelBooking(
    request: BookingCancelRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
  handoffInvoice(
    request: HandoffRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
  handoffCommunication(
    request: HandoffRequest,
  ): Promise<ConnectorResult<Record<string, unknown>>>;
}

export interface PaymentDestination {
  organizationId: string;
  destinationReference: string;
  status: "active" | "inactive";
}

export type PaymentDestinationResolution =
  | { status: "resolved"; destination: PaymentDestination }
  | {
    status: "manual_review";
    code: "destination_missing" | "destination_ambiguous";
  };

export function resolvePaymentDestination(
  organizationId: string,
  destinations: PaymentDestination[],
): PaymentDestinationResolution {
  const matches = destinations.filter((destination) =>
    destination.organizationId === organizationId &&
    destination.status === "active"
  );
  if (!matches.length) {
    return { status: "manual_review", code: "destination_missing" };
  }
  if (matches.length !== 1) {
    return { status: "manual_review", code: "destination_ambiguous" };
  }
  return { status: "resolved", destination: matches[0] };
}
