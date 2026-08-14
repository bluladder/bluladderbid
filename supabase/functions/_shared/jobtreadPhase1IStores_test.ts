// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createJobTreadPhase1IStores,
  JOBTREAD_ATTEMPT_SELECT,
  JOBTREAD_ATTEMPT_TABLE,
  JOBTREAD_CONNECTOR_SELECT,
  JOBTREAD_CONNECTOR_TABLE,
  JobTreadPhase1IStoreError,
} from "./jobtreadPhase1IStores.ts";

const ORGANIZATION = "b1addf00-0000-4000-8000-000000000003";
const OTHER_ORGANIZATION = "b1addf00-0000-4000-8000-000000000001";
const CONNECTOR = "c1addf00-0000-4000-8000-000000000003";
const ATTEMPT = "a1addf00-0000-4000-8000-000000000003";
const IDEMPOTENCY_HASH = "a".repeat(64);
const REQUEST_FINGERPRINT = "b".repeat(64);
const PROVIDER_REFERENCE_HASH = "c".repeat(64);
const ERROR_SENTINEL = "raw-postgrest-error-must-not-escape";
const STARTED_AT = "2026-08-14T13:00:00.000Z";
const COMPLETED_AT = "2026-08-14T13:01:00.000Z";

interface RecordedQuery {
  table: string;
  action: "select" | "insert" | "update";
  payload?: unknown;
  columns?: string;
  filters: Array<["eq" | "is", string, unknown]>;
  limit?: number;
  terminal: "await" | "maybeSingle" | null;
}

interface ScriptedResponse {
  data: unknown;
  error: unknown;
  reject?: unknown;
}

class Query {
  readonly record: RecordedQuery;

  constructor(
    private readonly response: ScriptedResponse,
    table: string,
    action: RecordedQuery["action"],
    payload?: unknown,
  ) {
    this.record = {
      table,
      action,
      payload,
      filters: [],
      terminal: null,
    };
  }

  select(columns: string) {
    this.record.columns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.record.filters.push(["eq", column, value]);
    return this;
  }

  is(column: string, value: unknown) {
    this.record.filters.push(["is", column, value]);
    return this;
  }

  limit(value: number) {
    this.record.limit = value;
    return this;
  }

  maybeSingle() {
    this.record.terminal = "maybeSingle";
    if (this.response.reject) return Promise.reject(this.response.reject);
    return Promise.resolve(this.response);
  }

  then(
    resolve: (value: ScriptedResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) {
    this.record.terminal = "await";
    if (this.response.reject) {
      return Promise.reject(this.response.reject).then(resolve, reject);
    }
    return Promise.resolve(this.response).then(resolve);
  }
}

function fakeSupabase(responses: ScriptedResponse[]) {
  const calls: RecordedQuery[] = [];
  let index = 0;
  const next = (
    table: string,
    action: RecordedQuery["action"],
    payload?: unknown,
  ) => {
    const response = responses[index++];
    if (!response) throw new Error("missing_scripted_response");
    const query = new Query(response, table, action, payload);
    calls.push(query.record);
    return query;
  };
  return {
    calls,
    client: {
      from(table: string) {
        return {
          select: (columns: string) => next(table, "select").select(columns),
          insert: (payload: unknown) => next(table, "insert", payload),
          update: (payload: unknown) => next(table, "update", payload),
        };
      },
    },
  };
}

function connectorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTOR,
    organization_id: ORGANIZATION,
    provider: "jobtread",
    status: "active",
    capabilities: ["customer_sync", "booking_create"],
    credential_reference: "protected/jobtread/klamath/grant",
    provider_organization_fingerprint: "d".repeat(64),
    configuration_version: 3,
    runtime_enabled: true,
    ...overrides,
  };
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT,
    organization_id: ORGANIZATION,
    connector_id: CONNECTOR,
    operation: "booking_create",
    idempotency_key_hash: IDEMPOTENCY_HASH,
    request_fingerprint: REQUEST_FINGERPRINT,
    attempt_number: 1,
    status: "started",
    failure_code: null,
    outcome_uncertain: false,
    provider_reference_hash: null,
    started_at: STARTED_AT,
    completed_at: null,
    ...overrides,
  };
}

function claim() {
  return {
    organizationId: ORGANIZATION,
    connectorId: CONNECTOR,
    operation: "booking_create" as const,
    idempotencyKeyHash: IDEMPOTENCY_HASH,
    requestFingerprint: REQUEST_FINGERPRINT,
    attemptNumber: 1 as const,
  };
}

