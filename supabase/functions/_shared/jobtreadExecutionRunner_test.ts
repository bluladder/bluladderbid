// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  type JobTreadBookingMappingInput,
  type JobTreadCustomerMappingInput,
  type JobTreadCustomFieldBindings,
  type JobTreadMappingAuthority,
  type JobTreadQueryPlan,
  planJobTreadAvailabilityRead,
  planJobTreadBookingCreateStep,
  planJobTreadBookingUpdate,
  planJobTreadCustomerLookup,
  planJobTreadCustomerSyncStep,
  planJobTreadHealthCheck,
} from "./jobtreadBusinessMappings.ts";
import {
  canonicalJobTreadJson,
  createJobTreadExecutionRunner,
  type JobTreadAttemptClaimResult,
  type JobTreadConnectorRecord,
  type JobTreadExecutionRequest,
  type JobTreadOperationAttemptClaim,
  sha256Hex,
} from "./jobtreadExecutionRunner.ts";
import type { JobTreadPaveResult } from "./jobtreadPaveClient.ts";

const KLAMATH = "b1addf00-0000-4000-8000-000000000003";
const DFW = "b1addf00-0000-4000-8000-000000000001";
const CONNECTOR = "c1addf00-0000-4000-8000-000000000003";
const PROVIDER_ORGANIZATION = "provider_org_test";
const GRANT_SENTINEL = "jobtread-grant-redaction-sentinel";
const EXECUTION_SENTINEL = "customer-execution-redaction-sentinel";
const IDEMPOTENCY_SENTINEL = "idempotency-redaction-sentinel";

const authority: JobTreadMappingAuthority = {
  organizationId: KLAMATH,
  providerOrganizationId: PROVIDER_ORGANIZATION,
  allowedServiceKeys: ["window_cleaning", "gutter_cleaning"],
};

const bindings: JobTreadCustomFieldBindings = {
  customerReferenceFieldId: "field_customer_ref",
  contactPhoneFieldId: "field_contact_phone",
  contactEmailFieldId: "field_contact_email",
  locationReferenceFieldId: "field_location_ref",
  bookingReferenceFieldId: "field_booking_ref",
};

const customer: JobTreadCustomerMappingInput = {
  organizationId: KLAMATH,
  customerRef: "customer-ref-one",
  locationRef: "property-ref-one",
  displayName: "Customer One",
  primaryContactName: "Customer One",
  phoneNumber: "+15415550123",
  emailAddress: "customer@example.com",
  locationName: "Service location",
  serviceAddress: "100 Example Street, Klamath Falls, OR 97601",
};

const booking: JobTreadBookingMappingInput = {
  organizationId: KLAMATH,
  bookingRef: "booking-ref-one",
  serviceKeys: ["window_cleaning"],
  startDate: "2026-08-20",
  startTime: "09:00",
  endDate: "2026-08-20",
  endTime: "11:30",
};

const providerFingerprint = await sha256Hex(PROVIDER_ORGANIZATION);

function readyPlan(
  result: ReturnType<typeof planJobTreadHealthCheck>,
): JobTreadQueryPlan {
  if (result.status !== "ready") throw new Error("test_plan_not_ready");
  return result.plan;
}

function connector(
  capability: ConnectorCapability,
  overrides: Partial<JobTreadConnectorRecord> = {},
): JobTreadConnectorRecord {
  return {
    id: CONNECTOR,
    organizationId: KLAMATH,
    provider: "jobtread",
    status: "active",
    capabilities: [capability],
    credentialReference: "protected/jobtread/klamath/grant",
    providerOrganizationFingerprint: providerFingerprint,
    configurationVersion: 1,
    runtimeEnabled: true,
    ...overrides,
  };
}

type Lineage = {
  accountId?: string;
  contactId?: string;
  locationId?: string;
  jobId?: string;
  taskId?: string;
};

function request(
  capability: ConnectorCapability,
  mutation = false,
): JobTreadExecutionRequest {
  return {
    organizationId: KLAMATH,
    capability,
    executionReference: EXECUTION_SENTINEL,
    idempotencyKey: mutation ? IDEMPOTENCY_SENTINEL : null,
  };
}

