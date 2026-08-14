import type { ConnectorCapability } from "./connectorContracts.ts";

type Query = Record<string, unknown>;

export const JOBTREAD_BUSINESS_MAPPING_VERSION = 1;

export const JOBTREAD_APPROVED_MAPPING_CAPABILITIES = [
  "health",
  "customer_sync",
  "availability_read",
  "booking_create",
  "booking_update",
] as const satisfies readonly ConnectorCapability[];

export const JOBTREAD_BLOCKED_MAPPING_CAPABILITIES = [
  "quote_sync",
  "booking_cancel",
  "invoice_handoff",
  "communications_handoff",
] as const satisfies readonly ConnectorCapability[];

export type JobTreadMappingFailureCode =
  | "organization_lineage_mismatch"
  | "provider_binding_missing"
  | "provider_reference_missing"
  | "invalid_customer"
  | "invalid_schedule_range"
  | "service_mapping_missing"
  | "provider_state_ambiguous"
  | "mapping_unsupported";

export interface JobTreadMappingAuthority {
  /** BluLadder organization identity, resolved server-side. */
  organizationId: string;
  /** Protected provider organization identity, never accepted from a caller. */
  providerOrganizationId: string;
  /** Exact Klamath service keys approved for the connector. */
  allowedServiceKeys: readonly string[];
}

export interface JobTreadCustomFieldBindings {
  customerReferenceFieldId: string;
  contactPhoneFieldId: string;
  contactEmailFieldId: string;
  locationReferenceFieldId: string;
  bookingReferenceFieldId: string;
}

export interface JobTreadCustomerMappingInput {
  organizationId: string;
  customerRef: string;
  locationRef: string;
  displayName: string;
  primaryContactName: string;
  phoneNumber?: string | null;
  emailAddress?: string | null;
  locationName: string;
  serviceAddress: string;
}

export interface JobTreadCustomerProviderState {
  accountId: string | null;
  contactId: string | null;
  locationId: string | null;
  accountCurrent: boolean;
  contactCurrent: boolean;
  locationCurrent: boolean;
}

export interface JobTreadAvailabilityMappingInput {
  organizationId: string;
  serviceKeys: readonly string[];
  startDate: string;
  endDate: string;
}

