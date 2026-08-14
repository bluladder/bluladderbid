import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  type JobTreadBookingMappingInput,
  type JobTreadBookingProviderState,
  type JobTreadCustomerMappingInput,
  type JobTreadCustomerProviderState,
  type JobTreadCustomFieldBindings,
  type JobTreadMappingAuthority,
  type JobTreadQueryPlan,
  planJobTreadBookingCreateStep,
  planJobTreadBookingUpdate,
  planJobTreadCustomerSyncStep,
} from "./jobtreadBusinessMappings.ts";
import type { JobTreadPreparedPlanSource } from "./jobtreadExecutionRunner.ts";

export const JOBTREAD_WRITE_PLAN_SOURCE_VERSION = 1;

export type JobTreadWriteCapability =
  | "customer_sync"
  | "booking_create"
  | "booking_update";

export interface JobTreadWriteExecutionContextStore {
  list(input: {
    organizationId: string;
    capability: JobTreadWriteCapability;
    executionReference: string;
  }): Promise<readonly unknown[]>;
}

export interface JobTreadProtectedWriteConfigurationResolver {
  resolve(input: { organizationId: string }): Promise<unknown>;
}

export interface JobTreadWritePlanSourceDependencies {
  contexts: JobTreadWriteExecutionContextStore;
  configuration: JobTreadProtectedWriteConfigurationResolver;
  now?: () => Date;
}

interface WriteConfiguration {
  organizationId: string;
  providerOrganizationId: string;
  allowedServiceKeys: string[];
  configurationVersion: number;
  bindings: JobTreadCustomFieldBindings;
}

interface CustomerContext {
  organizationId: string;
  capability: "customer_sync";
  executionReference: string;
  configurationVersion: number;
  expiresAt: string;
  input: JobTreadCustomerMappingInput;
  state: JobTreadCustomerProviderState;
}

interface BookingContext {
  organizationId: string;
  capability: "booking_create" | "booking_update";
  executionReference: string;
  configurationVersion: number;
  expiresAt: string;
  input: JobTreadBookingMappingInput;
  state: JobTreadBookingProviderState;
}

type ExpectedLineage = {
  accountId?: string;
  contactId?: string;
  locationId?: string;
  jobId?: string;
  taskId?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EXECUTION_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SERVICE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const CONFIGURATION_KEYS = new Set([
  "organizationId",
  "providerOrganizationId",
  "allowedServiceKeys",
  "configurationVersion",
  "bindings",
]);
const BINDING_KEYS = new Set([
  "customerReferenceFieldId",
  "contactPhoneFieldId",
  "contactEmailFieldId",
  "locationReferenceFieldId",
  "bookingReferenceFieldId",
]);
const CONTEXT_KEYS = new Set([
  "organizationId",
  "capability",
  "executionReference",
  "configurationVersion",
  "expiresAt",
  "input",
  "state",
]);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key));
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function providerReference(value: unknown): string | null {
  return typeof value === "string" && PROVIDER_REFERENCE_PATTERN.test(value)
    ? value
    : null;
}

function executionReference(value: unknown): string | null {
  return typeof value === "string" && EXECUTION_REFERENCE_PATTERN.test(value)
    ? value
    : null;
}

