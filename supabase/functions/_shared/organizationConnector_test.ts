import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConnectorCapability,
  type ConnectorHealth,
  type OrganizationConnectorConfig,
  resolvePaymentDestination,
} from "./connectorContracts.ts";
import { createJobberConnectorAdapter } from "./jobberConnectorAdapter.ts";
import { selectOrganizationConnector } from "./organizationConnector.ts";

const DFW = "b1addf00-0000-4000-8000-000000000001";
const OREGON = "b1addf00-0000-4000-8000-000000000002";

function config(
  overrides: Partial<OrganizationConnectorConfig> = {},
): OrganizationConnectorConfig {
  return {
    id: "dfw-jobber",
    organizationId: DFW,
    kind: "jobber",
    status: "active",
    priority: 100,
    capabilities: [
      "customer_sync",
      "quote_sync",
      "availability_read",
      "booking_create",
      "booking_update",
      "booking_cancel",
      "invoice_handoff",
      "communications_handoff",
      "health",
    ],
    credentialReference: "vault://dfw/jobber",
    ...overrides,
  };
}

Deno.test("connector selection is organization-isolated with no DFW fallback", () => {
  assertEquals(
    selectOrganizationConnector(OREGON, "booking_create", [config()]),
    {
      status: "manual_review",
      code: "connector_missing",
      candidateConnectorIds: [],
    },
  );
});

Deno.test("connector selection requires active configuration", () => {
  assertEquals(
    selectOrganizationConnector(DFW, "booking_create", [
      config({ status: "inactive" }),
    ]),
    {
      status: "manual_review",
      code: "connector_inactive",
      candidateConnectorIds: ["dfw-jobber"],
    },
  );
});

Deno.test("unsupported capability fails closed", () => {
  assertEquals(
    selectOrganizationConnector(DFW, "invoice_handoff", [
      config({ capabilities: ["booking_create"] }),
    ]),
    {
      status: "manual_review",
      code: "capability_unsupported",
      candidateConnectorIds: ["dfw-jobber"],
    },
  );
});

Deno.test("opaque credential reference is required for provider connectors", () => {
  assertEquals(
    selectOrganizationConnector(DFW, "booking_create", [
      config({ credentialReference: null }),
    ]),
    {
      status: "manual_review",
      code: "credential_reference_missing",
      candidateConnectorIds: ["dfw-jobber"],
    },
  );
});

Deno.test("equal-priority connectors are ambiguous rather than guessed", () => {
  assertEquals(
    selectOrganizationConnector(DFW, "booking_create", [
      config(),
      config({ id: "dfw-jobber-duplicate" }),
    ]),
    {
      status: "manual_review",
      code: "connector_ambiguous",
      candidateConnectorIds: ["dfw-jobber", "dfw-jobber-duplicate"],
    },
  );
});

Deno.test("higher priority capable connector resolves deterministically", () => {
  assertEquals(
    selectOrganizationConnector(DFW, "booking_create", [
      config({ id: "low", priority: 10 }),
      config({ id: "high", priority: 20 }),
    ]),
    {
      status: "resolved",
      context: {
        connectorId: "high",
        organizationId: DFW,
        kind: "jobber",
      },
    },
  );
});

function operations(calls: Array<{ operation: string; request: unknown }>) {
  const result = (operation: string, request: unknown) => {
    calls.push({ operation, request });
    return Promise.resolve({ operation, request });
  };
  return {
    health: async (): Promise<ConnectorHealth> => ({
      status: "healthy",
      checkedAt: "2026-07-28T00:00:00.000Z",
    }),
    syncCustomer: (request: unknown) => result("customer_sync", request),
    syncQuote: (request: unknown) => result("quote_sync", request),
    readAvailability: (request: unknown) =>
      result("availability_read", request),
    createBooking: (request: unknown) => result("booking_create", request),
    updateBooking: (request: unknown) => result("booking_update", request),
    cancelBooking: (request: unknown) => result("booking_cancel", request),
    handoffInvoice: (request: unknown) => result("invoice_handoff", request),
    handoffCommunication: (request: unknown) =>
      result("communications_handoff", request),
  };
}

Deno.test("Jobber adapter preserves DFW booking request and result parity", async () => {
  const calls: Array<{ operation: string; request: unknown }> = [];
  const adapter = createJobberConnectorAdapter(
    { connectorId: "dfw-jobber", organizationId: DFW, kind: "jobber" },
    operations(calls),
  );
  const request = {
    organizationId: DFW,
    idempotencyKey: "booking:123",
    bookingRef: "booking-123",
    payload: { scheduledStart: "2026-08-01T14:00:00Z" },
  };
  const response = await adapter.createBooking(request);
  assertEquals(calls, [{ operation: "booking_create", request }]);
  assertEquals(response.status, "ok");
  if (response.status === "ok") {
    assertEquals(response.value, { operation: "booking_create", request });
    assertEquals(response.audit.idempotencyKey, "booking:123");
  }
});

Deno.test("Jobber adapter blocks cross-organization requests before provider call", async () => {
  const calls: Array<{ operation: string; request: unknown }> = [];
  const adapter = createJobberConnectorAdapter(
    { connectorId: "dfw-jobber", organizationId: DFW, kind: "jobber" },
    operations(calls),
  );
  const response = await adapter.createBooking({
    organizationId: OREGON,
    idempotencyKey: "booking:oregon",
    bookingRef: "booking-oregon",
    payload: {},
  });
  assertEquals(calls, []);
  assertEquals(response.status, "manual_review");
  if (response.status === "manual_review") {
    assertEquals(response.code, "organization_lineage_mismatch");
  }
});

Deno.test("Jobber write adapter requires an idempotency key", async () => {
  const calls: Array<{ operation: string; request: unknown }> = [];
  const adapter = createJobberConnectorAdapter(
    { connectorId: "dfw-jobber", organizationId: DFW, kind: "jobber" },
    operations(calls),
  );
  const response = await adapter.syncCustomer({
    organizationId: DFW,
    idempotencyKey: "",
    customerRef: "customer-1",
    payload: {},
  });
  assertEquals(calls, []);
  assertEquals(response.status, "manual_review");
  if (response.status === "manual_review") {
    assertEquals(response.code, "idempotency_key_missing");
  }
});

Deno.test("provider exceptions become recoverable manual review", async () => {
  const calls: Array<{ operation: string; request: unknown }> = [];
  const ops = operations(calls);
  ops.readAvailability = () => {
    throw new Error("provider unavailable");
  };
  const adapter = createJobberConnectorAdapter(
    { connectorId: "dfw-jobber", organizationId: DFW, kind: "jobber" },
    ops,
  );
  const response = await adapter.readAvailability({
    organizationId: DFW,
    serviceKeys: ["window_cleaning"],
    startDate: "2026-08-01",
    endDate: "2026-08-07",
  });
  assertEquals(response.status, "manual_review");
  if (response.status === "manual_review") {
    assertEquals(response.code, "provider_unavailable");
    assertEquals(response.retryable, true);
  }
});

Deno.test("payment destination is organization-specific and never inferred", () => {
  assertEquals(
    resolvePaymentDestination(OREGON, [{
      organizationId: DFW,
      destinationReference: "billing://dfw",
      status: "active",
    }]),
    { status: "manual_review", code: "destination_missing" },
  );
});

Deno.test("all connector capabilities remain explicit", () => {
  const capabilities: ConnectorCapability[] = config().capabilities;
  assertEquals(capabilities.length, 9);
});