function assertStoreError(error: unknown, code: string) {
  if (!(error instanceof Error)) throw new Error("expected_store_error");
  assertEquals(error instanceof JobTreadPhase1IStoreError, true);
  assertEquals(error.message, code);
  assertEquals(error.message.includes(ERROR_SENTINEL), false);
}

Deno.test("Phase 1I connector store uses the exact bounded organization query", async () => {
  const fake = fakeSupabase([{ data: [connectorRow()], error: null }]);
  const stores = createJobTreadPhase1IStores(fake.client);
  const rows = await stores.connectors.listForOrganization(ORGANIZATION);

  assertEquals(rows, [{
    id: CONNECTOR,
    organizationId: ORGANIZATION,
    provider: "jobtread",
    status: "active",
    capabilities: ["customer_sync", "booking_create"],
    credentialReference: "protected/jobtread/klamath/grant",
    providerOrganizationFingerprint: "d".repeat(64),
    configurationVersion: 3,
    runtimeEnabled: true,
  }]);
  assertEquals(fake.calls, [{
    table: JOBTREAD_CONNECTOR_TABLE,
    action: "select",
    payload: undefined,
    columns: JOBTREAD_CONNECTOR_SELECT,
    filters: [
      ["eq", "organization_id", ORGANIZATION],
      ["eq", "provider", "jobtread"],
    ],
    limit: 2,
    terminal: "await",
  }]);
});

Deno.test("Phase 1I connector store rejects malformed or unavailable rows with fixed errors", async () => {
  const unavailable = fakeSupabase([{
    data: null,
    error: { message: ERROR_SENTINEL },
  }]);
  const unavailableError = await assertRejects(
    () =>
      createJobTreadPhase1IStores(unavailable.client).connectors
        .listForOrganization(ORGANIZATION),
  );
  assertStoreError(unavailableError, "connector_lookup_unavailable");

  const malformed = fakeSupabase([{
    data: [connectorRow({ credential_reference: "" })],
    error: null,
  }]);
  const malformedError = await assertRejects(
    () =>
      createJobTreadPhase1IStores(malformed.client).connectors
        .listForOrganization(ORGANIZATION),
  );
  assertStoreError(malformedError, "connector_row_invalid");
  assertEquals(
    await createJobTreadPhase1IStores(fakeSupabase([]).client).connectors
      .listForOrganization("not-a-uuid"),
    [],
  );
});

Deno.test("Phase 1I attempt store grants ownership only after the direct insert returns the exact started row", async () => {
  const fake = fakeSupabase([{ data: attemptRow(), error: null }]);
  const result = await createJobTreadPhase1IStores(fake.client).attempts.claim(
    claim(),
  );
  assertEquals(result, { status: "claimed", attemptId: ATTEMPT });
  assertEquals(fake.calls, [{
    table: JOBTREAD_ATTEMPT_TABLE,
    action: "insert",
    payload: {
      organization_id: ORGANIZATION,
      connector_id: CONNECTOR,
      operation: "booking_create",
      idempotency_key_hash: IDEMPOTENCY_HASH,
      request_fingerprint: REQUEST_FINGERPRINT,
      attempt_number: 1,
      status: "started",
      outcome_uncertain: false,
    },
    columns: JOBTREAD_ATTEMPT_SELECT,
    filters: [],
    terminal: "maybeSingle",
  }]);
});

Deno.test("Phase 1I claim recovery never converts ambiguity into mutation ownership", async () => {
  for (
    const [row, expected] of [
      [attemptRow(), "in_progress"],
      [
        attemptRow({
          status: "succeeded",
          provider_reference_hash: PROVIDER_REFERENCE_HASH,
          completed_at: COMPLETED_AT,
        }),
        "duplicate",
      ],
      [attemptRow({ request_fingerprint: "e".repeat(64) }), "conflict"],
    ] as const
  ) {
    const fake = fakeSupabase([
      { data: null, error: { message: ERROR_SENTINEL } },
      { data: [row], error: null },
    ]);
    const result = await createJobTreadPhase1IStores(fake.client).attempts
      .claim(claim());
    assertEquals(result, { status: expected });
    assertEquals(fake.calls.length, 2);
    assertEquals(fake.calls[1], {
      table: JOBTREAD_ATTEMPT_TABLE,
      action: "select",
      payload: undefined,
      columns: JOBTREAD_ATTEMPT_SELECT,
      filters: [
        ["eq", "organization_id", ORGANIZATION],
        ["eq", "connector_id", CONNECTOR],
        ["eq", "operation", "booking_create"],
        ["eq", "idempotency_key_hash", IDEMPOTENCY_HASH],
        ["eq", "attempt_number", 1],
      ],
      limit: 2,
      terminal: "await",
    });
  }
});

