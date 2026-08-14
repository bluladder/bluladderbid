// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createJobTreadPhase1IWebhookReceiptStore,
  JOBTREAD_WEBHOOK_RECEIPT_SELECT,
  JOBTREAD_WEBHOOK_RECEIPT_TABLE,
  type JobTreadWebhookReceiptClaim,
  JobTreadWebhookReceiptStoreError,
} from "./jobtreadPhase1IWebhookReceipts.ts";

const ORGANIZATION = "b1addf00-0000-4000-8000-000000000003";
const OTHER_ORGANIZATION = "b1addf00-0000-4000-8000-000000000001";
const CONNECTOR = "c1addf00-0000-4000-8000-000000000003";
const RECEIPT = "e1addf00-0000-4000-8000-000000000003";
const EVENT_HASH = "a".repeat(64);
const PAYLOAD_FINGERPRINT = "b".repeat(64);
const ERROR_SENTINEL = "raw-receipt-error-must-not-escape";
const OCCURRED_AT = "2026-08-14T13:00:00.000Z";
const RECEIVED_AT = "2026-08-14T13:00:01.000Z";
const PROCESSED_AT = "2026-08-14T13:00:02.000Z";

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

function receiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECEIPT,
    organization_id: ORGANIZATION,
    connector_id: CONNECTOR,
    provider_event_hash: EVENT_HASH,
    event_type: "job.updated",
    payload_fingerprint: PAYLOAD_FINGERPRINT,
    source_authenticated: true,
    status: "accepted",
    failure_code: null,
    occurred_at: OCCURRED_AT,
    received_at: RECEIVED_AT,
    processed_at: null,
    ...overrides,
  };
}

