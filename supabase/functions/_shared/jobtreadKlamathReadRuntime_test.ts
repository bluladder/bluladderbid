// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  type JobTreadConnectorRecord,
  sha256Hex,
} from "./jobtreadExecutionRunner.ts";
import {
  KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
  KLAMATH_JOBTREAD_ORGANIZATION_ID,
} from "./jobtreadKlamathProtectedConfiguration.ts";
import {
  createKlamathJobTreadReadRuntime,
  createReadOnlyJobTreadTransport,
  KLAMATH_JOBTREAD_READ_RUNTIME_FLAG,
  type KlamathJobTreadReadRuntimeDependencies,
  parseKlamathJobTreadReadRuntimeRequest,
} from "./jobtreadKlamathReadRuntime.ts";

const EXECUTION_REFERENCE = "owner_acceptance_001";
const PROVIDER_ORGANIZATION_ID = "provider_org_test";
const CONNECTOR_ID = "00000000-0000-4000-8000-000000000030";

function request(capability: "health" | "availability_read" = "health") {
  return capability === "health"
    ? { capability, executionReference: EXECUTION_REFERENCE }
    : {
      capability,
      executionReference: EXECUTION_REFERENCE,
      serviceKeys: ["window_cleaning"],
      startDate: "2026-08-18",
      endDate: "2026-08-25",
    };
}

function attemptStore() {
  return {
    claim() {
      throw new Error("read runtime must not claim mutation attempt");
    },
    completeSucceeded() {
      throw new Error("read runtime must not complete mutation attempt");
    },
    completeManualReview() {
      throw new Error("read runtime must not update mutation attempt");
    },
  };
}

async function connector(
  overrides: Partial<JobTreadConnectorRecord> = {},
): Promise<JobTreadConnectorRecord> {
  return {
    id: CONNECTOR_ID,
    organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
    provider: "jobtread",
    status: "active",
    capabilities: ["health", "availability_read"] as ConnectorCapability[],
    credentialReference: "protected_reference",
    providerOrganizationFingerprint: await sha256Hex(
      PROVIDER_ORGANIZATION_ID,
    ),
    configurationVersion: KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
    runtimeEnabled: true,
    ...overrides,
  };
}

async function dependencies(
  calls: string[],
  overrides: Partial<KlamathJobTreadReadRuntimeDependencies> = {},
): Promise<KlamathJobTreadReadRuntimeDependencies> {
  const exactConnector = await connector();
  return {
    readEnvironment(key) {
      calls.push(`environment:${key}`);
      return key === KLAMATH_JOBTREAD_READ_RUNTIME_FLAG ? "true" : undefined;
    },
    connectors: {
      listForOrganization() {
        calls.push("connectors");
        return Promise.resolve([exactConnector]);
      },
    },
    attempts: attemptStore(),
    credentials: {
      resolve() {
        calls.push("credentials");
        return Promise.resolve("synthetic_test_credential");
      },
    },
    configuration: {
      resolve() {
        calls.push("configuration");
        return Promise.resolve({
          organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
          providerOrganizationId: PROVIDER_ORGANIZATION_ID,
          allowedServiceKeys: [
            "window_cleaning",
            "gutter_cleaning",
            "house_wash",
            "pressure_washing",
          ],
          configurationVersion: KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
        });
      },
    },
    transport: {
      execute() {
        calls.push("transport");
        return Promise.resolve({
          status: "error",
          code: "provider_rejected",
          retryable: false,
          outcomeUncertain: false,
          httpStatus: 400,
        });
      },
    },
    now: () => new Date("2026-08-14T20:00:00.000Z"),
    ...overrides,
  };
}

Deno.test("request parser accepts only exact bounded read shapes", () => {
  assertEquals(parseKlamathJobTreadReadRuntimeRequest(request()), request());
  assertEquals(
    parseKlamathJobTreadReadRuntimeRequest(request("availability_read")),
    request("availability_read"),
  );
  assertEquals(
    parseKlamathJobTreadReadRuntimeRequest({
      ...request(),
      organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
    }),
    null,
  );
  assertEquals(
    parseKlamathJobTreadReadRuntimeRequest({
      capability: "customer_sync",
      executionReference: EXECUTION_REFERENCE,
    }),
    null,
  );
  assertEquals(
    parseKlamathJobTreadReadRuntimeRequest({
      ...request("availability_read"),
      endDate: "2026-10-01",
    }),
    null,
  );
});

