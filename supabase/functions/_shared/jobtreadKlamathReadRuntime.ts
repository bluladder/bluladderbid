import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  createJobTreadExecutionRunner,
  type JobTreadConnectorStore,
  type JobTreadExecutionResult,
  type JobTreadOperationAttemptStore,
  type JobTreadProtectedCredentialResolver,
  type JobTreadRunnerTransport,
} from "./jobtreadExecutionRunner.ts";
import {
  createKlamathJobTreadProtectedResolvers,
  type JobTreadEnvironmentReader,
  KLAMATH_JOBTREAD_ALLOWED_SERVICE_KEYS,
  KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
  KLAMATH_JOBTREAD_ORGANIZATION_ID,
} from "./jobtreadKlamathProtectedConfiguration.ts";
import {
  executeJobTreadPave,
  type JobTreadPaveResult,
} from "./jobtreadPaveClient.ts";
import {
  createJobTreadReadPlanSource,
  type JobTreadProtectedReadConfigurationResolver,
} from "./jobtreadReadPlanSource.ts";
import { createJobTreadPhase1IStores } from "./jobtreadPhase1IStores.ts";

export const KLAMATH_JOBTREAD_READ_RUNTIME_VERSION = 1;
export const KLAMATH_JOBTREAD_READ_RUNTIME_FLAG =
  "JOBTREAD_KLAMATH_READ_RUNTIME_ENABLED";

const EXECUTION_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AVAILABILITY_WINDOW_DAYS = 31;
const CONTEXT_LIFETIME_MS = 60_000;
const ALLOWED_SERVICE_KEYS = new Set<string>(
  KLAMATH_JOBTREAD_ALLOWED_SERVICE_KEYS,
);

export type KlamathJobTreadReadRuntimeRequest =
  | {
    capability: "health";
    executionReference: string;
  }
  | {
    capability: "availability_read";
    executionReference: string;
    serviceKeys: string[];
    startDate: string;
    endDate: string;
  };

export interface KlamathJobTreadReadRuntimeDependencies {
  readEnvironment: JobTreadEnvironmentReader;
  connectors: JobTreadConnectorStore;
  attempts: JobTreadOperationAttemptStore;
  credentials: JobTreadProtectedCredentialResolver;
  configuration: JobTreadProtectedReadConfigurationResolver;
  transport: JobTreadRunnerTransport;
  now?: () => Date;
}