function harness(options: {
  capability: ConnectorCapability;
  plan: JobTreadQueryPlan;
  response: JobTreadPaveResult<Record<string, unknown>>;
  lineage?: Lineage;
  records?: readonly JobTreadConnectorRecord[];
  preparedConfigurationVersion?: number;
  preparedProviderOrganizationId?: string;
  credential?: string | null;
  claim?: JobTreadAttemptClaimResult;
  throwConnector?: boolean;
  throwPlan?: boolean;
  throwCredential?: boolean;
  throwClaim?: boolean;
  throwCompleteSuccess?: boolean;
  throwCompleteManual?: boolean;
}) {
  const calls = {
    connectorOrganizations: [] as string[],
    planLoads: [] as unknown[],
    credentialReferences: [] as string[],
    claims: [] as JobTreadOperationAttemptClaim[],
    completedSuccess: [] as unknown[],
    completedManual: [] as unknown[],
    transport: [] as Array<{
      grantKey: string;
      query: Record<string, unknown>;
      mutation: boolean;
    }>,
  };
  const run = createJobTreadExecutionRunner({
    connectors: {
      listForOrganization: (organizationId) => {
        calls.connectorOrganizations.push(organizationId);
        if (options.throwConnector) {
          return Promise.reject(new Error("connector_store_sentinel"));
        }
        return Promise.resolve(
          options.records ?? [connector(options.capability)],
        );
      },
    },
    plans: {
      load: (input) => {
        calls.planLoads.push(input);
        if (options.throwPlan) {
          return Promise.reject(new Error("plan_source_sentinel"));
        }
        return Promise.resolve({
          plan: options.plan,
          providerOrganizationId: options.preparedProviderOrganizationId ??
            PROVIDER_ORGANIZATION,
          configurationVersion: options.preparedConfigurationVersion ?? 1,
          expectedLineage: options.lineage ?? {},
        });
      },
    },
    credentials: {
      resolve: (reference) => {
        calls.credentialReferences.push(reference);
        if (options.throwCredential) {
          return Promise.reject(new Error("secret_store_sentinel"));
        }
        return Promise.resolve(
          options.credential === undefined
            ? GRANT_SENTINEL
            : options.credential,
        );
      },
    },
    attempts: {
      claim: (input) => {
        calls.claims.push(input);
        if (options.throwClaim) {
          return Promise.reject(new Error("attempt_claim_sentinel"));
        }
        return Promise.resolve(
          options.claim ?? { status: "claimed", attemptId: "attempt-one" },
        );
      },
      completeSucceeded: (input) => {
        calls.completedSuccess.push(input);
        if (options.throwCompleteSuccess) {
          return Promise.reject(new Error("attempt_complete_sentinel"));
        }
        return Promise.resolve();
      },
      completeManualReview: (input) => {
        calls.completedManual.push(input);
        if (options.throwCompleteManual) {
          return Promise.reject(new Error("attempt_complete_sentinel"));
        }
        return Promise.resolve();
      },
    },
    transport: {
      execute: (input) => {
        calls.transport.push(input);
        return Promise.resolve(options.response);
      },
    },
  });
  return { run, calls };
}

function ok(
  data: Record<string, unknown>,
): JobTreadPaveResult<Record<string, unknown>> {
  return { status: "ok", data, httpStatus: 200 };
}

function healthResponse(providerOrganizationId = PROVIDER_ORGANIZATION) {
  return ok({
    version: "2026-08",
    currentGrant: {
      id: "grant_reference",
      user: {
        memberships: {
          nextPage: null,
          nodes: [{ organization: { id: providerOrganizationId } }],
        },
      },
    },
  });
}

Deno.test("JobTread runner canonical JSON and hashes are stable", async () => {
  const left = canonicalJobTreadJson({ z: [3, { b: true, a: null }], a: 1 });
  const right = canonicalJobTreadJson({ a: 1, z: [3, { a: null, b: true }] });
  assertEquals(left, right);
  assertEquals(await sha256Hex(left), await sha256Hex(right));
  assertMatch(await sha256Hex(left), /^[0-9a-f]{64}$/);
});

Deno.test("JobTread runner resolves one exact active organization connector", async () => {
  const plan = readyPlan(planJobTreadHealthCheck(authority));
  for (
    const [records, code] of [
      [[], "connector_missing"],
      [[
        connector("health"),
        connector("health", {
          id: "d1addf00-0000-4000-8000-000000000003",
        }),
      ], "connector_ambiguous"],
      [[connector("health", { status: "inactive" })], "connector_inactive"],
      [[connector("customer_sync")], "capability_unsupported"],
      [
        [connector("health", { credentialReference: null })],
        "credential_reference_missing",
      ],
    ] as const
  ) {
    const { run, calls } = harness({
      capability: "health",
      plan,
      response: healthResponse(),
      records,
    });
    const result = await run(request("health"));
    assertEquals(result.status, "manual_review");
    if (result.status === "manual_review") assertEquals(result.code, code);
    assertEquals(calls.planLoads.length, 0);
    assertEquals(calls.credentialReferences.length, 0);
    assertEquals(calls.claims.length, 0);
    assertEquals(calls.transport.length, 0);
  }
});

