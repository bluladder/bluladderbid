import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type {
  ConnectorCapability,
  ConnectorHealth,
} from "./connectorContracts.ts";
import { createJobTreadConnectorAdapter } from "./jobtreadConnectorAdapter.ts";
import { executeJobTreadPave } from "./jobtreadPaveClient.ts";

const KLAMATH = "b1addf00-0000-4000-8000-000000000003";
const DFW = "b1addf00-0000-4000-8000-000000000001";
const GRANT_SENTINEL = "jobtread-test-redaction-sentinel";

function operations(
  supportedCapabilities: ConnectorCapability[],
  calls: Array<{ operation: string; request?: unknown }>,
) {
  const record = (operation: string, request?: unknown) => {
    calls.push({ operation, request });
    return Promise.resolve({ operation });
  };
  return {
    supportedCapabilities,
    health: async (): Promise<ConnectorHealth> => {
      calls.push({ operation: "health" });
      return {
        status: "healthy",
        checkedAt: "2026-08-14T00:00:00.000Z",
      };
    },
    syncCustomer: (request: unknown) => record("customer_sync", request),
    syncQuote: (request: unknown) => record("quote_sync", request),
    readAvailability: (request: unknown) =>
      record("availability_read", request),
    createBooking: (request: unknown) => record("booking_create", request),
    updateBooking: (request: unknown) => record("booking_update", request),
    cancelBooking: (request: unknown) => record("booking_cancel", request),
    handoffInvoice: (request: unknown) => record("invoice_handoff", request),
    handoffCommunication: (request: unknown) =>
      record("communications_handoff", request),
  };
}

function adapter(
  supportedCapabilities: ConnectorCapability[],
  calls: Array<{ operation: string; request?: unknown }>,
) {
  return createJobTreadConnectorAdapter(
    {
      connectorId: "klamath-jobtread",
      organizationId: KLAMATH,
      kind: "jobtread",
    },
    operations(supportedCapabilities, calls),
  );
}

Deno.test("JobTread adapter requires a JobTread context", async () => {
  await assertRejects(
    async () => {
      createJobTreadConnectorAdapter(
        { connectorId: "wrong", organizationId: KLAMATH, kind: "jobber" },
        operations(["health"], []),
      );
    },
    Error,
    "jobtread_connector_context_required",
  );
});

Deno.test("JobTread adapter blocks cross-organization calls before provider access", async () => {
  const calls: Array<{ operation: string; request?: unknown }> = [];
  const result = await adapter(["customer_sync"], calls).syncCustomer({
    organizationId: DFW,
    idempotencyKey: "customer:one",
    customerRef: "customer-one",
    payload: {},
  });
  assertEquals(calls, []);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "organization_lineage_mismatch");
  }
});

Deno.test("JobTread adapter requires write idempotency before capability evaluation", async () => {
  const calls: Array<{ operation: string; request?: unknown }> = [];
  const result = await adapter([], calls).syncCustomer({
    organizationId: KLAMATH,
    idempotencyKey: " ",
    customerRef: "customer-one",
    payload: {},
  });
  assertEquals(calls, []);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "idempotency_key_missing");
  }
});

Deno.test("unapproved JobTread business mappings fail closed without provider access", async () => {
  const calls: Array<{ operation: string; request?: unknown }> = [];
  const result = await adapter(["health", "customer_sync"], calls)
    .createBooking({
      organizationId: KLAMATH,
      idempotencyKey: "booking:one",
      bookingRef: "booking-one",
      payload: {},
    });
  assertEquals(calls, []);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "capability_unsupported");
    assertEquals(result.retryable, false);
  }
});

Deno.test("approved JobTread capability preserves request and audit lineage", async () => {
  const calls: Array<{ operation: string; request?: unknown }> = [];
  const request = {
    organizationId: KLAMATH,
    idempotencyKey: "customer:one",
    customerRef: "customer-one",
    payload: { name: "sanitized" },
  };
  const result = await adapter(["health", "customer_sync"], calls)
    .syncCustomer(request);
  assertEquals(calls, [{ operation: "customer_sync", request }]);
  assertEquals(result.status, "ok");
  if (result.status === "ok") {
    assertEquals(result.audit.organizationId, KLAMATH);
    assertEquals(result.audit.idempotencyKey, "customer:one");
  }
});

