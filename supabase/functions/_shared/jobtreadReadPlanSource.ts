import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  type JobTreadAvailabilityMappingInput,
  type JobTreadMappingAuthority,
  planJobTreadAvailabilityRead,
  planJobTreadHealthCheck,
} from "./jobtreadBusinessMappings.ts";
import type { JobTreadPreparedPlanSource } from "./jobtreadExecutionRunner.ts";

export const JOBTREAD_READ_PLAN_SOURCE_VERSION = 1;

export type JobTreadReadCapability = "health" | "availability_read";

export interface JobTreadReadExecutionContextStore {
  list(input: {
    organizationId: string;
    capability: JobTreadReadCapability;
    executionReference: string;
  }): Promise<readonly unknown[]>;
}

export interface JobTreadProtectedReadConfigurationResolver {
  resolve(input: {
    organizationId: string;
  }): Promise<unknown>;
}

export interface JobTreadReadPlanSourceDependencies {
  contexts: JobTreadReadExecutionContextStore;
  configuration: JobTreadProtectedReadConfigurationResolver;
  now?: () => Date;
}

interface ReadConfiguration {
  organizationId: string;
  providerOrganizationId: string;
  allowedServiceKeys: string[];
  configurationVersion: number;
}

interface HealthContext {
  organizationId: string;
  capability: "health";
  executionReference: string;
  configurationVersion: number;
  expiresAt: string;
}

interface AvailabilityContext {
  organizationId: string;
  capability: "availability_read";
  executionReference: string;
  configurationVersion: number;
  serviceKeys: string[];
  startDate: string;
  endDate: string;
  expiresAt: string;
}

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
]);
const HEALTH_CONTEXT_KEYS = new Set([
  "organizationId",
  "capability",
  "executionReference",
  "configurationVersion",
  "expiresAt",
]);
const AVAILABILITY_CONTEXT_KEYS = new Set([
  ...HEALTH_CONTEXT_KEYS,
  "serviceKeys",
  "startDate",
  "endDate",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key));
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function executionReference(value: unknown): string | null {
  return typeof value === "string" && EXECUTION_REFERENCE_PATTERN.test(value)
    ? value
    : null;
}

function providerReference(value: unknown): string | null {
  return typeof value === "string" && PROVIDER_REFERENCE_PATTERN.test(value)
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

function parseConfiguration(
  value: unknown,
  expectedOrganizationId: string,
): ReadConfiguration | null {
  if (!isRecord(value) || !exactKeys(value, CONFIGURATION_KEYS)) return null;
  const organizationId = uuid(value.organizationId);
  const providerOrganizationId = providerReference(
    value.providerOrganizationId,
  );
  const allowedServiceKeys = serviceKeys(value.allowedServiceKeys);
  const version = configurationVersion(value.configurationVersion);
  if (
    !organizationId || organizationId !== expectedOrganizationId ||
    !providerOrganizationId || !allowedServiceKeys || !version
  ) return null;
  return {
    organizationId,
    providerOrganizationId,
    allowedServiceKeys,
    configurationVersion: version,
  };
}

function parseHealthContext(
  value: unknown,
  request: {
    organizationId: string;
    capability: "health";
    executionReference: string;
  },
  now: Date,
): HealthContext | null {
  if (!isRecord(value) || !exactKeys(value, HEALTH_CONTEXT_KEYS)) return null;
  const organizationId = uuid(value.organizationId);
  const reference = executionReference(value.executionReference);
  const version = configurationVersion(value.configurationVersion);
  const expiresAt = shortLivedExpiration(value.expiresAt, now);
  if (
    organizationId !== request.organizationId ||
    value.capability !== request.capability ||
    reference !== request.executionReference || !version || !expiresAt
  ) return null;
  return {
    organizationId,
    capability: "health",
    executionReference: reference,
    configurationVersion: version,
    expiresAt,
  };
}

function parseAvailabilityContext(
  value: unknown,
  request: {
    organizationId: string;
    capability: "availability_read";
    executionReference: string;
  },
  now: Date,
): AvailabilityContext | null {
  if (!isRecord(value) || !exactKeys(value, AVAILABILITY_CONTEXT_KEYS)) {
    return null;
  }
  const organizationId = uuid(value.organizationId);
  const reference = executionReference(value.executionReference);
  const version = configurationVersion(value.configurationVersion);
  const normalizedServiceKeys = serviceKeys(value.serviceKeys);
  const expiresAt = shortLivedExpiration(value.expiresAt, now);
  if (
    organizationId !== request.organizationId ||
    value.capability !== request.capability ||
    reference !== request.executionReference || !version ||
    !normalizedServiceKeys || !expiresAt ||
    typeof value.startDate !== "string" ||
    typeof value.endDate !== "string"
  ) return null;
  return {
    organizationId,
    capability: "availability_read",
    executionReference: reference,
    configurationVersion: version,
    serviceKeys: normalizedServiceKeys,
    startDate: value.startDate,
    endDate: value.endDate,
    expiresAt,
  };
}

function readCapability(
  value: ConnectorCapability,
): value is JobTreadReadCapability {
  return value === "health" || value === "availability_read";
}

/**
 * Composes one protected read plan from one exact server-owned context and one
 * exact protected configuration. It resolves no credential, performs no
 * provider request, emits no mutation, and is not imported by production.
 */
export function createJobTreadReadPlanSource(
  dependencies: JobTreadReadPlanSourceDependencies,
): JobTreadPreparedPlanSource {
  return {
    async load(request) {
      const organizationId = uuid(request.organizationId);
      const reference = executionReference(request.executionReference);
      if (
        !organizationId || !reference || !readCapability(request.capability)
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
        const protectedConfiguration = parseConfiguration(
          await dependencies.configuration.resolve({ organizationId }),
          organizationId,
        );
        if (!protectedConfiguration) return null;

        const authority: JobTreadMappingAuthority = {
          organizationId,
          providerOrganizationId: protectedConfiguration.providerOrganizationId,
          allowedServiceKeys: protectedConfiguration.allowedServiceKeys,
        };
        if (request.capability === "health") {
          const context = parseHealthContext(
            contexts[0],
            boundedRequest as typeof boundedRequest & { capability: "health" },
            now,
          );
          if (
            !context ||
            context.configurationVersion !==
              protectedConfiguration.configurationVersion
          ) return null;
          const planned = planJobTreadHealthCheck(authority);
          return planned.status === "ready"
            ? {
              plan: planned.plan,
              providerOrganizationId:
                protectedConfiguration.providerOrganizationId,
              configurationVersion: context.configurationVersion,
              expectedLineage: {},
            }
            : null;
        }

        const context = parseAvailabilityContext(
          contexts[0],
          boundedRequest as typeof boundedRequest & {
            capability: "availability_read";
          },
          now,
        );
        if (
          !context ||
          context.configurationVersion !==
            protectedConfiguration.configurationVersion
        ) return null;
        const mappingInput: JobTreadAvailabilityMappingInput = {
          organizationId,
          serviceKeys: context.serviceKeys,
          startDate: context.startDate,
          endDate: context.endDate,
        };
        const planned = planJobTreadAvailabilityRead(authority, mappingInput);
        return planned.status === "ready"
          ? {
            plan: planned.plan,
            providerOrganizationId:
              protectedConfiguration.providerOrganizationId,
            configurationVersion: context.configurationVersion,
            expectedLineage: {},
          }
          : null;
      } catch {
        return null;
      }
    },
  };
}