Deno.test("JobTread runner rejects cross-organization connector rows", async () => {
  const plan = readyPlan(planJobTreadHealthCheck(authority));
  const { run, calls } = harness({
    capability: "health",
    plan,
    response: healthResponse(),
    records: [connector("health", { organizationId: DFW })],
  });
  const result = await run(request("health"));
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "organization_lineage_mismatch");
  }
  assertEquals(calls.transport, []);
});

Deno.test("JobTread runner rejects configuration and provider fingerprint drift before credentials", async () => {
  const plan = readyPlan(planJobTreadHealthCheck(authority));
  const version = harness({
    capability: "health",
    plan,
    response: healthResponse(),
    preparedConfigurationVersion: 2,
  });
  const versionResult = await version.run(request("health"));
  assertEquals(versionResult.status, "manual_review");
  if (versionResult.status === "manual_review") {
    assertEquals(versionResult.code, "connector_inactive");
  }
  assertEquals(version.calls.credentialReferences, []);

  const lineage = harness({
    capability: "health",
    plan,
    response: healthResponse(),
    preparedProviderOrganizationId: "different_provider_org",
  });
  const lineageResult = await lineage.run(request("health"));
  assertEquals(lineageResult.status, "manual_review");
  if (lineageResult.status === "manual_review") {
    assertEquals(lineageResult.code, "organization_lineage_mismatch");
  }
  assertEquals(lineage.calls.credentialReferences, []);
});

Deno.test("JobTread runner rejects unapproved plan roots and caller cannot supply a query", async () => {
  const plan: JobTreadQueryPlan = {
    capability: "health",
    step: "grant_membership_read",
    mutation: false,
    query: { version: {}, currentGrant: {}, deleteTask: { $: { id: "bad" } } },
  };
  const { run, calls } = harness({
    capability: "health",
    plan,
    response: healthResponse(),
  });
  const publicRequest = request("health") as JobTreadExecutionRequest & {
    query?: unknown;
  };
  publicRequest.query = { createAccount: {} };
  const result = await run(publicRequest);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "provider_rejected");
  }
  assertEquals(calls.credentialReferences, []);
  assertEquals(calls.transport, []);
});

Deno.test("JobTread runner executes a validated health read with no attempt write", async () => {
  const plan = readyPlan(planJobTreadHealthCheck(authority));
  const { run, calls } = harness({
    capability: "health",
    plan,
    response: healthResponse(),
  });
  const result = await run(request("health"));
  assertEquals(result.status, "ok");
  if (result.status === "ok") {
    assertEquals(result.value, {
      step: "grant_membership_read",
      recordCount: 1,
      nextPagePresent: false,
    });
    assertMatch(result.audit.requestFingerprint ?? "", /^[0-9a-f]{64}$/);
    assertEquals(result.audit.idempotencyKeyHash, null);
  }
  assertEquals(calls.claims, []);
  assertEquals(calls.transport.length, 1);
  assertEquals(calls.transport[0].grantKey, GRANT_SENTINEL);
});

Deno.test("JobTread runner validates customer lookup cardinality and lineage", async () => {
  const plan = readyPlan(
    planJobTreadCustomerLookup(authority, bindings, customer),
  );
  const success = harness({
    capability: "customer_sync",
    plan,
    response: ok({
      organization: {
        id: PROVIDER_ORGANIZATION,
        accounts: {
          nextPage: null,
          nodes: [{
            id: "account_one",
            type: "customer",
            organization: { id: PROVIDER_ORGANIZATION },
            contacts: { nextPage: null, nodes: [{ id: "contact_one" }] },
            locations: { nextPage: null, nodes: [{ id: "location_one" }] },
          }],
        },
      },
    }),
  });
  const result = await success.run(request("customer_sync"));
  assertEquals(result.status, "ok");
  if (result.status === "ok") assertEquals(result.value.recordCount, 1);
  assertEquals(success.calls.claims, []);

  const ambiguous = harness({
    capability: "customer_sync",
    plan,
    response: ok({
      organization: {
        id: PROVIDER_ORGANIZATION,
        accounts: { nextPage: null, nodes: [{}, {}] },
      },
    }),
  });
  const blocked = await ambiguous.run(request("customer_sync"));
  assertEquals(blocked.status, "manual_review");
  if (blocked.status === "manual_review") {
    assertEquals(blocked.code, "provider_rejected");
  }
});