export interface JobTreadBookingMappingInput {
  organizationId: string;
  bookingRef: string;
  serviceKeys: readonly string[];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export interface JobTreadBookingProviderState {
  locationId: string | null;
  jobId: string | null;
  taskId: string | null;
}

export interface JobTreadQueryPlan {
  capability: ConnectorCapability;
  step: string;
  mutation: boolean;
  query: Query;
}

export type JobTreadMappingResult =
  | { status: "ready"; plan: JobTreadQueryPlan }
  | { status: "complete"; capability: ConnectorCapability }
  | {
    status: "manual_review";
    code: JobTreadMappingFailureCode;
    retryable: false;
  };

const CUSTOMER_INPUT_KEYS = new Set([
  "organizationId",
  "customerRef",
  "locationRef",
  "displayName",
  "primaryContactName",
  "phoneNumber",
  "emailAddress",
  "locationName",
  "serviceAddress",
]);
const CUSTOMER_STATE_KEYS = new Set([
  "accountId",
  "contactId",
  "locationId",
  "accountCurrent",
  "contactCurrent",
  "locationCurrent",
]);
const AVAILABILITY_INPUT_KEYS = new Set([
  "organizationId",
  "serviceKeys",
  "startDate",
  "endDate",
]);
const BOOKING_INPUT_KEYS = new Set([
  "organizationId",
  "bookingRef",
  "serviceKeys",
  "startDate",
  "startTime",
  "endDate",
  "endTime",
]);
const BOOKING_STATE_KEYS = new Set(["locationId", "jobId", "taskId"]);

function manualReview(code: JobTreadMappingFailureCode): JobTreadMappingResult {
  return { status: "manual_review", code, retryable: false };
}

function hasOnlyKeys(value: object, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function providerReference(value: unknown): string | null {
  const normalized = bounded(value, 128);
  return normalized && /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function normalizedPhone(value: unknown): string | null {
  if (value == null || value === "") return null;
  const normalized = bounded(value, 16);
  return normalized && /^\+[1-9][0-9]{7,14}$/.test(normalized)
    ? normalized
    : null;
}

function normalizedEmail(value: unknown): string | null {
  if (value == null || value === "") return null;
  const normalized = bounded(value, 254)?.toLowerCase() ?? null;
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

function validateAuthority(
  authority: JobTreadMappingAuthority,
  organizationId: unknown,
): JobTreadMappingFailureCode | null {
  if (
    !bounded(authority.organizationId, 128) ||
    !providerReference(authority.providerOrganizationId)
  ) return "provider_binding_missing";
  if (organizationId !== authority.organizationId) {
    return "organization_lineage_mismatch";
  }
  return null;
}

function validateBindings(
  bindings: JobTreadCustomFieldBindings,
): JobTreadMappingFailureCode | null {
  return Object.values(bindings).every((value) => providerReference(value))
    ? null
    : "provider_binding_missing";
}

function validateServices(
  authority: JobTreadMappingAuthority,
  serviceKeys: readonly string[],
): JobTreadMappingFailureCode | null {
  if (!Array.isArray(serviceKeys) || serviceKeys.length === 0) {
    return "service_mapping_missing";
  }
  const allowed = new Set(authority.allowedServiceKeys);
  if (
    serviceKeys.some((key) => !bounded(key, 64) || !allowed.has(key)) ||
    new Set(serviceKeys).size !== serviceKeys.length
  ) return "service_mapping_missing";
  return null;
}

function customFieldValues(
  entries: ReadonlyArray<readonly [string, string | null]>,
): Record<string, string> {
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, string] =>
      entry[1] !== null
    ),
  );
}

export function planJobTreadHealthCheck(
  authority: JobTreadMappingAuthority,
): JobTreadMappingResult {
  const authorityError = validateAuthority(authority, authority.organizationId);
  if (authorityError) return manualReview(authorityError);
  return {
    status: "ready",
    plan: {
      capability: "health",
      step: "grant_membership_read",
      mutation: false,
      query: {
        version: {},
        currentGrant: {
          id: {},
          user: {
            memberships: {
              nextPage: {},
              nodes: { organization: { id: {} } },
            },
          },
        },
      },
    },
  };
}

export function planJobTreadCustomerLookup(
  authority: JobTreadMappingAuthority,
  bindings: JobTreadCustomFieldBindings,
  input: JobTreadCustomerMappingInput,
): JobTreadMappingResult {
  if (!hasOnlyKeys(input, CUSTOMER_INPUT_KEYS)) {
    return manualReview("invalid_customer");
  }
  const authorityError = validateAuthority(authority, input.organizationId);
  if (authorityError) return manualReview(authorityError);
  const bindingError = validateBindings(bindings);
  if (bindingError) return manualReview(bindingError);
  const customerRef = bounded(input.customerRef, 128);
  if (!customerRef) return manualReview("invalid_customer");

  return {
    status: "ready",
    plan: {
      capability: "customer_sync",
      step: "lookup_by_external_reference",
      mutation: false,
      query: {
        organization: {
          $: { id: authority.providerOrganizationId },
          id: {},
          accounts: {
            $: {
              size: 2,
              with: {
                bluladder_ref: {
                  _: {
                    customFieldValues: {
                      $: {
                        where: [[
                          "customField",
                          "id",
                          bindings.customerReferenceFieldId,
                        ]],
                      },
                      values: { $: { field: "value" } },
                    },
                  },
                },
              },
              where: [["bluladder_ref", "values", "=", customerRef]],
            },
            nextPage: {},
            nodes: {
              id: {},
              type: {},
              organization: { id: {} },
              contacts: { $: { size: 2 }, nextPage: {}, nodes: { id: {} } },
              locations: {
                $: { size: 2 },
                nextPage: {},
                nodes: { id: {} },
              },
            },
          },
        },
      },
    },
  };
}

export function planJobTreadCustomerSyncStep(
  authority: JobTreadMappingAuthority,
  bindings: JobTreadCustomFieldBindings,
  input: JobTreadCustomerMappingInput,
  state: JobTreadCustomerProviderState,
): JobTreadMappingResult {
  if (
    !hasOnlyKeys(input, CUSTOMER_INPUT_KEYS) ||
    !hasOnlyKeys(state, CUSTOMER_STATE_KEYS)
  ) return manualReview("invalid_customer");
  const authorityError = validateAuthority(authority, input.organizationId);
  if (authorityError) return manualReview(authorityError);
  const bindingError = validateBindings(bindings);
  if (bindingError) return manualReview(bindingError);

  const customerRef = bounded(input.customerRef, 128);
  const locationRef = bounded(input.locationRef, 128);
  const displayName = bounded(input.displayName, 160);
  const primaryContactName = bounded(input.primaryContactName, 160);
  const locationName = bounded(input.locationName, 160);
  const serviceAddress = bounded(input.serviceAddress, 512);
  const phoneNumber = normalizedPhone(input.phoneNumber);
  const emailAddress = normalizedEmail(input.emailAddress);
  if (
    !customerRef || !locationRef || !displayName || !primaryContactName ||
    !locationName || !serviceAddress || (!phoneNumber && !emailAddress) ||
    (input.phoneNumber && !phoneNumber) || (input.emailAddress && !emailAddress)
  ) return manualReview("invalid_customer");

  const accountId = state.accountId == null
    ? null
    : providerReference(state.accountId);
  const contactId = state.contactId == null
    ? null
    : providerReference(state.contactId);
  const locationId = state.locationId == null
    ? null
    : providerReference(state.locationId);
  if (
    (state.accountId != null && !accountId) ||
    (state.contactId != null && !contactId) ||
    (state.locationId != null && !locationId)
  ) return manualReview("provider_reference_missing");
  if ((!accountId && (contactId || locationId)) || (!contactId && locationId)) {
    return manualReview("provider_state_ambiguous");
  }

  const contactFields = customFieldValues([
    [bindings.contactPhoneFieldId, phoneNumber],
    [bindings.contactEmailFieldId, emailAddress],
  ]);
  let step: string;
  let query: Query;
  if (!accountId) {
    step = "create_account";
    query = {
      createAccount: {
        $: {
          organizationId: authority.providerOrganizationId,
          name: displayName,
          type: "customer",
          notify: false,
          customFieldValues: {
            [bindings.customerReferenceFieldId]: customerRef,
          },
        },
        createdAccount: { id: {}, organization: { id: {} }, type: {} },
      },
    };
  } else if (!state.accountCurrent) {
    step = "update_account";
    query = {
      updateAccount: {
        $: {
          id: accountId,
          name: displayName,
          notify: false,
          customFieldValues: {
            [bindings.customerReferenceFieldId]: customerRef,
          },
        },
        account: { id: {}, organization: { id: {} }, type: {} },
      },
    };
  } else if (!contactId) {
    step = "create_contact";
    query = {
      createContact: {
        $: {
          accountId,
          name: primaryContactName,
          customFieldValues: contactFields,
        },
        createdContact: { id: {}, account: { id: {} } },
      },
    };
  } else if (!state.contactCurrent) {
    step = "update_contact";
    query = {
      updateContact: {
        $: {
          id: contactId,
          name: primaryContactName,
          customFieldValues: contactFields,
        },
        contact: { id: {}, account: { id: {} } },
      },
    };
  } else if (!locationId) {
    step = "create_location";
    query = {
      createLocation: {
        $: {
          accountId,
          contactId,
          name: locationName,
          address: serviceAddress,
          parseAddress: true,
          customFieldValues: {
            [bindings.locationReferenceFieldId]: locationRef,
          },
        },
        createdLocation: { id: {}, account: { id: {} }, contact: { id: {} } },
      },
    };
  } else if (!state.locationCurrent) {
    step = "update_location";
    query = {
      updateLocation: {
        $: {
          id: locationId,
          contactId,
          name: locationName,
          address: serviceAddress,
          customFieldValues: {
            [bindings.locationReferenceFieldId]: locationRef,
          },
        },
        location: { id: {}, account: { id: {} }, contact: { id: {} } },
      },
    };
  } else {
    return { status: "complete", capability: "customer_sync" };
  }

  return {
    status: "ready",
    plan: { capability: "customer_sync", step, mutation: true, query },
  };
}

export function planJobTreadAvailabilityRead(
  authority: JobTreadMappingAuthority,
  input: JobTreadAvailabilityMappingInput,
  pageToken: string | null = null,
): JobTreadMappingResult {
  if (!hasOnlyKeys(input, AVAILABILITY_INPUT_KEYS)) {
    return manualReview("invalid_schedule_range");
  }
  const authorityError = validateAuthority(authority, input.organizationId);
  if (authorityError) return manualReview(authorityError);
  const serviceError = validateServices(authority, input.serviceKeys);
  if (serviceError) return manualReview(serviceError);
  if (
    !validDate(input.startDate) || !validDate(input.endDate) ||
    input.startDate > input.endDate ||
    (pageToken !== null && !bounded(pageToken, 512))
  ) return manualReview("invalid_schedule_range");

  return {
    status: "ready",
    plan: {
      capability: "availability_read",
      step: "read_scheduled_job_tasks",
      mutation: false,
      query: {
        organization: {
          $: { id: authority.providerOrganizationId },
          id: {},
          tasks: {
            $: {
              size: 100,
              ...(pageToken ? { page: pageToken } : {}),
              where: {
                and: [
                  ["startDate", ">=", input.startDate],
                  ["startDate", "<=", input.endDate],
                  ["targetType", "=", "job"],
                  ["isToDo", "=", false],
                ],
              },
              sortBy: [{ field: "startDate" }, { field: "startTime" }],
            },
            nextPage: {},
            nodes: {
              id: {},
              startDate: {},
              startTime: {},
              endDate: {},
              endTime: {},
              progress: {},
              job: { id: {} },
            },
          },
        },
      },
    },
  };
}

function validateBooking(
  authority: JobTreadMappingAuthority,
  input: JobTreadBookingMappingInput,
): JobTreadMappingFailureCode | null {
  const authorityError = validateAuthority(authority, input.organizationId);
  if (authorityError) return authorityError;
  const serviceError = validateServices(authority, input.serviceKeys);
  if (serviceError) return serviceError;
  if (
    !bounded(input.bookingRef, 128) ||
    !validDate(input.startDate) || !validDate(input.endDate) ||
    !validTime(input.startTime) || !validTime(input.endTime) ||
    `${input.startDate}T${input.startTime}` >=
      `${input.endDate}T${input.endTime}`
  ) return "invalid_schedule_range";
  return null;
}

function serviceSummary(serviceKeys: readonly string[]): string {
  return `BluLadder services: ${serviceKeys.join(", ")}`;
}

export function planJobTreadBookingCreateStep(
  authority: JobTreadMappingAuthority,
  bindings: JobTreadCustomFieldBindings,
  input: JobTreadBookingMappingInput,
  state: JobTreadBookingProviderState,
): JobTreadMappingResult {
  if (
    !hasOnlyKeys(input, BOOKING_INPUT_KEYS) ||
    !hasOnlyKeys(state, BOOKING_STATE_KEYS)
  ) return manualReview("invalid_schedule_range");
  const bookingError = validateBooking(authority, input);
  if (bookingError) return manualReview(bookingError);
  const bindingError = validateBindings(bindings);
  if (bindingError) return manualReview(bindingError);

  const locationId = state.locationId == null
    ? null
    : providerReference(state.locationId);
  const jobId = state.jobId == null ? null : providerReference(state.jobId);
  const taskId = state.taskId == null ? null : providerReference(state.taskId);
  if (!locationId) return manualReview("provider_reference_missing");
  if (
    (state.jobId != null && !jobId) ||
    (state.taskId != null && !taskId) ||
    (!jobId && taskId)
  ) return manualReview("provider_state_ambiguous");

  const summary = serviceSummary(input.serviceKeys);
  if (!jobId) {
    return {
      status: "ready",
      plan: {
        capability: "booking_create",
        step: "create_job",
        mutation: true,
        query: {
          createJob: {
            $: {
              locationId,
              name: "BluLadder service",
              description: summary,
              scheduleIsPublished: false,
              customFieldValues: {
                [bindings.bookingReferenceFieldId]: input.bookingRef.trim(),
              },
            },
            createdJob: {
              id: {},
              location: { id: {} },
              organization: { id: {} },
            },
          },
        },
      },
    };
  }
  if (!taskId) {
    return {
      status: "ready",
      plan: {
        capability: "booking_create",
        step: "create_scheduled_task",
        mutation: true,
        query: {
          createTask: {
            $: {
              targetId: jobId,
              targetType: "job",
              name: "BluLadder appointment",
              description: summary,
              startDate: input.startDate,
              startTime: input.startTime,
              endDate: input.endDate,
              endTime: input.endTime,
              notify: false,
            },
            createdTask: {
              id: {},
              job: { id: {} },
              startDate: {},
              startTime: {},
              endDate: {},
              endTime: {},
            },
          },
        },
      },
    };
  }
  return { status: "complete", capability: "booking_create" };
}

export function planJobTreadBookingUpdate(
  authority: JobTreadMappingAuthority,
  input: JobTreadBookingMappingInput,
  state: JobTreadBookingProviderState,
): JobTreadMappingResult {
  if (
    !hasOnlyKeys(input, BOOKING_INPUT_KEYS) ||
    !hasOnlyKeys(state, BOOKING_STATE_KEYS)
  ) return manualReview("invalid_schedule_range");
  const bookingError = validateBooking(authority, input);
  if (bookingError) return manualReview(bookingError);
  const taskId = providerReference(state.taskId);
  if (
    !taskId || !providerReference(state.jobId) ||
    !providerReference(state.locationId)
  ) {
    return manualReview("provider_reference_missing");
  }
  return {
    status: "ready",
    plan: {
      capability: "booking_update",
      step: "update_scheduled_task",
      mutation: true,
      query: {
        updateTask: {
          $: {
            id: taskId,
            name: "BluLadder appointment",
            description: serviceSummary(input.serviceKeys),
            startDate: input.startDate,
            startTime: input.startTime,
            endDate: input.endDate,
            endTime: input.endTime,
            notify: false,
            updateDependentTasks: false,
            updateRecurringTasks: false,
          },
          task: {
            id: {},
            job: { id: {} },
            startDate: {},
            startTime: {},
            endDate: {},
            endTime: {},
          },
        },
      },
    },
  };
}

export function planUnsupportedJobTreadMapping(
  capability: ConnectorCapability,
): JobTreadMappingResult {
  if (
    !(JOBTREAD_BLOCKED_MAPPING_CAPABILITIES as readonly ConnectorCapability[])
      .includes(capability)
  ) return manualReview("provider_state_ambiguous");
  return manualReview("mapping_unsupported");
}