Deno.test("provider exceptions are redacted recoverable manual review", async () => {
  const calls: Array<{ operation: string; request?: unknown }> = [];
  const ops = operations(["health"], calls);
  ops.health = () => {
    throw new Error(`provider leaked ${GRANT_SENTINEL}`);
  };
  const connector = createJobTreadConnectorAdapter(
    {
      connectorId: "klamath-jobtread",
      organizationId: KLAMATH,
      kind: "jobtread",
    },
    ops,
  );
  const result = await connector.health();
  assertEquals(result.status, "manual_review");
  assertEquals(JSON.stringify(result).includes(GRANT_SENTINEL), false);
  if (result.status === "manual_review") {
    assertEquals(result.code, "provider_unavailable");
    assertEquals(result.retryable, true);
  }
});

Deno.test("Pave transport injects grant only in the protected request body", async () => {
  let observedUrl = "";
  let observedHeaders: HeadersInit | undefined;
  let observedBody = "";
  const result = await executeJobTreadPave<{ version: string }>({
    grantKey: GRANT_SENTINEL,
    query: { version: {} },
    fetchImpl: (url, init) => {
      observedUrl = String(url);
      observedHeaders = init?.headers;
      observedBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ version: "verified" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  });
  assertEquals(observedUrl, "https://api.jobtread.com/pave");
  assertEquals(JSON.stringify(observedHeaders).includes(GRANT_SENTINEL), false);
  const requestBody = JSON.parse(observedBody);
  assertEquals(requestBody.query.$.grantKey, GRANT_SENTINEL);
  assertEquals(requestBody.query.version, {});
  assertEquals(result, {
    status: "ok",
    data: { version: "verified" },
    httpStatus: 200,
  });
});

Deno.test("Pave transport rejects grant injection in a caller query", async () => {
  let called = false;
  const result = await executeJobTreadPave({
    grantKey: GRANT_SENTINEL,
    query: { nested: { grantKey: "caller-controlled" } },
    fetchImpl: () => {
      called = true;
      return Promise.resolve(new Response("{}"));
    },
  });
  assertEquals(called, false);
  assertEquals(result.status, "error");
  if (result.status === "error") assertEquals(result.code, "invalid_query");
});

Deno.test("Pave transport fails closed before fetch when credential is absent", async () => {
  let called = false;
  const result = await executeJobTreadPave({
    grantKey: " ",
    query: { version: {} },
    fetchImpl: () => {
      called = true;
      return Promise.resolve(new Response("{}"));
    },
  });
  assertEquals(called, false);
  assertEquals(result, {
    status: "error",
    code: "credential_missing",
    retryable: false,
    outcomeUncertain: false,
    httpStatus: null,
  });
});

Deno.test("Pave transport never returns provider error text or grant material", async () => {
  const result = await executeJobTreadPave({
    grantKey: GRANT_SENTINEL,
    query: { version: {} },
    fetchImpl: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ errors: [{ message: `bad ${GRANT_SENTINEL}` }] }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
  });
  assertEquals(result.status, "error");
  assertEquals(JSON.stringify(result).includes(GRANT_SENTINEL), false);
  if (result.status === "error") {
    assertEquals(result.code, "provider_rejected");
    assertEquals(result.outcomeUncertain, false);
  }
});

Deno.test("Pave mutation transport failures remain outcome-uncertain and un-retried", async () => {
  let attempts = 0;
  const result = await executeJobTreadPave({
    grantKey: GRANT_SENTINEL,
    query: { createAccount: { $: { name: "sanitized" } } },
    mutation: true,
    fetchImpl: () => {
      attempts += 1;
      return Promise.reject(new Error(`network ${GRANT_SENTINEL}`));
    },
  });
  assertEquals(attempts, 1);
  assertEquals(result, {
    status: "error",
    code: "transport_error",
    retryable: true,
    outcomeUncertain: true,
    httpStatus: null,
  });
});

Deno.test("malformed successful mutation response is outcome-uncertain", async () => {
  const result = await executeJobTreadPave({
    grantKey: GRANT_SENTINEL,
    query: { createAccount: { $: { name: "sanitized" } } },
    mutation: true,
    fetchImpl: () => Promise.resolve(new Response("not-json", { status: 200 })),
  });
  assertEquals(result.status, "error");
  if (result.status === "error") {
    assertEquals(result.code, "malformed_response");
    assertEquals(result.outcomeUncertain, true);
  }
});