Deno.test("JobTread runner executes bounded availability reads without persistence", async () => {
  const plan = readyPlan(planJobTreadAvailabilityRead(authority, {
    organizationId: KLAMATH,
    serviceKeys: ["window_cleaning"],
    startDate: "2026-08-20",
    endDate: "2026-08-27",
  }));
  const { run, calls } = harness({
    capability: "availability_read",
    plan,
    response: ok({
      organization: {
        id: PROVIDER_ORGANIZATION,
        tasks: {
          nextPage: "next_page",
          nodes: [{
            id: "task_one",
            startDate: "2026-08-20",
            startTime: "09:00",
            endDate: "2026-08-20",
            endTime: "11:30",
            progress: 0,
            job: { id: "job_one" },
          }],
        },
      },
    }),
  });
  const result = await run(request("availability_read"));
  assertEquals(result.status, "ok");
  if (result.status === "ok") {
    assertEquals(result.value.recordCount, 1);
    assertEquals(result.value.nextPagePresent, true);
  }
  assertEquals(calls.claims, []);
  assertEquals(calls.completedSuccess, []);
});

Deno.test("JobTread runner claims a mutation before exactly one transport call and hashes provider references", async () => {
  const plan = readyPlan(planJobTreadCustomerSyncStep(
    authority,
    bindings,
    customer,
    {
      accountId: null,
      contactId: null,
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    },
  ));
  const { run, calls } = harness({
    capability: "customer_sync",
    plan,
    response: ok({
      createAccount: {
        createdAccount: {
          id: "account_one",
          organization: { id: PROVIDER_ORGANIZATION },
          type: "customer",
        },
      },
    }),
  });
  const result = await run(request("customer_sync", true));
  assertEquals(result.status, "ok");
  assertEquals(calls.claims.length, 1);
  assertMatch(calls.claims[0].idempotencyKeyHash, /^[0-9a-f]{64}$/);
  assertMatch(calls.claims[0].requestFingerprint, /^[0-9a-f]{64}$/);
  assertEquals(calls.claims[0].attemptNumber, 1);
  assertEquals(calls.transport.length, 1);
  assertEquals(calls.completedSuccess.length, 1);
  const completion = calls.completedSuccess[0] as {
    providerReferenceHash: string;
  };
  assertEquals(
    completion.providerReferenceHash,
    await sha256Hex("account_one"),
  );
});

Deno.test("JobTread runner validates every customer parent lineage echo", async () => {
  const cases = [
    {
      plan: readyPlan(planJobTreadCustomerSyncStep(
        authority,
        bindings,
        customer,
        {
          accountId: "account_one",
          contactId: null,
          locationId: null,
          accountCurrent: true,
          contactCurrent: false,
          locationCurrent: false,
        },
      )),
      lineage: { accountId: "account_one" },
      response: {
        createContact: {
          createdContact: { id: "contact_one", account: { id: "account_one" } },
        },
      },
    },
    {
      plan: readyPlan(planJobTreadCustomerSyncStep(
        authority,
        bindings,
        customer,
        {
          accountId: "account_one",
          contactId: "contact_one",
          locationId: null,
          accountCurrent: true,
          contactCurrent: false,
          locationCurrent: false,
        },
      )),
      lineage: { accountId: "account_one", contactId: "contact_one" },
      response: {
        updateContact: {
          contact: { id: "contact_one", account: { id: "account_one" } },
        },
      },
    },
    {
      plan: readyPlan(planJobTreadCustomerSyncStep(
        authority,
        bindings,
        customer,
        {
          accountId: "account_one",
          contactId: "contact_one",
          locationId: null,
          accountCurrent: true,
          contactCurrent: true,
          locationCurrent: false,
        },
      )),
      lineage: {
        accountId: "account_one",
        contactId: "contact_one",
      },
      response: {
        createLocation: {
          createdLocation: {
            id: "location_one",
            account: { id: "account_one" },
            contact: { id: "contact_one" },
          },
        },
      },
    },
    {
      plan: readyPlan(planJobTreadCustomerSyncStep(
        authority,
        bindings,
        customer,
        {
          accountId: "account_one",
          contactId: "contact_one",
          locationId: "location_one",
          accountCurrent: true,
          contactCurrent: true,
          locationCurrent: false,
        },
      )),
      lineage: {
        accountId: "account_one",
        contactId: "contact_one",
        locationId: "location_one",
      },
      response: {
        updateLocation: {
          location: {
            id: "location_one",
            account: { id: "account_one" },
            contact: { id: "contact_one" },
          },
        },
      },
    },
  ];
  for (const testCase of cases) {
    const { run, calls } = harness({
      capability: "customer_sync",
      plan: testCase.plan,
      lineage: testCase.lineage,
      response: ok(testCase.response),
    });
    assertEquals((await run(request("customer_sync", true))).status, "ok");
    assertEquals(calls.transport.length, 1);
    assertEquals(calls.completedSuccess.length, 1);
  }
});

