// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  JOBTREAD_APPROVED_MAPPING_CAPABILITIES,
  JOBTREAD_BLOCKED_MAPPING_CAPABILITIES,
  type JobTreadBookingMappingInput,
  type JobTreadCustomerMappingInput,
  type JobTreadCustomFieldBindings,
  type JobTreadMappingAuthority,
  planJobTreadAvailabilityRead,
  planJobTreadBookingCreateStep,
  planJobTreadBookingUpdate,
  planJobTreadCustomerLookup,
  planJobTreadCustomerSyncStep,
  planJobTreadHealthCheck,
  planUnsupportedJobTreadMapping,
} from "./jobtreadBusinessMappings.ts";

const KLAMATH = "b1addf00-0000-4000-8000-000000000003";
const DFW = "b1addf00-0000-4000-8000-000000000001";

const authority: JobTreadMappingAuthority = {
  organizationId: KLAMATH,
  providerOrganizationId: "provider_org_test",
  allowedServiceKeys: [
    "window_cleaning",
    "gutter_cleaning",
    "house_wash",
    "pressure_washing",
  ],
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
  emailAddress: "CUSTOMER@EXAMPLE.COM",
  locationName: "Service location",
  serviceAddress: "100 Example Street, Klamath Falls, OR 97601",
};

const booking: JobTreadBookingMappingInput = {
  organizationId: KLAMATH,
  bookingRef: "booking-ref-one",
  serviceKeys: ["window_cleaning", "gutter_cleaning"],
  startDate: "2026-08-20",
  startTime: "09:00",
  endDate: "2026-08-20",
  endTime: "11:30",
};

