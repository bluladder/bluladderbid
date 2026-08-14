import type { ConnectorCapability } from "./connectorContracts.ts";
import {
  createJobTreadExecutionRunner,
  type JobTreadExecutionRequest,
  type JobTreadExecutionResult,
  type JobTreadExecutionRunnerDependencies,
  type JobTreadPreparedPlanSource,
} from "./jobtreadExecutionRunner.ts";
import {
  createJobTreadReadPlanSource,
  type JobTreadReadPlanSourceDependencies,
} from "./jobtreadReadPlanSource.ts";
import {
  createJobTreadWritePlanSource,
  type JobTreadWritePlanSourceDependencies,
} from "./jobtreadWritePlanSource.ts";

export const JOBTREAD_EXECUTION_COMPOSITION_VERSION = 1;

const READ_CAPABILITIES = new Set<ConnectorCapability>([
  "health",
  "availability_read",
]);
const WRITE_CAPABILITIES = new Set<ConnectorCapability>([
  "customer_sync",
  "booking_create",
  "booking_update",
]);

export interface JobTreadPreparedPlanRouterSources {
  read: JobTreadPreparedPlanSource;
  write: JobTreadPreparedPlanSource;
}

export interface JobTreadDormantExecutionDependencies {
  runner: Omit<JobTreadExecutionRunnerDependencies, "plans">;
  readPlans: JobTreadReadPlanSourceDependencies;
  writePlans: JobTreadWritePlanSourceDependencies;
}

/**
 * Routes only the five reviewed first-wave capabilities. Blocked or malformed
 * capabilities never reach either protected source. Dependency failures are
 * redacted to a missing plan so the runner fails closed before credential or
 * transport work.
 */
export function createJobTreadPreparedPlanRouter(
  sources: JobTreadPreparedPlanRouterSources,
): JobTreadPreparedPlanSource {
  return {
    async load(request) {
      try {
        if (READ_CAPABILITIES.has(request.capability)) {
          return await sources.read.load(request);
        }
        if (WRITE_CAPABILITIES.has(request.capability)) {
          return await sources.write.load(request);
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Composes the reviewed read/write sources with the single-attempt runner.
 * No production Edge entry point imports this factory. All database, secret,
 * provider, and transport effects remain injected and unreachable by default.
 */
export function createJobTreadDormantExecution(
  dependencies: JobTreadDormantExecutionDependencies,
): (request: JobTreadExecutionRequest) => Promise<JobTreadExecutionResult> {
  const plans = createJobTreadPreparedPlanRouter({
    read: createJobTreadReadPlanSource(dependencies.readPlans),
    write: createJobTreadWritePlanSource(dependencies.writePlans),
  });
  return createJobTreadExecutionRunner({
    ...dependencies.runner,
    plans,
  });
}
