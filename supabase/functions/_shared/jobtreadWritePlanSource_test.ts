// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  createJobTreadWritePlanSource,
  type JobTreadWriteExecutionContextStore,
} from "./jobtreadWritePlanSource.ts";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000004";
const EXECUTION_REFERENCE = "internal_write_001";
const NOW = new Date("2026-08-14T14:00:00.000Z");
const EXPIRES_AT = "2026-08-14T14:05:00.000Z";

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    providerOrganizationId: "provider_org_test",
    allowedServiceKeys: [
      "window_cleaning",
      "gutter_cleaning",
      "house_wash",
      "pressure_washing",
    ],
    configurationVersion: 9,
    bindings: {
      customerReferenceFieldId: "field_customer_ref",
      contactPhoneFieldId: "field_contact_phone",
      contactEmailFieldId: "field_contact_email",
      locationReferenceFieldId: "field_location_ref",
      bookingReferenceFieldId: "field_booking_ref",
    },
    ...overrides,
  };
}

function customerContext(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    capability: "customer_sync",
    executionReference: EXECUTION_REFERENCE,
    configurationVersion: 9,
    expiresAt: EXPIRES_AT,
    input: {
      organizationId: ORGANIZATION_ID,
      customerRef: "customer_internal_ref",
      locationRef: "location_internal_ref",
      displayName: "Synthetic Customer",
      primaryContactName: "Synthetic Contact",
      phoneNumber: "+15415550199",
      emailAddress: null,
      locationName: "Synthetic Site",
      serviceAddress: "Synthetic service address",
    },
    state: {
      accountId: null,
      contactId: null,
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    },
    ...overrides,
  };
}

function bookingContext(
  capability: "booking_create" | "booking_update" = "booking_create",
  overrides: Record<string, unknown> = {},
) {
  return {
    organizationId: ORGANIZATION_ID,
    capability,
    executionReference: EXECUTION_REFERENCE,
    configurationVersion: 9,
    expiresAt: EXPIRES_AT,
    input: {
      organizationId: ORGANIZATION_ID,
      bookingRef: "booking_internal_ref",
      serviceKeys: ["window_cleaning"],
      startDate: "2026-08-20",
      startTime: "09:00",
      endDate: "2026-08-20",
      endTime: "11:00",
    },
    state: {
      locationId: "location_test",
      jobId: null,
      taskId: null,
    },
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
  const contexts: JobTreadWriteExecutionContextStore = {
    list(input) {
      options.onContext?.(input);
      return options.contextError
        ? Promise.reject(new Error("private context failure"))
        : Promise.resolve(options.contexts ?? [customerContext()]);
    },
  };
  return createJobTreadWritePlanSource({
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

Deno.test("customer create-account plan is mutation-only with no credential", async () => {
  const result = await load("customer_sync");
  assertEquals(result?.plan.step, "create_account");
  assertEquals(result?.plan.mutation, true);
  assertEquals(result?.expectedLineage, {});
  assertFalse(JSON.stringify(result).toLowerCase().includes("grantkey"));
});

Deno.test("customer workflow derives exact parent lineage for every later step", async () => {
  const cases = [
    {
      state: {
        accountId: "account_test",
        contactId: null,
        locationId: null,
        accountCurrent: false,
        contactCurrent: false,
        locationCurrent: false,
      },
      step: "update_account",
      lineage: { accountId: "account_test" },
    },
    {
      state: {
        accountId: "account_test",
        contactId: null,
        locationId: null,
        accountCurrent: true,
        contactCurrent: false,
        locationCurrent: false,
      },
      step: "create_contact",
      lineage: { accountId: "account_test" },
    },
    {
      state: {
        accountId: "account_test",
        contactId: "contact_test",
        locationId: null,
        accountCurrent: true,
        contactCurrent: false,
        locationCurrent: false,
      },
      step: "update_contact",
      lineage: { accountId: "account_test", contactId: "contact_test" },
    },
    {
      state: {
        accountId: "account_test",
        contactId: "contact_test",
        locationId: null,
        accountCurrent: true,
        contactCurrent: true,
        locationCurrent: false,
      },
      step: "create_location",
      lineage: { accountId: "account_test", contactId: "contact_test" },
    },
    {
      state: {
        accountId: "account_test",
        contactId: "contact_test",
        locationId: "location_test",
        accountCurrent: true,
        contactCurrent: true,
        locationCurrent: false,
      },
      step: "update_location",
      lineage: {
        accountId: "account_test",
        contactId: "contact_test",
        locationId: "location_test",
      },
    },
  ];
  for (const expected of cases) {
    const result = await load("customer_sync", {
      contexts: [customerContext({ state: expected.state })],
    });
    assertEquals(result?.plan.step, expected.step);
    assertEquals(result?.expectedLineage, expected.lineage);
  }
});

Deno.test("booking create and update derive exact parent lineage", async () => {
  const createJob = await load("booking_create", {
    contexts: [bookingContext()],
  });
  assertEquals(createJob?.plan.step, "create_job");
  assertEquals(createJob?.expectedLineage, { locationId: "location_test" });

  const createTask = await load("booking_create", {
    contexts: [bookingContext("booking_create", {
      state: {
        locationId: "location_test",
        jobId: "job_test",
        taskId: null,
      },
    })],
  });
  assertEquals(createTask?.plan.step, "create_scheduled_task");
  assertEquals(createTask?.expectedLineage, { jobId: "job_test" });

  const update = await load("booking_update", {
    contexts: [bookingContext("booking_update", {
      state: {
        locationId: "location_test",
        jobId: "job_test",
        taskId: "task_test",
      },
    })],
  });
  assertEquals(update?.plan.step, "update_scheduled_task");
  assertEquals(update?.expectedLineage, {
    jobId: "job_test",
    taskId: "task_test",
  });
});

Deno.test("already-complete workflows never produce another mutation", async () => {
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext({
        state: {
          accountId: "account_test",
          contactId: "contact_test",
          locationId: "location_test",
          accountCurrent: true,
          contactCurrent: true,
          locationCurrent: true,
        },
      })],
    }),
    null,
  );
  assertEquals(
    await load("booking_create", {
      contexts: [bookingContext("booking_create", {
        state: {
          locationId: "location_test",
          jobId: "job_test",
          taskId: "task_test",
        },
      })],
    }),
    null,
  );
});