function configurationVersion(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function shortLivedExpiration(value: unknown, now: Date): string | null {
  if (
    typeof value !== "string" || value.length > 64 ||
    Number.isNaN(now.valueOf())
  ) return null;
  const parsed = new Date(value);
  const lifetime = parsed.valueOf() - now.valueOf();
  return !Number.isNaN(parsed.valueOf()) && lifetime > 0 && lifetime <= 300_000
    ? parsed.toISOString()
    : null;
}

function serviceKeys(value: unknown): string[] | null {
  if (
    !Array.isArray(value) || value.length === 0 || value.length > 16 ||
    value.some((item) =>
      typeof item !== "string" || !SERVICE_KEY_PATTERN.test(item)
    ) || new Set(value).size !== value.length
  ) return null;
  return [...value];
}

function parseBindings(value: unknown): JobTreadCustomFieldBindings | null {
  if (!isRecord(value) || !exactKeys(value, BINDING_KEYS)) return null;
  const entries = Object.entries(value).map(([key, raw]) =>
    [
      key,
      providerReference(raw),
    ] as const
  );
  if (entries.some(([, normalized]) => !normalized)) return null;
  return Object.fromEntries(entries) as unknown as JobTreadCustomFieldBindings;
}

function parseConfiguration(
  value: unknown,
  expectedOrganizationId: string,
): WriteConfiguration | null {
  if (!isRecord(value) || !exactKeys(value, CONFIGURATION_KEYS)) return null;
  const organizationId = uuid(value.organizationId);
  const providerOrganizationId = providerReference(
    value.providerOrganizationId,
  );
  const allowedServiceKeys = serviceKeys(value.allowedServiceKeys);
  const version = configurationVersion(value.configurationVersion);
  const bindings = parseBindings(value.bindings);
  if (
    organizationId !== expectedOrganizationId || !providerOrganizationId ||
    !allowedServiceKeys || !version || !bindings
  ) return null;
  return {
    organizationId,
    providerOrganizationId,
    allowedServiceKeys,
    configurationVersion: version,
    bindings,
  };
}

function parseContextBase(
  value: unknown,
  request: {
    organizationId: string;
    capability: JobTreadWriteCapability;
    executionReference: string;
  },
  now: Date,
): Record<string, unknown> | null {
  if (!isRecord(value) || !exactKeys(value, CONTEXT_KEYS)) return null;
  const organizationId = uuid(value.organizationId);
  const reference = executionReference(value.executionReference);
  const version = configurationVersion(value.configurationVersion);
  const expiresAt = shortLivedExpiration(value.expiresAt, now);
  if (
    organizationId !== request.organizationId ||
    value.capability !== request.capability ||
    reference !== request.executionReference || !version || !expiresAt ||
    !isRecord(value.input) || !isRecord(value.state)
  ) return null;
  return {
    organizationId,
    capability: request.capability,
    executionReference: reference,
    configurationVersion: version,
    expiresAt,
    input: value.input,
    state: value.state,
  };
}

function writeCapability(
  value: ConnectorCapability,
): value is JobTreadWriteCapability {
  return value === "customer_sync" || value === "booking_create" ||
    value === "booking_update";
}

function exactCustomerContext(
  value: unknown,
): value is CustomerContext {
  return isRecord(value) && isRecord(value.input) &&
    exactKeys(value.input, CUSTOMER_INPUT_KEYS) &&
    isRecord(value.state) && exactKeys(value.state, CUSTOMER_STATE_KEYS);
}

function exactBookingContext(
  value: unknown,
): value is BookingContext {
  return isRecord(value) && isRecord(value.input) &&
    exactKeys(value.input, BOOKING_INPUT_KEYS) &&
    isRecord(value.state) && exactKeys(value.state, BOOKING_STATE_KEYS);
}

function customerLineage(
  plan: JobTreadQueryPlan,
  state: JobTreadCustomerProviderState,
): ExpectedLineage | null {
  const accountId = state.accountId == null
    ? null
    : providerReference(state.accountId);
  const contactId = state.contactId == null
    ? null
    : providerReference(state.contactId);
  const locationId = state.locationId == null
    ? null
    : providerReference(state.locationId);
  switch (plan.step) {
    case "create_account":
      return {};
    case "update_account":
    case "create_contact":
      return accountId ? { accountId } : null;
    case "update_contact":
    case "create_location":
      return accountId && contactId ? { accountId, contactId } : null;
    case "update_location":
      return accountId && contactId && locationId
        ? { accountId, contactId, locationId }
        : null;
    default:
      return null;
  }
}

function bookingLineage(
  plan: JobTreadQueryPlan,
  state: JobTreadBookingProviderState,
): ExpectedLineage | null {
  const locationId = state.locationId == null
    ? null
    : providerReference(state.locationId);
  const jobId = state.jobId == null ? null : providerReference(state.jobId);
  const taskId = state.taskId == null ? null : providerReference(state.taskId);
  if (plan.step === "create_job") {
    return locationId ? { locationId } : null;
  }
  if (plan.step === "create_scheduled_task") {
    return jobId ? { jobId } : null;
  }
  if (plan.step === "update_scheduled_task") {
    return jobId && taskId ? { jobId, taskId } : null;
  }
  return null;
}

/**
 * Produces only an already-reviewed mutation plan from protected dependencies.
 * It resolves no Grant Key, performs no transport, claims no attempt, retries
 * nothing, and is not imported by production.
 */
export function createJobTreadWritePlanSource(
  dependencies: JobTreadWritePlanSourceDependencies,
): JobTreadPreparedPlanSource {
  return {
    async load(request) {
      const organizationId = uuid(request.organizationId);
      const reference = executionReference(request.executionReference);
      if (
        !organizationId || !reference || !writeCapability(request.capability)
      ) return null;
      const boundedRequest = {
        organizationId,
        capability: request.capability,
        executionReference: reference,
      };

      try {
        const now = dependencies.now?.() ?? new Date();
        if (Number.isNaN(now.valueOf())) return null;
        const contexts = await dependencies.contexts.list(boundedRequest);
        if (!Array.isArray(contexts) || contexts.length !== 1) return null;
        const context = parseContextBase(contexts[0], boundedRequest, now);
        if (!context) return null;
        const protectedConfiguration = parseConfiguration(
          await dependencies.configuration.resolve({ organizationId }),
          organizationId,
        );
        if (
          !protectedConfiguration ||
          context.configurationVersion !==
            protectedConfiguration.configurationVersion
        ) return null;
        const authority: JobTreadMappingAuthority = {
          organizationId,
          providerOrganizationId: protectedConfiguration.providerOrganizationId,
          allowedServiceKeys: protectedConfiguration.allowedServiceKeys,
        };

        let planned;
        let expectedLineage: ExpectedLineage | null;
        if (request.capability === "customer_sync") {
          if (!exactCustomerContext(context)) return null;
          const customerContext = context;
          planned = planJobTreadCustomerSyncStep(
            authority,
            protectedConfiguration.bindings,
            customerContext.input,
            customerContext.state,
          );
          expectedLineage = planned.status === "ready"
            ? customerLineage(planned.plan, customerContext.state)
            : null;
        } else if (request.capability === "booking_create") {
          if (!exactBookingContext(context)) return null;
          const bookingContext = context;
          planned = planJobTreadBookingCreateStep(
            authority,
            protectedConfiguration.bindings,
            bookingContext.input,
            bookingContext.state,
          );
          expectedLineage = planned.status === "ready"
            ? bookingLineage(planned.plan, bookingContext.state)
            : null;
        } else {
          if (!exactBookingContext(context)) return null;
          const bookingContext = context;
          planned = planJobTreadBookingUpdate(
            authority,
            bookingContext.input,
            bookingContext.state,
          );
          expectedLineage = planned.status === "ready"
            ? bookingLineage(planned.plan, bookingContext.state)
            : null;
        }
        if (planned.status !== "ready" || !expectedLineage) return null;
        return {
          plan: planned.plan,
          providerOrganizationId: protectedConfiguration.providerOrganizationId,
          configurationVersion: protectedConfiguration.configurationVersion,
          expectedLineage,
        };
      } catch {
        return null;
      }
    },
  };
}
