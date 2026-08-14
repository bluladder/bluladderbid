// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  createJobTreadReadPlanSource,
  type JobTreadReadExecutionContextStore,
} from "./jobtreadReadPlanSource.ts";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000004";
const EXECUTION_REFERENCE = "internal_read_0001";
const PROVIDER_ORGANIZATION_ID = "provider_org_test";
const NOW = new Date("2026-08-14T14:00:00.000Z");
const EXPIRES_AT = "2026-08-14T14:05:00.000Z";

function healthContext(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    capability: "health",
    executionReference: EXECUTION_REFERENCE,
    configurationVersion: 7,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function availabilityContext(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    capability: "availability_read",
    executionReference: EXECUTION_REFERENCE,
    configurationVersion: 7,
    serviceKeys: ["window_cleaning"],
    startDate: "2026-08-17",
    endDate: "2026-08-24",
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    providerOrganizationId: PROVIDER_ORGANIZATION_ID,
    allowedServiceKeys: [
      "window_cleaning",
      "gutter_cleaning",
      "house_wash",
      "pressure_washing",
    ],
    configurationVersion: 7,
    ...overrides,
  };
}

function source(options: {
  contexts?: readonly unknown[];
  protectedConfiguration?: unknown;
  contextError?: boolean;
  configurationError?: boolean;
  onContext?: (input: Record<string, unknown>) => void;
} = {}) {
  const contexts: JobTreadReadExecutionContextStore = {
    list(input) {
      options.onContext?.(input);
      if (options.contextError) {
        return Promise.reject(new Error("private context failure"));
      }
      return Promise.resolve(options.contexts ?? [healthContext()]);
    },
  };
  return createJobTreadReadPlanSource({
    contexts,
    now: () => NOW,
    configuration: {
      resolve() {
        if (options.configurationError) {
          return Promise.reject(new Error("private configuration failure"));
        }
        return Promise.resolve(
          Object.prototype.hasOwnProperty.call(
              options,
              "protectedConfiguration",
            )
            ? options.protectedConfiguration
            : configuration(),
        );
      },
    },
  });
}

async function load(
  capability: ConnectorCapability,
  options: Parameters<typeof source>[0] = {},
) {
  return await source(options).load({
    organizationId: ORGANIZATION_ID,
    capability,
    executionReference: EXECUTION_REFERENCE,
  });
}

Deno.test("health plan is read-only and contains no credential", async () => {
  const result = await load("health");
  assertEquals(result?.plan.capability, "health");
  assertFalse(result?.plan.mutation ?? true);
  assertEquals(Object.keys(result?.plan.query ?? {}).sort(), [
    "currentGrant",
    "version",
  ]);
  assertEquals(result?.configurationVersion, 7);
  assertEquals(result?.expectedLineage, {});
  assertFalse(JSON.stringify(result).toLowerCase().includes("grantkey"));
});

Deno.test("availability plan is bounded to trusted context and services", async () => {
  const result = await load("availability_read", {
    contexts: [availabilityContext()],
  });
  assertEquals(result?.plan.step, "read_scheduled_job_tasks");
  assertFalse(result?.plan.mutation ?? true);
  assertEquals(
    (result?.plan.query.organization as Record<string, unknown>).$,
    { id: PROVIDER_ORGANIZATION_ID },
  );
  assertEquals(result?.expectedLineage, {});
});

Deno.test("caller request is reduced to organization, read capability, and opaque reference", async () => {
  let captured: Record<string, unknown> | null = null;
  await load("health", { onContext: (input) => captured = input });
  assertEquals(captured, {
    organizationId: ORGANIZATION_ID,
    capability: "health",
    executionReference: EXECUTION_REFERENCE,
  });
});

Deno.test("unsupported write capabilities stop before protected dependencies", async () => {
  let called = false;
  const result = await load("booking_create", {
    onContext: () => called = true,
  });
  assertEquals(result, null);
  assertFalse(called);
});

Deno.test("zero or ambiguous contexts fail closed", async () => {
  assertEquals(await load("health", { contexts: [] }), null);
  assertEquals(
    await load("health", { contexts: [healthContext(), healthContext()] }),
    null,
  );
});

Deno.test("organization, capability, reference, and version drift fail closed", async () => {
  for (
    const context of [
      healthContext({ organizationId: OTHER_ORGANIZATION_ID }),
      healthContext({ capability: "availability_read" }),
      healthContext({ executionReference: "another_reference" }),
      healthContext({ configurationVersion: 8 }),
    ]
  ) {
    assertEquals(await load("health", { contexts: [context] }), null);
  }
  assertEquals(
    await load("health", {
      protectedConfiguration: configuration({
        organizationId: OTHER_ORGANIZATION_ID,
      }),
    }),
    null,
  );
});

Deno.test("expired or excessively long-lived contexts fail closed", async () => {
  for (
    const expiresAt of [
      "2026-08-14T13:59:59.000Z",
      "2026-08-14T14:05:01.000Z",
      "not-a-timestamp",
    ]
  ) {
    assertEquals(
      await load("health", { contexts: [healthContext({ expiresAt })] }),
      null,
    );
  }
});

Deno.test("unapproved services and invalid schedule ranges fail closed", async () => {
  assertEquals(
    await load("availability_read", {
      contexts: [availabilityContext({ serviceKeys: ["roof_cleaning"] })],
    }),
    null,
  );
  assertEquals(
    await load("availability_read", {
      contexts: [availabilityContext({
        startDate: "2026-08-24",
        endDate: "2026-08-17",
      })],
    }),
    null,
  );
});

Deno.test("extra fields including secrets and provider identifiers fail closed", async () => {
  assertEquals(
    await load("health", {
      contexts: [healthContext({ grantKey: "not accepted" })],
    }),
    null,
  );
  assertEquals(
    await load("health", {
      protectedConfiguration: configuration({ apiToken: "not accepted" }),
    }),
    null,
  );
});

Deno.test("malformed protected configuration fails closed", async () => {
  for (
    const protectedConfiguration of [
      null,
      configuration({ providerOrganizationId: "bad id" }),
      configuration({ allowedServiceKeys: [] }),
      configuration({ configurationVersion: 0 }),
    ]
  ) {
    assertEquals(await load("health", { protectedConfiguration }), null);
  }
});

Deno.test("private store and resolver errors are redacted to null", async () => {
  assertEquals(await load("health", { contextError: true }), null);
  assertEquals(await load("health", { configurationError: true }), null);
});