Deno.test("unsupported reads stop before protected dependencies", async () => {
  let called = false;
  const result = await load("availability_read", {
    onContext: () => called = true,
  });
  assertEquals(result, null);
  assertFalse(called);
});

Deno.test("zero, ambiguous, stale, and cross-organization contexts fail closed", async () => {
  assertEquals(await load("customer_sync", { contexts: [] }), null);
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext(), customerContext()],
    }),
    null,
  );
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext({ expiresAt: "2026-08-14T13:59:00Z" })],
    }),
    null,
  );
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext({ organizationId: OTHER_ORGANIZATION_ID })],
    }),
    null,
  );
});

Deno.test("configuration drift, extra fields, and secret material fail closed", async () => {
  for (
    const protectedConfiguration of [
      configuration({ configurationVersion: 10 }),
      configuration({ organizationId: OTHER_ORGANIZATION_ID }),
      configuration({ grantKey: "not accepted" }),
      configuration({
        bindings: {
          ...configuration().bindings as Record<string, unknown>,
          apiToken: "not accepted",
        },
      }),
    ]
  ) {
    assertEquals(
      await load("customer_sync", { protectedConfiguration }),
      null,
    );
  }
});

Deno.test("invalid customer contact and impossible provider state fail closed", async () => {
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext({
        input: {
          ...customerContext().input as Record<string, unknown>,
          phoneNumber: "not-a-phone",
        },
      })],
    }),
    null,
  );
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext({
        state: {
          accountId: null,
          contactId: "contact_without_account",
          locationId: null,
          accountCurrent: false,
          contactCurrent: false,
          locationCurrent: false,
        },
      })],
    }),
    null,
  );
});

Deno.test("missing and extra protected context fields fail closed", async () => {
  const missingCustomerInput = {
    ...customerContext().input as Record<string, unknown>,
  };
  delete missingCustomerInput.emailAddress;
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext({ input: missingCustomerInput })],
    }),
    null,
  );

  const missingCustomerState = {
    ...customerContext().state as Record<string, unknown>,
  };
  delete missingCustomerState.contactCurrent;
  assertEquals(
    await load("customer_sync", {
      contexts: [customerContext({ state: missingCustomerState })],
    }),
    null,
  );

  assertEquals(
    await load("booking_create", {
      contexts: [bookingContext("booking_create", {
        input: {
          ...bookingContext().input as Record<string, unknown>,
          destinationPhone: "not accepted",
        },
      })],
    }),
    null,
  );
  assertEquals(
    await load("booking_update", {
      contexts: [bookingContext("booking_update", {
        state: {
          locationId: "location_test",
          jobId: "job_test",
          taskId: "task_test",
          notify: true,
        },
      })],
    }),
    null,
  );
});

Deno.test("unapproved services and invalid booking ranges fail closed", async () => {
  assertEquals(
    await load("booking_create", {
      contexts: [bookingContext("booking_create", {
        input: {
          ...bookingContext().input as Record<string, unknown>,
          serviceKeys: ["roof_cleaning"],
        },
      })],
    }),
    null,
  );
  assertEquals(
    await load("booking_update", {
      contexts: [bookingContext("booking_update", {
        input: {
          ...bookingContext().input as Record<string, unknown>,
          endTime: "08:00",
        },
        state: {
          locationId: "location_test",
          jobId: "job_test",
          taskId: "task_test",
        },
      })],
    }),
    null,
  );
});

Deno.test("store and resolver failures are redacted and never transported", async () => {
  assertEquals(await load("customer_sync", { contextError: true }), null);
  assertEquals(await load("customer_sync", { configurationError: true }), null);
});