function claim(
  overrides: Partial<JobTreadWebhookReceiptClaim> = {},
): JobTreadWebhookReceiptClaim {
  return {
    organizationId: ORGANIZATION,
    connectorId: CONNECTOR,
    providerEventHash: EVENT_HASH,
    eventType: "job.updated",
    payloadFingerprint: PAYLOAD_FINGERPRINT,
    sourceAuthenticated: true,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function assertStoreError(error: unknown, code: string) {
  if (!(error instanceof Error)) throw new Error("expected_store_error");
  assertEquals(error instanceof JobTreadWebhookReceiptStoreError, true);
  assertEquals(error.message, code);
  assertEquals(error.message.includes(ERROR_SENTINEL), false);
}

Deno.test("Phase 1I receipt claim owns processing only after the exact direct insert", async () => {
  const fake = fakeSupabase([{ data: receiptRow(), error: null }]);
  const result = await createJobTreadPhase1IWebhookReceiptStore(fake.client)
    .claim(claim());
  assertEquals(result, { status: "claimed", receiptId: RECEIPT });
  assertEquals(fake.calls, [{
    table: JOBTREAD_WEBHOOK_RECEIPT_TABLE,
    action: "insert",
    payload: {
      organization_id: ORGANIZATION,
      connector_id: CONNECTOR,
      provider_event_hash: EVENT_HASH,
      event_type: "job.updated",
      payload_fingerprint: PAYLOAD_FINGERPRINT,
      source_authenticated: true,
      status: "accepted",
      occurred_at: OCCURRED_AT,
    },
    columns: JOBTREAD_WEBHOOK_RECEIPT_SELECT,
    filters: [],
    terminal: "maybeSingle",
  }]);
});

Deno.test("Phase 1I receipt claim normalizes only bounded non-secret metadata", async () => {
  const fake = fakeSupabase([{ data: receiptRow(), error: null }]);
  const result = await createJobTreadPhase1IWebhookReceiptStore(fake.client)
    .claim(claim({
      eventType: "  job.updated  ",
      occurredAt: "2026-08-14T13:00:00Z",
    }));
  assertEquals(result.status, "claimed");
  assertEquals(fake.calls[0].payload, {
    organization_id: ORGANIZATION,
    connector_id: CONNECTOR,
    provider_event_hash: EVENT_HASH,
    event_type: "job.updated",
    payload_fingerprint: PAYLOAD_FINGERPRINT,
    source_authenticated: true,
    status: "accepted",
    occurred_at: OCCURRED_AT,
  });
});

Deno.test("Phase 1I receipt claim rejects unauthenticated or malformed authority before storage", async () => {
  for (
    const invalid of [
      claim({ organizationId: "not-a-uuid" }),
      claim({ providerEventHash: "not-a-hash" }),
      claim({ eventType: " " }),
      claim({ eventType: "x".repeat(129) }),
      claim({ occurredAt: "not-a-time" }),
      { ...claim(), sourceAuthenticated: false },
    ]
  ) {
    const fake = fakeSupabase([]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IWebhookReceiptStore(fake.client).claim(
        invalid as JobTreadWebhookReceiptClaim,
      )
    );
    assertStoreError(error, "receipt_claim_invalid");
    assertEquals(fake.calls, []);
  }
});

Deno.test("Phase 1I receipt recovery never turns an ambiguous insert into processing ownership", async () => {
  for (
    const [row, expected] of [
      [receiptRow(), "in_progress"],
      [
        receiptRow({ status: "processed", processed_at: PROCESSED_AT }),
        "duplicate",
      ],
      [receiptRow({ payload_fingerprint: "c".repeat(64) }), "conflict"],
      [receiptRow({ event_type: "task.updated" }), "conflict"],
      [receiptRow({ occurred_at: null }), "conflict"],
    ] as const
  ) {
    const fake = fakeSupabase([
      { data: null, error: { message: ERROR_SENTINEL } },
      { data: [row], error: null },
    ]);
    const result = await createJobTreadPhase1IWebhookReceiptStore(fake.client)
      .claim(claim());
    assertEquals(result, { status: expected });
    assertEquals(fake.calls[1], {
      table: JOBTREAD_WEBHOOK_RECEIPT_TABLE,
      action: "select",
      payload: undefined,
      columns: JOBTREAD_WEBHOOK_RECEIPT_SELECT,
      filters: [
        ["eq", "organization_id", ORGANIZATION],
        ["eq", "connector_id", CONNECTOR],
        ["eq", "provider_event_hash", EVENT_HASH],
      ],
      limit: 2,
      terminal: "await",
    });
  }
});

Deno.test("Phase 1I receipt recovery fails closed when an ambiguous insert has no exact row", async () => {
  for (
    const recovery of [
      { data: [], error: null },
      { data: [receiptRow(), receiptRow()], error: null },
      { data: null, error: { message: ERROR_SENTINEL } },
    ]
  ) {
    const fake = fakeSupabase([
      { data: null, error: { message: ERROR_SENTINEL } },
      recovery,
    ]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IWebhookReceiptStore(fake.client).claim(claim())
    );
    assertStoreError(error, "receipt_claim_unavailable");
  }
});

Deno.test("Phase 1I receipt claim validates every returned ownership field", async () => {
  for (
    const row of [
      receiptRow({ organization_id: OTHER_ORGANIZATION }),
      receiptRow({ source_authenticated: false }),
      receiptRow({ status: "processed", processed_at: PROCESSED_AT }),
      receiptRow({ event_type: " job.updated " }),
      receiptRow({ received_at: "bad-time" }),
    ]
  ) {
    const fake = fakeSupabase([{ data: row, error: null }]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IWebhookReceiptStore(fake.client).claim(claim())
    );
    assertStoreError(error, "receipt_row_invalid");
  }
});

Deno.test("Phase 1I processed and ignored completions use accepted-only conditional transitions", async () => {
  for (const status of ["processed", "ignored"] as const) {
    const fake = fakeSupabase([{
      data: receiptRow({
        status,
        processed_at: PROCESSED_AT,
      }),
      error: null,
    }]);
    const store = createJobTreadPhase1IWebhookReceiptStore(fake.client, {
      now: () => PROCESSED_AT,
    });
    if (status === "processed") {
      await store.completeProcessed({
        organizationId: ORGANIZATION,
        connectorId: CONNECTOR,
        receiptId: RECEIPT,
      });
    } else {
      await store.completeIgnored({
        organizationId: ORGANIZATION,
        connectorId: CONNECTOR,
        receiptId: RECEIPT,
      });
    }
    assertEquals(fake.calls[0], {
      table: JOBTREAD_WEBHOOK_RECEIPT_TABLE,
      action: "update",
      payload: {
        status,
        failure_code: null,
        processed_at: PROCESSED_AT,
      },
      columns: JOBTREAD_WEBHOOK_RECEIPT_SELECT,
      filters: [
        ["eq", "organization_id", ORGANIZATION],
        ["eq", "connector_id", CONNECTOR],
        ["eq", "id", RECEIPT],
        ["eq", "status", "accepted"],
        ["is", "processed_at", null],
      ],
      terminal: "maybeSingle",
    });
  }
});

Deno.test("Phase 1I manual-review completion admits only schema-approved failure codes", async () => {
  const fake = fakeSupabase([{
    data: receiptRow({
      status: "manual_review",
      failure_code: "provider_rejected",
      processed_at: PROCESSED_AT,
    }),
    error: null,
  }]);
  await createJobTreadPhase1IWebhookReceiptStore(fake.client, {
    now: () => PROCESSED_AT,
  }).completeManualReview({
    organizationId: ORGANIZATION,
    connectorId: CONNECTOR,
    receiptId: RECEIPT,
    failureCode: "provider_rejected",
  });
  assertEquals(fake.calls[0].payload, {
    status: "manual_review",
    failure_code: "provider_rejected",
    processed_at: PROCESSED_AT,
  });

  const error = await assertRejects(() =>
    createJobTreadPhase1IWebhookReceiptStore(fakeSupabase([]).client)
      .completeManualReview({
        organizationId: ORGANIZATION,
        connectorId: CONNECTOR,
        receiptId: RECEIPT,
        failureCode: "retry_exhausted" as "provider_rejected",
      })
  );
  assertStoreError(error, "receipt_transition_invalid");
});

Deno.test("Phase 1I receipt transitions reject stale, malformed, and raw PostgREST failures", async () => {
  for (
    const response of [
      { data: null, error: null },
      { data: null, error: { message: ERROR_SENTINEL } },
      { data: null, error: null, reject: new Error(ERROR_SENTINEL) },
    ]
  ) {
    const fake = fakeSupabase([response]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IWebhookReceiptStore(fake.client, {
        now: () => PROCESSED_AT,
      }).completeProcessed({
        organizationId: ORGANIZATION,
        connectorId: CONNECTOR,
        receiptId: RECEIPT,
      })
    );
    assertStoreError(error, "receipt_transition_unavailable");
  }

  const malformed = fakeSupabase([{
    data: receiptRow({
      status: "processed",
      processed_at: "bad-time",
    }),
    error: null,
  }]);
  const error = await assertRejects(() =>
    createJobTreadPhase1IWebhookReceiptStore(malformed.client, {
      now: () => PROCESSED_AT,
    }).completeProcessed({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      receiptId: RECEIPT,
    })
  );
  assertStoreError(error, "receipt_row_invalid");

  const crossOrg = fakeSupabase([{
    data: receiptRow({
      organization_id: OTHER_ORGANIZATION,
      status: "processed",
      processed_at: PROCESSED_AT,
    }),
    error: null,
  }]);
  const crossOrgError = await assertRejects(() =>
    createJobTreadPhase1IWebhookReceiptStore(crossOrg.client, {
      now: () => PROCESSED_AT,
    }).completeProcessed({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      receiptId: RECEIPT,
    })
  );
  assertStoreError(crossOrgError, "receipt_transition_invalid");

  const invalidIdentity = fakeSupabase([]);
  const invalidIdentityError = await assertRejects(() =>
    createJobTreadPhase1IWebhookReceiptStore(invalidIdentity.client, {
      now: () => PROCESSED_AT,
    }).completeProcessed({
      organizationId: "not-a-uuid",
      connectorId: CONNECTOR,
      receiptId: RECEIPT,
    })
  );
  assertStoreError(invalidIdentityError, "receipt_transition_invalid");
  assertEquals(invalidIdentity.calls, []);
});

Deno.test("Phase 1I receipt reconciliation is read-only, bounded, and sanitized", async () => {
  const fake = fakeSupabase([{
    data: [receiptRow({
      status: "manual_review",
      failure_code: "provider_unavailable",
      processed_at: PROCESSED_AT,
    })],
    error: null,
  }]);
  const result = await createJobTreadPhase1IWebhookReceiptStore(fake.client)
    .reconcile({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      providerEventHash: EVENT_HASH,
    });
  assertEquals(result, {
    status: "manual_review",
    eventType: "job.updated",
    payloadFingerprint: PAYLOAD_FINGERPRINT,
    sourceAuthenticated: true,
    failureCode: "provider_unavailable",
    occurredAt: OCCURRED_AT,
    receivedAt: RECEIVED_AT,
    processedAt: PROCESSED_AT,
  });
  assertEquals(fake.calls[0].action, "select");
  assertEquals(fake.calls[0].limit, 2);

  const missing = fakeSupabase([{ data: [], error: null }]);
  assertEquals(
    await createJobTreadPhase1IWebhookReceiptStore(missing.client).reconcile({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      providerEventHash: EVENT_HASH,
    }),
    { status: "missing" },
  );
});

Deno.test("Phase 1I receipt reconciliation rejects ambiguity and cross-organization rows", async () => {
  for (
    const response of [
      { data: [receiptRow(), receiptRow()], error: null },
      { data: null, error: { message: ERROR_SENTINEL } },
      { data: null, error: null, reject: new Error(ERROR_SENTINEL) },
    ]
  ) {
    const fake = fakeSupabase([response]);
    const error = await assertRejects(() =>
      createJobTreadPhase1IWebhookReceiptStore(fake.client).reconcile({
        organizationId: ORGANIZATION,
        connectorId: CONNECTOR,
        providerEventHash: EVENT_HASH,
      })
    );
    assertStoreError(error, "receipt_reconciliation_unavailable");
  }

  const crossOrg = fakeSupabase([{
    data: [receiptRow({ organization_id: OTHER_ORGANIZATION })],
    error: null,
  }]);
  const error = await assertRejects(() =>
    createJobTreadPhase1IWebhookReceiptStore(crossOrg.client).reconcile({
      organizationId: ORGANIZATION,
      connectorId: CONNECTOR,
      providerEventHash: EVENT_HASH,
    })
  );
  assertStoreError(error, "receipt_row_invalid");
});

Deno.test("Phase 1I receipt store redacts thrown insert and recovery failures", async () => {
  const rejected = {
    data: null,
    error: null,
    reject: new Error(ERROR_SENTINEL),
  };
  const error = await assertRejects(() =>
    createJobTreadPhase1IWebhookReceiptStore(
      fakeSupabase([rejected, rejected]).client,
    ).claim(claim())
  );
  assertStoreError(error, "receipt_claim_unavailable");
});
