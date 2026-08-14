// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  createJobTreadDormantExecution,
  createJobTreadPreparedPlanRouter,
} from "./jobtreadExecutionComposition.ts";
import {
  type JobTreadPreparedPlanSource,
  sha256Hex,
} from "./jobtreadExecutionRunner.ts";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000003";
const EXECUTION_REFERENCE = "internal_route_001";

function request(capability: ConnectorCapability) {
  return {
    organizationId: ORGANIZATION_ID,
    capability,
    executionReference: EXECUTION_REFERENCE,
  };
}

Deno.test("exact five approved capabilities route to one reviewed source", async () => {
  const calls: string[] = [];
  const source = (name: "read" | "write"): JobTreadPreparedPlanSource => ({
    load(input) {
      calls.push(`${name}:${input.capability}`);
      return Promise.resolve(null);
    },
  });
  const router = createJobTreadPreparedPlanRouter({
    read: source("read"),
    write: source("write"),
  });

  for (const capability of ["health", "availability_read"] as const) {
    calls.length = 0;
    assertEquals(await router.load(request(capability)), null);
    assertEquals(calls, [`read:${capability}`]);
  }
  for (
    const capability of [
      "customer_sync",
      "booking_create",
      "booking_update",
    ] as const
  ) {
    calls.length = 0;
    assertEquals(await router.load(request(capability)), null);
    assertEquals(calls, [`write:${capability}`]);
  }
});

Deno.test("blocked capabilities stop before both protected plan sources", async () => {
  let called = false;
  const protectedSource: JobTreadPreparedPlanSource = {
    load() {
      called = true;
      return Promise.resolve(null);
    },
  };
  const router = createJobTreadPreparedPlanRouter({
    read: protectedSource,
    write: protectedSource,
  });
  for (
    const capability of [
      "quote_sync",
      "booking_cancel",
      "invoice_handoff",
      "communications_handoff",
      "not_a_capability" as ConnectorCapability,
    ] as ConnectorCapability[]
  ) {
    assertEquals(await router.load(request(capability)), null);
  }
  assertFalse(called);
});

Deno.test("selected source failures are redacted without cross-routing", async () => {
  let readCalls = 0;
  let writeCalls = 0;
  const router = createJobTreadPreparedPlanRouter({
    read: {
      load() {
        readCalls += 1;
        return Promise.reject(new Error("private read source failure"));
      },
    },
    write: {
      load() {
        writeCalls += 1;
        return Promise.reject(new Error("private write source failure"));
      },
    },
  });
  assertEquals(await router.load(request("health")), null);
  assertEquals(readCalls, 1);
  assertEquals(writeCalls, 0);
  assertEquals(await router.load(request("customer_sync")), null);
  assertEquals(readCalls, 1);
  assertEquals(writeCalls, 1);
});

Deno.test("dormant composition stops unsupported capability before protected dependencies", async () => {
  const calls: string[] = [];
  const run = createJobTreadDormantExecution({
    runner: {
      connectors: {
        listForOrganization() {
          calls.push("connectors");
          return Promise.resolve([{
            id: "00000000-0000-4000-8000-000000000030",
            organizationId: ORGANIZATION_ID,
            provider: "jobtread",
            status: "active",
            capabilities: ["quote_sync"],
            credentialReference: "protected_reference",
            providerOrganizationFingerprint: "a".repeat(64),
            configurationVersion: 1,
            runtimeEnabled: true,
          }]);
        },
      },
      credentials: {
        resolve() {
          calls.push("credentials");
          return Promise.resolve("should_not_resolve");
        },
      },
      attempts: {
        claim() {
          calls.push("attempt");
          return Promise.resolve({ status: "duplicate" });
        },
        completeSucceeded() {
          return Promise.resolve();
        },
        completeManualReview() {
          return Promise.resolve();
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
    },
    readPlans: {
      contexts: {
        list() {
          calls.push("read_context");
          return Promise.resolve([]);
        },
      },
      configuration: {
        resolve() {
          calls.push("read_configuration");
          return Promise.resolve(null);
        },
      },
    },
    writePlans: {
      contexts: {
        list() {
          calls.push("write_context");
          return Promise.resolve([]);
        },
      },
      configuration: {
        resolve() {
          calls.push("write_configuration");
          return Promise.resolve(null);
        },
      },
    },
  });

  const result = await run({
    ...request("quote_sync"),
    idempotencyKey: "test-key",
  });
  assertEquals(result.status, "manual_review");
  assertEquals(
    result.status === "manual_review" ? result.code : null,
    "connector_inactive",
  );
  assertEquals(calls, ["connectors"]);
});

Deno.test("dormant composition wires one synthetic health read through the runner", async () => {
  const providerOrganizationId = "provider_org_test";
  const fingerprint = await sha256Hex(providerOrganizationId);
  const calls: string[] = [];
  const run = createJobTreadDormantExecution({
    runner: {
      connectors: {
        listForOrganization() {
          calls.push("connectors");
          return Promise.resolve([{
            id: "00000000-0000-4000-8000-000000000030",
            organizationId: ORGANIZATION_ID,
            provider: "jobtread",
            status: "active",
            capabilities: ["health"],
            credentialReference: "protected_reference",
            providerOrganizationFingerprint: fingerprint,
            configurationVersion: 9,
            runtimeEnabled: true,
          }]);
        },
      },
      credentials: {
        resolve() {
          calls.push("credentials");
          return Promise.resolve("synthetic_test_credential");
        },
      },
      attempts: {
        claim() {
          calls.push("attempt");
          return Promise.resolve({ status: "duplicate" });
        },
        completeSucceeded() {
          return Promise.resolve();
        },
        completeManualReview() {
          return Promise.resolve();
        },
      },
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
                      organization: { id: providerOrganizationId },
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
    },
    readPlans: {
      contexts: {
        list() {
          calls.push("read_context");
          return Promise.resolve([{
            organizationId: ORGANIZATION_ID,
            capability: "health",
            executionReference: EXECUTION_REFERENCE,
            configurationVersion: 9,
            expiresAt: "2026-08-14T14:05:00.000Z",
          }]);
        },
      },
      configuration: {
        resolve() {
          calls.push("read_configuration");
          return Promise.resolve({
            organizationId: ORGANIZATION_ID,
            providerOrganizationId,
            allowedServiceKeys: ["window_cleaning"],
            configurationVersion: 9,
          });
        },
      },
      now: () => new Date("2026-08-14T14:00:00.000Z"),
    },
    writePlans: {
      contexts: {
        list() {
          calls.push("write_context");
          return Promise.resolve([]);
        },
      },
      configuration: {
        resolve() {
          calls.push("write_configuration");
          return Promise.resolve(null);
        },
      },
    },
  });

  const result = await run({
    ...request("health"),
  });
  assertEquals(result.status, "ok");
  assertEquals(
    result.status === "ok" ? result.value.step : null,
    "grant_membership_read",
  );
  assertEquals(calls, [
    "connectors",
    "read_context",
    "read_configuration",
    "credentials",
    "transport",
  ]);
});