Deno.test("Phase 1I claim fails closed when ambiguous insert cannot be reconciled exactly", async () => {
  for (
    const recovery of [
      { data: [], error: null },
      { data: [attemptRow(), attemptRow()], error: null },
      { data: null, error: { message: ERROR_SENTINEL } },
    ]
  ) {
    const fake = fakeSupabase([
      { data: null, error: { message: ERROR_SENTINEL } },
      recovery,
    ]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IStores(fake.client).attempts.claim(claim())
    );
    assertStoreError(error, "attempt_claim_unavailable");
  }
});

Deno.test("Phase 1I claim validates all returned ownership fields", async () => {
  for (
    const badRow of [
      attemptRow({ organization_id: OTHER_ORGANIZATION }),
      attemptRow({ attempt_number: 2 }),
      attemptRow({ outcome_uncertain: true }),
      attemptRow({ provider_reference_hash: PROVIDER_REFERENCE_HASH }),
    ]
  ) {
    const fake = fakeSupabase([{ data: badRow, error: null }]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IStores(fake.client).attempts.claim(claim())
    );
    assertStoreError(error, "attempt_row_invalid");
  }
});

Deno.test("Phase 1I success completion is a started-only conditional transition", async () => {
  const succeeded = attemptRow({
    status: "succeeded",
    provider_reference_hash: PROVIDER_REFERENCE_HASH,
    completed_at: COMPLETED_AT,
  });
  const fake = fakeSupabase([{ data: succeeded, error: null }]);
  await createJobTreadPhase1IStores(fake.client, { now: () => COMPLETED_AT })
    .attempts.completeSucceeded({
      attemptId: ATTEMPT,
      providerReferenceHash: PROVIDER_REFERENCE_HASH,
    });
  assertEquals(fake.calls, [{
    table: JOBTREAD_ATTEMPT_TABLE,
    action: "update",
    payload: {
      status: "succeeded",
      failure_code: null,
      outcome_uncertain: false,
      provider_reference_hash: PROVIDER_REFERENCE_HASH,
      completed_at: COMPLETED_AT,
    },
    columns: JOBTREAD_ATTEMPT_SELECT,
    filters: [
      ["eq", "id", ATTEMPT],
      ["eq", "status", "started"],
      ["is", "completed_at", null],
    ],
    terminal: "maybeSingle",
  }]);
});

Deno.test("Phase 1I manual-review completion enforces the approved uncertainty boundary", async () => {
  const manual = attemptRow({
    status: "manual_review",
    failure_code: "provider_unavailable",
    outcome_uncertain: true,
    completed_at: COMPLETED_AT,
  });
  const fake = fakeSupabase([{ data: manual, error: null }]);
  await createJobTreadPhase1IStores(fake.client, { now: () => COMPLETED_AT })
    .attempts.completeManualReview({
      attemptId: ATTEMPT,
      failureCode: "provider_unavailable",
      outcomeUncertain: true,
    });
  assertEquals(fake.calls[0].filters, [
    ["eq", "id", ATTEMPT],
    ["eq", "status", "started"],
    ["is", "completed_at", null],
  ]);

  const invalid = createJobTreadPhase1IStores(fakeSupabase([]).client)
    .attempts.completeManualReview({
      attemptId: ATTEMPT,
      failureCode: "provider_rejected",
      outcomeUncertain: true,
    });
  const error = await assertRejects(() => invalid);
  assertStoreError(error, "attempt_transition_invalid");
});