Deno.test("JobTread runner requires mutation idempotency before secret, claim, or transport", async () => {
  const plan = readyPlan(planJobTreadBookingCreateStep(
    authority,
    bindings,
    booking,
    { locationId: "location_one", jobId: null, taskId: null },
  ));
  const { run, calls } = harness({
    capability: "booking_create",
    plan,
    lineage: { locationId: "location_one" },
    response: ok({}),
  });
  const result = await run(request("booking_create"));
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "idempotency_key_missing");
  }
  assertEquals(calls.credentialReferences, []);
  assertEquals(calls.claims, []);
  assertEquals(calls.transport, []);
});

Deno.test("JobTread runner blocks duplicate and in-progress writes without provider access", async () => {
  const plan = readyPlan(planJobTreadBookingUpdate(
    authority,
    booking,
    { locationId: "location_one", jobId: "job_one", taskId: "task_one" },
  ));
  for (
    const claim of [
      { status: "duplicate" },
      { status: "in_progress" },
      { status: "conflict" },
    ] as const
  ) {
    const { run, calls } = harness({
      capability: "booking_update",
      plan,
      lineage: { jobId: "job_one", taskId: "task_one" },
      response: ok({}),
      claim,
    });
    const result = await run(request("booking_update", true));
    assertEquals(result.status, "manual_review");
    if (result.status === "manual_review") {
      assertEquals(result.code, "retry_exhausted");
    }
    assertEquals(calls.claims.length, 1);
    assertEquals(calls.transport, []);
  }
});

Deno.test("JobTread runner makes an uncertain transport outcome terminal with no retry", async () => {
  const plan = readyPlan(planJobTreadBookingCreateStep(
    authority,
    bindings,
    booking,
    { locationId: "location_one", jobId: "job_one", taskId: null },
  ));
  const { run, calls } = harness({
    capability: "booking_create",
    plan,
    lineage: { jobId: "job_one" },
    response: {
      status: "error",
      code: "transport_error",
      retryable: true,
      outcomeUncertain: true,
      httpStatus: null,
    },
  });
  const result = await run(request("booking_create", true));
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "provider_unavailable");
    assertEquals(result.retryable, false);
    assertEquals(result.audit.outcomeUncertain, true);
  }
  assertEquals(calls.transport.length, 1);
  assertEquals(calls.completedManual, [{
    attemptId: "attempt-one",
    failureCode: "provider_unavailable",
    outcomeUncertain: true,
  }]);
});

Deno.test("JobTread runner treats malformed mutation success as uncertain reconciliation", async () => {
  const plan = readyPlan(planJobTreadBookingCreateStep(
    authority,
    bindings,
    booking,
    { locationId: "location_one", jobId: null, taskId: null },
  ));
  const { run, calls } = harness({
    capability: "booking_create",
    plan,
    lineage: { locationId: "location_one" },
    response: ok({ createJob: { createdJob: { id: "job_one" } } }),
  });
  const result = await run(request("booking_create", true));
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.code, "retry_exhausted");
    assertEquals(result.audit.outcomeUncertain, true);
  }
  assertEquals(calls.completedManual, [{
    attemptId: "attempt-one",
    failureCode: "retry_exhausted",
    outcomeUncertain: true,
  }]);
  assertEquals(calls.transport.length, 1);
});