function valueAt(source: unknown, ...path: string[]): unknown {
  let value = source;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

Deno.test("JobTread business mapping approval is an exact bounded subset", () => {
  assertEquals(JOBTREAD_APPROVED_MAPPING_CAPABILITIES, [
    "health",
    "customer_sync",
    "availability_read",
    "booking_create",
    "booking_update",
  ]);
  assertEquals(JOBTREAD_BLOCKED_MAPPING_CAPABILITIES, [
    "quote_sync",
    "booking_cancel",
    "invoice_handoff",
    "communications_handoff",
  ]);
});

Deno.test("health plan is read-only and contains no grant material", () => {
  const result = planJobTreadHealthCheck(authority);
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(result.plan.mutation, false);
  assertEquals(result.plan.step, "grant_membership_read");
  const serialized = JSON.stringify(result.plan.query);
  assertEquals(serialized.includes("grantKey"), false);
  assertEquals(serialized.includes(authority.providerOrganizationId), false);
});

Deno.test("customer lookup uses server-owned provider organization and exact reference binding", () => {
  const result = planJobTreadCustomerLookup(authority, bindings, customer);
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(result.plan.mutation, false);
  const query = result.plan.query;
  assertEquals(
    valueAt(query, "organization", "$", "id"),
    authority.providerOrganizationId,
  );
  assertEquals(
    valueAt(
      query,
      "organization",
      "accounts",
      "$",
      "with",
      "bluladder_ref",
      "_",
      "customFieldValues",
      "$",
      "where",
    ),
    [["customField", "id", bindings.customerReferenceFieldId]],
  );
  assertEquals(valueAt(query, "organization", "accounts", "$", "where"), [
    ["bluladder_ref", "values", "=", customer.customerRef],
  ]);
  assertEquals(valueAt(query, "organization", "accounts", "$", "size"), 2);
});

Deno.test("customer mapping rejects cross-organization and provider-field injection before planning", () => {
  const crossed = planJobTreadCustomerLookup(authority, bindings, {
    ...customer,
    organizationId: DFW,
  });
  assertEquals(crossed, {
    status: "manual_review",
    code: "organization_lineage_mismatch",
    retryable: false,
  });

  const injected = planJobTreadCustomerLookup(authority, bindings, {
    ...customer,
    providerOrganizationId: "caller-controlled",
  } as JobTreadCustomerMappingInput);
  assertEquals(injected, {
    status: "manual_review",
    code: "invalid_customer",
    retryable: false,
  });
});

Deno.test("customer mapping fails closed when a custom-field binding is missing", () => {
  const result = planJobTreadCustomerSyncStep(
    authority,
    { ...bindings, contactPhoneFieldId: " " },
    customer,
    {
      accountId: null,
      contactId: null,
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    },
  );
  assertEquals(result, {
    status: "manual_review",
    code: "provider_binding_missing",
    retryable: false,
  });
});

Deno.test("customer mapping plans the exact account contact and location sequence", () => {
  const states = [
    {
      accountId: null,
      contactId: null,
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    },
    {
      accountId: "account_one",
      contactId: null,
      locationId: null,
      accountCurrent: true,
      contactCurrent: false,
      locationCurrent: false,
    },
    {
      accountId: "account_one",
      contactId: "contact_one",
      locationId: null,
      accountCurrent: true,
      contactCurrent: true,
      locationCurrent: false,
    },
    {
      accountId: "account_one",
      contactId: "contact_one",
      locationId: "location_one",
      accountCurrent: true,
      contactCurrent: true,
      locationCurrent: true,
    },
  ];
  const results = states.map((state) =>
    planJobTreadCustomerSyncStep(authority, bindings, customer, state)
  );
  assertEquals(
    results.map((result) =>
      result.status === "ready" ? result.plan.step : result.status
    ),
    ["create_account", "create_contact", "create_location", "complete"],
  );
  if (results[0].status === "ready") {
    const query = results[0].plan.query;
    assertEquals(
      valueAt(query, "createAccount", "$", "organizationId"),
      "provider_org_test",
    );
    assertEquals(valueAt(query, "createAccount", "$", "type"), "customer");
    assertEquals(valueAt(query, "createAccount", "$", "notify"), false);
    assertEquals(valueAt(query, "createAccount", "$", "customFieldValues"), {
      field_customer_ref: "customer-ref-one",
    });
  }
  if (results[1].status === "ready") {
    const query = results[1].plan.query;
    assertEquals(valueAt(query, "createContact", "$", "customFieldValues"), {
      field_contact_phone: "+15415550123",
      field_contact_email: "customer@example.com",
    });
  }
  if (results[2].status === "ready") {
    const query = results[2].plan.query;
    assertEquals(valueAt(query, "createLocation", "$", "parseAddress"), true);
    assertEquals(valueAt(query, "createLocation", "$", "customFieldValues"), {
      field_location_ref: "property-ref-one",
    });
  }
});

Deno.test("customer mapping updates existing records without changing provider lineage", () => {
  const account = planJobTreadCustomerSyncStep(authority, bindings, customer, {
    accountId: "account_one",
    contactId: "contact_one",
    locationId: "location_one",
    accountCurrent: false,
    contactCurrent: false,
    locationCurrent: false,
  });
  assertEquals(
    account.status === "ready" && account.plan.step,
    "update_account",
  );

  const contact = planJobTreadCustomerSyncStep(authority, bindings, customer, {
    accountId: "account_one",
    contactId: "contact_one",
    locationId: "location_one",
    accountCurrent: true,
    contactCurrent: false,
    locationCurrent: false,
  });
  assertEquals(
    contact.status === "ready" && contact.plan.step,
    "update_contact",
  );

  const location = planJobTreadCustomerSyncStep(authority, bindings, customer, {
    accountId: "account_one",
    contactId: "contact_one",
    locationId: "location_one",
    accountCurrent: true,
    contactCurrent: true,
    locationCurrent: false,
  });
  assertEquals(
    location.status === "ready" && location.plan.step,
    "update_location",
  );
});

Deno.test("customer mapping rejects malformed contact identity and impossible provider state", () => {
  const badPhone = planJobTreadCustomerSyncStep(
    authority,
    bindings,
    { ...customer, phoneNumber: "541-555-0123", emailAddress: null },
    {
      accountId: null,
      contactId: null,
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    },
  );
  assertEquals(badPhone.status, "manual_review");
  if (badPhone.status === "manual_review") {
    assertEquals(badPhone.code, "invalid_customer");
  }

  const impossible = planJobTreadCustomerSyncStep(
    authority,
    bindings,
    customer,
    {
      accountId: null,
      contactId: "contact_one",
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    },
  );
  assertEquals(impossible.status, "manual_review");
  if (impossible.status === "manual_review") {
    assertEquals(impossible.code, "provider_state_ambiguous");
  }
});

Deno.test("availability mapping is read-only, paginated, and bounded to job tasks", () => {
  const first = planJobTreadAvailabilityRead(authority, {
    organizationId: KLAMATH,
    serviceKeys: ["window_cleaning"],
    startDate: "2026-08-20",
    endDate: "2026-08-27",
  });
  assertEquals(first.status, "ready");
  if (first.status !== "ready") return;
  assertEquals(first.plan.mutation, false);
  const query = first.plan.query;
  assertEquals(valueAt(query, "organization", "$", "id"), "provider_org_test");
  assertEquals(valueAt(query, "organization", "tasks", "$", "where", "and"), [
    ["startDate", ">=", "2026-08-20"],
    ["startDate", "<=", "2026-08-27"],
    ["targetType", "=", "job"],
    ["isToDo", "=", false],
  ]);
  assertEquals(valueAt(query, "organization", "tasks", "$", "page"), undefined);

  const next = planJobTreadAvailabilityRead(
    authority,
    {
      organizationId: KLAMATH,
      serviceKeys: ["window_cleaning"],
      startDate: "2026-08-20",
      endDate: "2026-08-27",
    },
    "provider_page_token",
  );
  if (next.status === "ready") {
    assertEquals(
      valueAt(next.plan.query, "organization", "tasks", "$", "page"),
      "provider_page_token",
    );
  }
});

Deno.test("availability mapping blocks unapproved services and invalid ranges", () => {
  const service = planJobTreadAvailabilityRead(authority, {
    organizationId: KLAMATH,
    serviceKeys: ["commercial_exterior_cleaning"],
    startDate: "2026-08-20",
    endDate: "2026-08-27",
  });
  assertEquals(service.status, "manual_review");
  if (service.status === "manual_review") {
    assertEquals(service.code, "service_mapping_missing");
  }
  const range = planJobTreadAvailabilityRead(authority, {
    organizationId: KLAMATH,
    serviceKeys: ["window_cleaning"],
    startDate: "2026-08-28",
    endDate: "2026-08-27",
  });
  assertEquals(range.status, "manual_review");
  if (range.status === "manual_review") {
    assertEquals(range.code, "invalid_schedule_range");
  }
});

Deno.test("booking create plans one job then one non-notifying scheduled task", () => {
  const job = planJobTreadBookingCreateStep(authority, bindings, booking, {
    locationId: "location_one",
    jobId: null,
    taskId: null,
  });
  assertEquals(job.status === "ready" && job.plan.step, "create_job");
  if (job.status === "ready") {
    const query = job.plan.query;
    assertEquals(
      valueAt(query, "createJob", "$", "locationId"),
      "location_one",
    );
    assertEquals(
      valueAt(query, "createJob", "$", "scheduleIsPublished"),
      false,
    );
    assertEquals(valueAt(query, "createJob", "$", "customFieldValues"), {
      field_booking_ref: "booking-ref-one",
    });
  }

  const task = planJobTreadBookingCreateStep(authority, bindings, booking, {
    locationId: "location_one",
    jobId: "job_one",
    taskId: null,
  });
  assertEquals(
    task.status === "ready" && task.plan.step,
    "create_scheduled_task",
  );
  if (task.status === "ready") {
    const query = task.plan.query;
    assertEquals(valueAt(query, "createTask", "$", "targetId"), "job_one");
    assertEquals(valueAt(query, "createTask", "$", "targetType"), "job");
    assertEquals(valueAt(query, "createTask", "$", "notify"), false);
    assertEquals(valueAt(query, "createTask", "$", "startDate"), "2026-08-20");
    assertEquals(valueAt(query, "createTask", "$", "endTime"), "11:30");
  }

  const complete = planJobTreadBookingCreateStep(authority, bindings, booking, {
    locationId: "location_one",
    jobId: "job_one",
    taskId: "task_one",
  });
  assertEquals(complete, { status: "complete", capability: "booking_create" });
});

Deno.test("booking update changes only the trusted task schedule", () => {
  const result = planJobTreadBookingUpdate(authority, booking, {
    locationId: "location_one",
    jobId: "job_one",
    taskId: "task_one",
  });
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(result.plan.capability, "booking_update");
  assertEquals(result.plan.mutation, true);
  const query = result.plan.query;
  assertEquals(valueAt(query, "updateTask", "$", "id"), "task_one");
  assertEquals(valueAt(query, "updateTask", "$", "notify"), false);
  assertEquals(
    valueAt(query, "updateTask", "$", "updateDependentTasks"),
    false,
  );
  assertEquals(
    valueAt(query, "updateTask", "$", "updateRecurringTasks"),
    false,
  );
  assertEquals(Object.prototype.hasOwnProperty.call(query, "updateJob"), false);
});

Deno.test("booking mapping rejects invalid chronology and caller provider references", () => {
  const chronology = planJobTreadBookingCreateStep(
    authority,
    bindings,
    { ...booking, endTime: "08:59" },
    { locationId: "location_one", jobId: null, taskId: null },
  );
  assertEquals(chronology.status, "manual_review");
  if (chronology.status === "manual_review") {
    assertEquals(chronology.code, "invalid_schedule_range");
  }

  const injected = planJobTreadBookingCreateStep(
    authority,
    bindings,
    { ...booking, taskId: "caller-controlled" } as JobTreadBookingMappingInput,
    { locationId: "location_one", jobId: null, taskId: null },
  );
  assertEquals(injected.status, "manual_review");
});

Deno.test("unapproved JobTread lifecycles fail closed without a query", () => {
  for (const capability of JOBTREAD_BLOCKED_MAPPING_CAPABILITIES) {
    assertEquals(planUnsupportedJobTreadMapping(capability), {
      status: "manual_review",
      code: "mapping_unsupported",
      retryable: false,
    });
  }
});

Deno.test("approved query plans never contain transport credentials or blocked mutations", () => {
  const plans = [
    planJobTreadHealthCheck(authority),
    planJobTreadCustomerLookup(authority, bindings, customer),
    planJobTreadCustomerSyncStep(authority, bindings, customer, {
      accountId: null,
      contactId: null,
      locationId: null,
      accountCurrent: false,
      contactCurrent: false,
      locationCurrent: false,
    }),
    planJobTreadAvailabilityRead(authority, {
      organizationId: KLAMATH,
      serviceKeys: ["window_cleaning"],
      startDate: "2026-08-20",
      endDate: "2026-08-27",
    }),
    planJobTreadBookingCreateStep(authority, bindings, booking, {
      locationId: "location_one",
      jobId: null,
      taskId: null,
    }),
  ];
  const serialized = JSON.stringify(
    plans.filter((result) => result.status === "ready"),
  );
  for (
    const forbidden of [
      "grantKey",
      "deleteTask",
      "createDocument",
      "createDailyLog",
      "createFile",
      "sendDocument",
    ]
  ) assertEquals(serialized.includes(forbidden), false);
});