export interface KlamathJobTreadReadRuntimeProductionOptions {
  readEnvironment?: JobTreadEnvironmentReader;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function validAvailabilityWindow(startDate: string, endDate: string): boolean {
  const start = new Date(`${startDate}T00:00:00.000Z`).valueOf();
  const end = new Date(`${endDate}T00:00:00.000Z`).valueOf();
  const durationDays = (end - start) / 86_400_000;
  return durationDays >= 0 && durationDays <= MAX_AVAILABILITY_WINDOW_DAYS;
}

function validServiceKeys(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 4 &&
    new Set(value).size === value.length &&
    value.every((item) =>
      typeof item === "string" && ALLOWED_SERVICE_KEYS.has(item)
    );
}

export function parseKlamathJobTreadReadRuntimeRequest(
  value: unknown,
): KlamathJobTreadReadRuntimeRequest | null {
  if (!isRecord(value)) return null;
  const executionReference = value.executionReference;
  if (
    typeof executionReference !== "string" ||
    !EXECUTION_REFERENCE_PATTERN.test(executionReference)
  ) return null;

  if (value.capability === "health") {
    return hasExactKeys(value, ["capability", "executionReference"])
      ? { capability: "health", executionReference }
      : null;
  }

  if (
    value.capability !== "availability_read" ||
    !hasExactKeys(value, [
      "capability",
      "executionReference",
      "serviceKeys",
      "startDate",
      "endDate",
    ]) ||
    !validServiceKeys(value.serviceKeys) ||
    !validDate(value.startDate) ||
    !validDate(value.endDate) ||
    !validAvailabilityWindow(value.startDate, value.endDate)
  ) return null;

  return {
    capability: "availability_read",
    executionReference,
    serviceKeys: [...value.serviceKeys],
    startDate: value.startDate,
    endDate: value.endDate,
  };
}

function baseFailure(
  capability: ConnectorCapability,
  code: "connector_inactive" | "provider_rejected",
): JobTreadExecutionResult {
  return {
    status: "manual_review",
    code,
    retryable: false,
    audit: {
      organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
      connectorId: null,
      capability,
      configurationVersion: null,
      requestFingerprint: null,
      idempotencyKeyHash: null,
      attemptNumber: null,
      outcomeUncertain: false,
    },
  };
}

function readContext(
  request: KlamathJobTreadReadRuntimeRequest,
  now: Date,
): Record<string, unknown> {
  const base = {
    organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
    capability: request.capability,
    executionReference: request.executionReference,
    configurationVersion: KLAMATH_JOBTREAD_CONFIGURATION_VERSION,
    expiresAt: new Date(now.valueOf() + CONTEXT_LIFETIME_MS).toISOString(),
  };
  return request.capability === "health" ? base : {
    ...base,
    serviceKeys: [...request.serviceKeys],
    startDate: request.startDate,
    endDate: request.endDate,
  };
}

export function createReadOnlyJobTreadTransport(
  fetchImpl: typeof fetch = fetch,
): JobTreadRunnerTransport {
  return {
    execute(input) {
      if (input.mutation) {
        return Promise.resolve(
          {
            status: "error",
            code: "invalid_query",
            retryable: false,
            outcomeUncertain: false,
            httpStatus: null,
          } satisfies JobTreadPaveResult<never>,
        );
      }
      return executeJobTreadPave<Record<string, unknown>>({
        grantKey: input.grantKey,
        query: input.query,
        mutation: false,
        fetchImpl,
      });
    },
  };
}

/**
 * Creates the Klamath-only read boundary. The dedicated flag is checked before
 * connector, protected configuration, credential, or transport access. Even
 * when the flag is true, the existing runner still requires one active,
 * runtime-enabled connector with exact configuration and organization lineage.
 */
export function createKlamathJobTreadReadRuntime(
  dependencies: KlamathJobTreadReadRuntimeDependencies,
): (request: unknown) => Promise<JobTreadExecutionResult> {
  return async (rawRequest) => {
    const request = parseKlamathJobTreadReadRuntimeRequest(rawRequest);
    if (!request) return baseFailure("health", "provider_rejected");
    if (
      dependencies.readEnvironment(KLAMATH_JOBTREAD_READ_RUNTIME_FLAG) !==
        "true"
    ) return baseFailure(request.capability, "connector_inactive");

    const now = dependencies.now?.() ?? new Date();
    if (Number.isNaN(now.valueOf())) {
      return baseFailure(request.capability, "provider_rejected");
    }
    const context = readContext(request, now);
    const plans = createJobTreadReadPlanSource({
      contexts: {
        list(input) {
          if (
            input.organizationId !== KLAMATH_JOBTREAD_ORGANIZATION_ID ||
            input.capability !== request.capability ||
            input.executionReference !== request.executionReference
          ) return Promise.resolve([]);
          return Promise.resolve([context]);
        },
      },
      configuration: dependencies.configuration,
      now: () => now,
    });
    const run = createJobTreadExecutionRunner({
      connectors: dependencies.connectors,
      plans,
      credentials: dependencies.credentials,
      attempts: dependencies.attempts,
      transport: dependencies.transport,
    });
    return await run({
      organizationId: KLAMATH_JOBTREAD_ORGANIZATION_ID,
      capability: request.capability,
      executionReference: request.executionReference,
    });
  };
}

/** Production wiring only; it performs no request until the returned function is called. */
export function createProductionKlamathJobTreadReadRuntime(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  options: KlamathJobTreadReadRuntimeProductionOptions = {},
): (request: unknown) => Promise<JobTreadExecutionResult> {
  const readEnvironment = options.readEnvironment ??
    ((key: string) => Deno.env.get(key));
  const protectedResolvers = createKlamathJobTreadProtectedResolvers(
    readEnvironment,
  );
  const stores = createJobTreadPhase1IStores(supabase);
  return createKlamathJobTreadReadRuntime({
    readEnvironment,
    connectors: stores.connectors,
    attempts: stores.attempts,
    credentials: protectedResolvers.credentials,
    configuration: protectedResolvers.readConfiguration,
    transport: createReadOnlyJobTreadTransport(options.fetchImpl),
    now: options.now,
  });
}