Deno.test("JobTread runner verifies job and task parent and schedule echoes", async () => {
  const plan = readyPlan(planJobTreadBookingCreateStep(
    authority,
    bindings,
    booking,
    { locationId: "location_one", jobId: "job_one", taskId: null },
  ));
  const success = harness({
    capability: "booking_create",
    plan,
    lineage: { jobId: "job_one" },
    response: ok({
      createTask: {
        createdTask: {
          id: "task_one",
          job: { id: "job_one" },
          startDate: booking.startDate,
          startTime: booking.startTime,
          endDate: booking.endDate,
          endTime: booking.endTime,
        },
      },
    }),
  });
  assertEquals(
    (await success.run(request("booking_create", true))).status,
    "ok",
  );

  const mismatch = harness({
    capability: "booking_create",
    plan,
    lineage: { jobId: "different_job" },
    response: ok({
      createTask: {
        createdTask: {
          id: "task_one",
          job: { id: "job_one" },
          startDate: booking.startDate,
          startTime: booking.startTime,
          endDate: booking.endDate,
          endTime: booking.endTime,
        },
      },
    }),
  });
  const blocked = await mismatch.run(request("booking_create", true));
  assertEquals(blocked.status, "manual_review");
  if (blocked.status === "manual_review") {
    assertEquals(blocked.code, "capability_unsupported");
  }
  assertEquals(mismatch.calls.transport, []);

  const updatePlan = readyPlan(planJobTreadBookingUpdate(
    authority,
    booking,
    { locationId: "location_one", jobId: "job_one", taskId: "task_one" },
  ));
  const update = harness({
    capability: "booking_update",
    plan: updatePlan,
    lineage: { jobId: "job_one", taskId: "task_one" },
    response: ok({
      updateTask: {
        task: {
          id: "task_one",
          job: { id: "job_one" },
          startDate: booking.startDate,
          startTime: booking.startTime,
          endDate: booking.endDate,
          endTime: booking.endTime,
        },
      },
    }),
  });
  assertEquals(
    (await update.run(request("booking_update", true))).status,
    "ok",
  );
});

Deno.test("JobTread runner fails closed when credential, claim, or completion storage is unavailable", async () => {
  const plan = readyPlan(planJobTreadCustomerSyncStep(
    authority,
    bindings,
    customer,
    {
      accountId: null,
      contactId: null,
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    },
  ));
  const response = ok({
    createAccount: {
      createdAccount: {
        id: "account_one",
        organization: { id: PROVIDER_ORGANIZATION },
        type: "customer",
      },
    },
  });

  const credential = harness({
    capability: "customer_sync",
    plan,
    response,
    credential: null,
  });
  const credentialResult = await credential.run(request("customer_sync", true));
  assertEquals(credentialResult.status, "manual_review");
  if (credentialResult.status === "manual_review") {
    assertEquals(credentialResult.code, "credential_reference_missing");
  }
  assertEquals(credential.calls.claims, []);

  const claim = harness({
    capability: "customer_sync",
    plan,
    response,
    throwClaim: true,
  });
  const claimResult = await claim.run(request("customer_sync", true));
  assertEquals(claimResult.status, "manual_review");
  assertEquals(claim.calls.transport, []);

  const completion = harness({
    capability: "customer_sync",
    plan,
    response,
    throwCompleteSuccess: true,
  });
  const completionResult = await completion.run(request("customer_sync", true));
  assertEquals(completionResult.status, "manual_review");
  if (completionResult.status === "manual_review") {
    assertEquals(completionResult.code, "retry_exhausted");
    assertEquals(completionResult.audit.outcomeUncertain, true);
  }
  assertEquals(completion.calls.transport.length, 1);
});

Deno.test("JobTread runner output and errors never expose grants, requests, or provider references", async () => {
  const plan = readyPlan(planJobTreadCustomerLookup(authority, bindings, {
    ...customer,
    customerRef: EXECUTION_SENTINEL,
  }));
  const { run } = harness({
    capability: "customer_sync",
    plan,
    response: ok({
      organization: {
        id: PROVIDER_ORGANIZATION,
        accounts: {
          nextPage: null,
          nodes: [{
            id: "provider-reference-sentinel",
            type: "customer",
            organization: { id: PROVIDER_ORGANIZATION },
            contacts: { nextPage: null, nodes: [] },
            locations: { nextPage: null, nodes: [] },
          }],
        },
      },
    }),
  });
  const result = await run(request("customer_sync"));
  const serialized = JSON.stringify(result);
  for (
    const forbidden of [
      GRANT_SENTINEL,
      EXECUTION_SENTINEL,
      IDEMPOTENCY_SENTINEL,
      PROVIDER_ORGANIZATION,
      "provider-reference-sentinel",
      "customer@example.com",
      "+15415550123",
    ]
  ) assertEquals(serialized.includes(forbidden), false);
});