Deno.test("Phase 1I terminal transitions reject stale, malformed, and raw PostgREST failures", async () => {
  for (
    const response of [
      { data: null, error: null },
      { data: null, error: { message: ERROR_SENTINEL } },
    ]
  ) {
    const fake = fakeSupabase([response]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IStores(fake.client, { now: () => COMPLETED_AT })
        .attempts.completeSucceeded({
          attemptId: ATTEMPT,
          providerReferenceHash: null,
        })
    );
    assertStoreError(error, "attempt_transition_unavailable");
  }

  const malformed = fakeSupabase([{
    data: attemptRow({
      status: "succeeded",
      completed_at: COMPLETED_AT,
      provider_reference_hash: "not-a-hash",
    }),
    error: null,
  }]);
  const error = await assertRejects(() =>
    createJobTreadPhase1IStores(malformed.client, { now: () => COMPLETED_AT })
      .attempts.completeSucceeded({
        attemptId: ATTEMPT,
        providerReferenceHash: PROVIDER_REFERENCE_HASH,
      })
  );
  assertStoreError(error, "attempt_row_invalid");
});

Deno.test("Phase 1I reconciliation is read-only, bounded, and sanitized", async () => {
  const fake = fakeSupabase([{
    data: [attemptRow({
      status: "manual_review",
      failure_code: "retry_exhausted",
      outcome_uncertain: true,
      completed_at: COMPLETED_AT,
    })],
    error: null,
  }]);
  const result = await createJobTreadPhase1IStores(fake.client).reconciliation
    .reconcile({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      operation: "booking_create",
      idempotencyKeyHash: IDEMPOTENCY_HASH,
    });
  assertEquals(result, {
    status: "manual_review",
    failureCode: "retry_exhausted",
    outcomeUncertain: true,
    providerReferenceHash: null,
    requestFingerprint: REQUEST_FINGERPRINT,
  });
  assertEquals(fake.calls[0].action, "select");
  assertEquals(fake.calls[0].limit, 2);

  const missing = fakeSupabase([{ data: [], error: null }]);
  assertEquals(
    await createJobTreadPhase1IStores(missing.client).reconciliation.reconcile({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      operation: "booking_create",
      idempotencyKeyHash: IDEMPOTENCY_HASH,
    }),
    { status: "missing" },
  );
});

Deno.test("Phase 1I reconciliation rejects ambiguity, cross-organization rows, and raw errors", async () => {
  for (
    const response of [
      { data: [attemptRow(), attemptRow()], error: null },
      { data: null, error: { message: ERROR_SENTINEL } },
    ]
  ) {
    const fake = fakeSupabase([response]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IStores(fake.client).reconciliation.reconcile({
        organizationId: ORGANIZATION,
        connectorId: CONNECTOR,
        operation: "booking_create",
        idempotencyKeyHash: IDEMPOTENCY_HASH,
      })
    );
    assertStoreError(error, "attempt_reconciliation_unavailable");
  }

  const crossOrg = fakeSupabase([{
    data: [attemptRow({ organization_id: OTHER_ORGANIZATION })],
    error: null,
  }]);
  const error = await assertRejects(() =>
    createJobTreadPhase1IStores(crossOrg.client).reconciliation.reconcile({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      operation: "booking_create",
      idempotencyKeyHash: IDEMPOTENCY_HASH,
    })
  );
  assertStoreError(error, "attempt_row_invalid");
});

Deno.test("Phase 1I stores redact thrown PostgREST failures at every boundary", async () => {
  const rejected = {
    data: null,
    error: null,
    reject: new Error(ERROR_SENTINEL),
  };

  const connectorError = await assertRejects(() =>
    createJobTreadPhase1IStores(fakeSupabase([rejected]).client).connectors
      .listForOrganization(ORGANIZATION)
  );
  assertStoreError(connectorError, "connector_lookup_unavailable");

  const claimError = await assertRejects(() =>
    createJobTreadPhase1IStores(fakeSupabase([rejected, rejected]).client)
      .attempts.claim(claim())
  );
  assertStoreError(claimError, "attempt_claim_unavailable");

  const transitionError = await assertRejects(() =>
    createJobTreadPhase1IStores(fakeSupabase([rejected]).client, {
      now: () => COMPLETED_AT,
    }).attempts.completeSucceeded({
      attemptId: ATTEMPT,
      providerReferenceHash: null,
    })
  );
  assertStoreError(transitionError, "attempt_transition_unavailable");

  const reconciliationError = await assertRejects(() =>
    createJobTreadPhase1IStores(fakeSupabase([rejected]).client).reconciliation
      .reconcile({
        organizationId: ORGANIZATION,
        connectorId: CONNECTOR,
        operation: "booking_create",
        idempotencyKeyHash: IDEMPOTENCY_HASH,
      })
  );
  assertStoreError(
    reconciliationError,
    "attempt_reconciliation_unavailable",
  );
});