Deno.test("dedicated flag blocks before every protected dependency", async () => {
  const calls: string[] = [];
  const run = createKlamathJobTreadReadRuntime(
    await dependencies(calls, {
      readEnvironment(key) {
        calls.push(`environment:${key}`);
        return undefined;
      },
      connectors: {
        listForOrganization() {
          calls.push("connectors");
          return Promise.resolve([]);
        },
      },
    }),
  );
  const result = await run(request());
  assertEquals(result.status, "manual_review");
  assertEquals(
    result.status === "manual_review" ? result.code : null,
    "connector_inactive",
  );
  assertEquals(calls, [`environment:${KLAMATH_JOBTREAD_READ_RUNTIME_FLAG}`]);
});

Deno.test("inactive connector blocks configuration credential and transport", async () => {
  const calls: string[] = [];
  const inactive = await connector({
    status: "inactive",
    runtimeEnabled: false,
  });
  const run = createKlamathJobTreadReadRuntime(
    await dependencies(calls, {
      connectors: {
        listForOrganization() {
          calls.push("connectors");
          return Promise.resolve([inactive]);
        },
      },
    }),
  );
  const result = await run(request());
  assertEquals(result.status, "manual_review");
  assertEquals(
    result.status === "manual_review" ? result.code : null,
    "connector_inactive",
  );
  assertEquals(calls, [
    `environment:${KLAMATH_JOBTREAD_READ_RUNTIME_FLAG}`,
    "connectors",
  ]);
});

Deno.test("read-only transport rejects mutations without fetch", async () => {
  let fetched = false;
  const transport = createReadOnlyJobTreadTransport(() => {
    fetched = true;
    return Promise.reject(new Error("must not fetch"));
  });
  const result = await transport.execute({
    grantKey: "synthetic_test_credential",
    query: { createJob: { $: { locationId: "test" } } },
    mutation: true,
  });
  assertEquals(result.status, "error");
  assertEquals(result.status === "error" ? result.code : null, "invalid_query");
  assertFalse(fetched);
});

Deno.test("synthetic health reaches transport once", async () => {
  const calls: string[] = [];
  const run = createKlamathJobTreadReadRuntime(
    await dependencies(calls, {
      transport: {
        execute(input) {
          calls.push("transport");
          assertEquals(input.mutation, false);
          return Promise.resolve({
            status: "ok",
            httpStatus: 200,
            data: {
              currentGrant: {
                id: "grant_test",
                user: {
                  memberships: {
                    nodes: [{
                      organization: { id: PROVIDER_ORGANIZATION_ID },
                    }],
                    nextPage: null,
                  },
                },
              },
              version: "synthetic",
            },
          });
        },
      },
    }),
  );
  const result = await run(request());
  assertEquals(result.status, "ok");
  assertEquals(
    result.status === "ok" ? result.value.step : null,
    "grant_membership_read",
  );
  assertEquals(calls, [
    `environment:${KLAMATH_JOBTREAD_READ_RUNTIME_FLAG}`,
    "connectors",
    "configuration",
    "credentials",
    "transport",
  ]);
});

Deno.test("synthetic availability returns only bounded count evidence", async () => {
  const calls: string[] = [];
  const run = createKlamathJobTreadReadRuntime(
    await dependencies(calls, {
      transport: {
        execute(input) {
          calls.push("transport");
          assertEquals(input.mutation, false);
          return Promise.resolve({
            status: "ok",
            httpStatus: 200,
            data: {
              organization: {
                id: PROVIDER_ORGANIZATION_ID,
                tasks: {
                  nodes: [{
                    id: "task_test",
                    startDate: "2026-08-20",
                    startTime: "09:00",
                    endDate: "2026-08-20",
                    endTime: "12:00",
                    progress: "scheduled",
                    job: { id: "job_test" },
                  }],
                  nextPage: null,
                },
              },
            },
          });
        },
      },
    }),
  );
  const result = await run(request("availability_read"));
  assertEquals(result.status, "ok");
  assertEquals(result.status === "ok" ? result.value : null, {
    step: "read_scheduled_job_tasks",
    recordCount: 1,
    nextPagePresent: false,
  });
});

Deno.test("fingerprint mismatch stops before credential and transport", async () => {
  const calls: string[] = [];
  const mismatch = await connector({
    providerOrganizationFingerprint: "a".repeat(64),
  });
  const run = createKlamathJobTreadReadRuntime(
    await dependencies(calls, {
      connectors: {
        listForOrganization() {
          calls.push("connectors");
          return Promise.resolve([mismatch]);
        },
      },
    }),
  );
  const result = await run(request());
  assertEquals(result.status, "manual_review");
  assertEquals(
    result.status === "manual_review" ? result.code : null,
    "organization_lineage_mismatch",
  );
  assertEquals(calls, [
    `environment:${KLAMATH_JOBTREAD_READ_RUNTIME_FLAG}`,
    "connectors",
    "configuration",
  ]);
});
