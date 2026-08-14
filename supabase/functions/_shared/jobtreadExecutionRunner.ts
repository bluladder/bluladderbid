import type {
  ConnectorCapability,
  ConnectorFailureCode,
} from "./connectorContracts.ts";
import type { JobTreadQueryPlan } from "./jobtreadBusinessMappings.ts";
import type { JobTreadPaveResult } from "./jobtreadPaveClient.ts";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const JOBTREAD_EXECUTION_RUNNER_VERSION = 1;

export const JOBTREAD_EXECUTABLE_STEPS = {
  grant_membership_read: {
    capability: "health",
    mutation: false,
    roots: ["currentGrant", "version"],
  },
  lookup_by_external_reference: {
    capability: "customer_sync",
    mutation: false,
    roots: ["organization"],
  },
  create_account: {
    capability: "customer_sync",
    mutation: true,
    roots: ["createAccount"],
  },
  update_account: {
    capability: "customer_sync",
    mutation: true,
    roots: ["updateAccount"],
  },
  create_contact: {
    capability: "customer_sync",
    mutation: true,
    roots: ["createContact"],
  },
  update_contact: {
    capability: "customer_sync",
    mutation: true,
    roots: ["updateContact"],
  },
  create_location: {
    capability: "customer_sync",
    mutation: true,
    roots: ["createLocation"],
  },
  update_location: {
    capability: "customer_sync",
    mutation: true,
    roots: ["updateLocation"],
  },
  read_scheduled_job_tasks: {
    capability: "availability_read",
    mutation: false,
    roots: ["organization"],
  },
  create_job: {
    capability: "booking_create",
    mutation: true,
    roots: ["createJob"],
  },
  create_scheduled_task: {
    capability: "booking_create",
    mutation: true,
    roots: ["createTask"],
  },
  update_scheduled_task: {
    capability: "booking_update",
    mutation: true,
    roots: ["updateTask"],
  },
} as const;

type JobTreadExecutableStep = keyof typeof JOBTREAD_EXECUTABLE_STEPS;

export interface JobTreadConnectorRecord {
  id: string;
  organizationId: string;
  provider: "jobtread";
  status: "active" | "inactive" | "degraded";
  capabilities: readonly ConnectorCapability[];
  credentialReference: string | null;
  providerOrganizationFingerprint: string | null;
  configurationVersion: number;
  runtimeEnabled: boolean;
}

export interface JobTreadConnectorStore {
  listForOrganization(
    organizationId: string,
  ): Promise<readonly JobTreadConnectorRecord[]>;
}

/**
 * The plan source is a protected server-owned dependency. Public callers can
 * choose only an opaque internal execution reference, not a provider
 * organization, provider record, query root, mutation, or retry policy.
 */
export interface JobTreadPreparedPlanSource {
  load(input: {
    organizationId: string;
    capability: ConnectorCapability;
    executionReference: string;
  }): Promise<
    {
      plan: JobTreadQueryPlan;
      providerOrganizationId: string;
      configurationVersion: number;
      expectedLineage: {
        accountId?: string;
        contactId?: string;
        locationId?: string;
        jobId?: string;
        taskId?: string;
      };
    } | null
  >;
}

export interface JobTreadProtectedCredentialResolver {
  resolve(credentialReference: string): Promise<string | null>;
}

export interface JobTreadOperationAttemptClaim {
  organizationId: string;
  connectorId: string;
  operation: ConnectorCapability;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  attemptNumber: 1;
}

export type JobTreadAttemptClaimResult =
  | { status: "claimed"; attemptId: string }
  | { status: "duplicate" | "conflict" | "in_progress" };

export interface JobTreadOperationAttemptStore {
  claim(
    input: JobTreadOperationAttemptClaim,
  ): Promise<JobTreadAttemptClaimResult>;
  completeSucceeded(input: {
    attemptId: string;
    providerReferenceHash: string | null;
  }): Promise<void>;
  completeManualReview(input: {
    attemptId: string;
    failureCode: Extract<
      ConnectorFailureCode,
      | "credential_reference_missing"
      | "provider_unavailable"
      | "provider_rejected"
      | "retry_exhausted"
    >;
    outcomeUncertain: boolean;
  }): Promise<void>;
}

export interface JobTreadRunnerTransport {
  execute(input: {
    grantKey: string;
    query: Record<string, unknown>;
    mutation: boolean;
  }): Promise<JobTreadPaveResult<Record<string, unknown>>>;
}

export interface JobTreadExecutionRequest {
  organizationId: string;
  capability: ConnectorCapability;
  executionReference: string;
  idempotencyKey?: string | null;
}

export interface JobTreadExecutionAudit {
  organizationId: string;
  connectorId: string | null;
  capability: ConnectorCapability;
  configurationVersion: number | null;
  requestFingerprint: string | null;
  idempotencyKeyHash: string | null;
  attemptNumber: 1 | null;
  outcomeUncertain: boolean;
}

export interface JobTreadSanitizedOutcome {
  step: JobTreadExecutableStep;
  recordCount: number | null;
  nextPagePresent: boolean;
}

export type JobTreadExecutionResult =
  | {
    status: "ok";
    value: JobTreadSanitizedOutcome;
    audit: JobTreadExecutionAudit;
  }
  | {
    status: "manual_review";
    code: ConnectorFailureCode;
    retryable: boolean;
    audit: JobTreadExecutionAudit;
  };

export interface JobTreadExecutionRunnerDependencies {
  connectors: JobTreadConnectorStore;
  plans: JobTreadPreparedPlanSource;
  credentials: JobTreadProtectedCredentialResolver;
  attempts: JobTreadOperationAttemptStore;
  transport: JobTreadRunnerTransport;
}

interface ValidatedProviderResponse {
  outcome: JobTreadSanitizedOutcome;
  providerReference: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function providerReference(value: unknown): string | null {
  const normalized = bounded(value, 128);
  return normalized && PROVIDER_REFERENCE_PATTERN.test(normalized)
    ? normalized
    : null;
}

function containsForbiddenQueryMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenQueryMaterial);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    key.toLowerCase() === "grantkey" ||
    [
      "deleteTask",
      "createDocument",
      "createDailyLog",
      "createFile",
      "sendDocument",
    ].includes(key) || containsForbiddenQueryMaterial(child)
  );
}

function normalizeJson(value: unknown): JsonValue {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (!isRecord(value)) throw new Error("non_json_value");
  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new Error("non_json_value");
    normalized[key] = normalizeJson(value[key]);
  }
  return normalized;
}

export function canonicalJobTreadJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function planContract(plan: JobTreadQueryPlan):
  | { step: JobTreadExecutableStep; mutation: boolean }
  | null {
  if (
    !isRecord(plan) ||
    Object.keys(plan).sort().join(",") !== "capability,mutation,query,step" ||
    typeof plan.step !== "string" ||
    !Object.prototype.hasOwnProperty.call(JOBTREAD_EXECUTABLE_STEPS, plan.step)
  ) return null;
  const step = plan.step as JobTreadExecutableStep;
  const contract = JOBTREAD_EXECUTABLE_STEPS[step];
  if (
    plan.capability !== contract.capability ||
    plan.mutation !== contract.mutation ||
    !isRecord(plan.query) ||
    Object.keys(plan.query).sort().join(",") !==
      [...contract.roots].sort().join(",") ||
    Object.prototype.hasOwnProperty.call(plan.query, "$") ||
    containsForbiddenQueryMaterial(plan.query)
  ) return null;
  return { step, mutation: contract.mutation };
}

function queryProviderOrganization(
  step: JobTreadExecutableStep,
  query: JsonRecord,
): string | null {
  if (
    step === "lookup_by_external_reference" ||
    step === "read_scheduled_job_tasks"
  ) {
    return providerReference(valueAt(query, "organization", "$", "id"));
  }
  if (step === "create_account") {
    return providerReference(
      valueAt(query, "createAccount", "$", "organizationId"),
    );
  }
  return null;
}

function validatePlanLineage(
  step: JobTreadExecutableStep,
  plan: JobTreadQueryPlan,
  expectedLineage: {
    accountId?: string;
    contactId?: string;
    locationId?: string;
    jobId?: string;
    taskId?: string;
  },
): boolean {
  if (
    !isRecord(expectedLineage) ||
    Object.keys(expectedLineage).some((key) =>
      !["accountId", "contactId", "locationId", "jobId", "taskId"].includes(
        key,
      )
    ) ||
    Object.values(expectedLineage).some((value) => !providerReference(value))
  ) {
    return false;
  }
  const expectedAccount = providerReference(expectedLineage.accountId);
  const expectedContact = providerReference(expectedLineage.contactId);
  const expectedLocation = providerReference(expectedLineage.locationId);
  const expectedJob = providerReference(expectedLineage.jobId);
  const expectedTask = providerReference(expectedLineage.taskId);
  const lineageKeys = Object.keys(expectedLineage).sort().join(",");
  if (
    step === "grant_membership_read" ||
    step === "lookup_by_external_reference" ||
    step === "read_scheduled_job_tasks"
  ) return lineageKeys === "";
  if (step === "create_account") {
    return lineageKeys === "" &&
      valueAt(plan.query, "createAccount", "$", "type") === "customer" &&
      valueAt(plan.query, "createAccount", "$", "notify") === false;
  }
  if (step === "update_account") {
    return lineageKeys === "accountId" && !!expectedAccount &&
      valueAt(plan.query, "updateAccount", "$", "id") === expectedAccount &&
      valueAt(plan.query, "updateAccount", "$", "notify") === false;
  }
  if (step === "create_contact") {
    return lineageKeys === "accountId" && !!expectedAccount &&
      valueAt(plan.query, "createContact", "$", "accountId") ===
        expectedAccount;
  }
  if (step === "update_contact") {
    return lineageKeys === "accountId,contactId" && !!expectedAccount &&
      !!expectedContact &&
      valueAt(plan.query, "updateContact", "$", "id") === expectedContact;
  }
  if (step === "create_location") {
    return lineageKeys === "accountId,contactId" && !!expectedAccount &&
      !!expectedContact &&
      valueAt(plan.query, "createLocation", "$", "accountId") ===
        expectedAccount &&
      valueAt(plan.query, "createLocation", "$", "contactId") ===
        expectedContact;
  }
  if (step === "update_location") {
    return lineageKeys === "accountId,contactId,locationId" &&
      !!expectedAccount && !!expectedContact && !!expectedLocation &&
      valueAt(plan.query, "updateLocation", "$", "id") ===
        expectedLocation &&
      valueAt(plan.query, "updateLocation", "$", "contactId") ===
        expectedContact;
  }
  if (step === "create_job") {
    return lineageKeys === "locationId" && !!expectedLocation &&
      valueAt(plan.query, "createJob", "$", "locationId") ===
        expectedLocation &&
      valueAt(plan.query, "createJob", "$", "scheduleIsPublished") === false;
  }
  if (step === "create_scheduled_task") {
    return lineageKeys === "jobId" && !!expectedJob &&
      valueAt(plan.query, "createTask", "$", "targetId") === expectedJob &&
      valueAt(plan.query, "createTask", "$", "targetType") === "job" &&
      valueAt(plan.query, "createTask", "$", "notify") === false;
  }
  if (step === "update_scheduled_task") {
    return lineageKeys === "jobId,taskId" && !!expectedJob && !!expectedTask &&
      valueAt(plan.query, "updateTask", "$", "id") === expectedTask &&
      valueAt(plan.query, "updateTask", "$", "notify") === false &&
      valueAt(plan.query, "updateTask", "$", "updateDependentTasks") ===
        false &&
      valueAt(plan.query, "updateTask", "$", "updateRecurringTasks") === false;
  }
  return false;
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function exactScheduleEcho(queryRoot: unknown, response: unknown): boolean {
  if (!isRecord(queryRoot) || !isRecord(response)) return false;
  const args = queryRoot.$;
  if (!isRecord(args)) return false;
  return ["startDate", "startTime", "endDate", "endTime"].every((key) =>
    typeof args[key] === "string" && response[key] === args[key]
  );
}

function validateHealth(
  data: JsonRecord,
  providerOrganizationId: string,
): ValidatedProviderResponse | null {
  if (
    !exactKeys(data, ["currentGrant", "version"]) ||
    typeof data.version !== "string" || !bounded(data.version, 64)
  ) return null;
  const currentGrant = data.currentGrant;
  if (
    !exactKeys(currentGrant, ["id", "user"]) ||
    !providerReference(valueAt(currentGrant, "id"))
  ) return null;
  const memberships = valueAt(currentGrant, "user", "memberships");
  if (!isRecord(memberships) || !Array.isArray(memberships.nodes)) return null;
  const matching = memberships.nodes.filter((node) =>
    valueAt(node, "organization", "id") === providerOrganizationId
  );
  if (matching.length !== 1) return null;
  return {
    outcome: {
      step: "grant_membership_read",
      recordCount: memberships.nodes.length,
      nextPagePresent: typeof memberships.nextPage === "string" &&
        memberships.nextPage.length > 0,
    },
    providerReference: null,
  };
}

function validateCustomerLookup(
  data: JsonRecord,
  providerOrganizationId: string,
): ValidatedProviderResponse | null {
  if (
    !exactKeys(data, ["organization"]) ||
    valueAt(data, "organization", "id") !== providerOrganizationId
  ) return null;
  const accounts = valueAt(data, "organization", "accounts");
  if (
    !isRecord(accounts) || !Array.isArray(accounts.nodes) ||
    accounts.nodes.length > 1 ||
    (typeof accounts.nextPage === "string" && accounts.nextPage.length > 0)
  ) {
    return null;
  }
  if (accounts.nodes.length === 0) {
    return {
      outcome: {
        step: "lookup_by_external_reference",
        recordCount: 0,
        nextPagePresent: false,
      },
      providerReference: null,
    };
  }
  const account = accounts.nodes[0];
  if (
    !isRecord(account) || account.type !== "customer" ||
    valueAt(account, "organization", "id") !== providerOrganizationId ||
    !providerReference(account.id)
  ) return null;
  for (const relation of ["contacts", "locations"]) {
    const value = account[relation];
    if (
      !isRecord(value) || !Array.isArray(value.nodes) || value.nodes.length > 1
    ) {
      return null;
    }
    if (typeof value.nextPage === "string" && value.nextPage.length > 0) {
      return null;
    }
    if (value.nodes.some((node) => !providerReference(valueAt(node, "id")))) {
      return null;
    }
  }
  return {
    outcome: {
      step: "lookup_by_external_reference",
      recordCount: 1,
      nextPagePresent: false,
    },
    providerReference: account.id as string,
  };
}

function validateAccountMutation(
  step: "create_account" | "update_account",
  plan: JobTreadQueryPlan,
  data: JsonRecord,
  providerOrganizationId: string,
): ValidatedProviderResponse | null {
  const root = step === "create_account" ? "createAccount" : "updateAccount";
  const resultKey = step === "create_account" ? "createdAccount" : "account";
  if (!exactKeys(data, [root])) return null;
  const record = valueAt(data, root, resultKey);
  const id = providerReference(valueAt(record, "id"));
  const queryId = step === "update_account"
    ? providerReference(valueAt(plan.query, root, "$", "id"))
    : null;
  if (
    !id || valueAt(record, "organization", "id") !== providerOrganizationId ||
    valueAt(record, "type") !== "customer" || (queryId && queryId !== id)
  ) {
    return null;
  }
  return {
    outcome: { step, recordCount: 1, nextPagePresent: false },
    providerReference: id,
  };
}

function validateParentMutation(
  step:
    | "create_contact"
    | "update_contact"
    | "create_location"
    | "update_location",
  plan: JobTreadQueryPlan,
  data: JsonRecord,
  expectedLineage: {
    accountId?: string;
    contactId?: string;
    locationId?: string;
  },
): ValidatedProviderResponse | null {
  const definitions = {
    create_contact: ["createContact", "createdContact"] as const,
    update_contact: ["updateContact", "contact"] as const,
    create_location: ["createLocation", "createdLocation"] as const,
    update_location: ["updateLocation", "location"] as const,
  };
  const [root, resultKey] = definitions[step];
  if (!exactKeys(data, [root])) return null;
  const record = valueAt(data, root, resultKey);
  const id = providerReference(valueAt(record, "id"));
  const queryId = step.startsWith("update_")
    ? providerReference(valueAt(plan.query, root, "$", "id"))
    : null;
  const expectedAccount = providerReference(expectedLineage.accountId);
  const expectedContact = step.endsWith("location")
    ? providerReference(expectedLineage.contactId)
    : null;
  const expectedTarget = step === "update_contact"
    ? providerReference(expectedLineage.contactId)
    : step === "update_location"
    ? providerReference(expectedLineage.locationId)
    : null;
  if (
    !id || (queryId && queryId !== id) ||
    (expectedTarget && expectedTarget !== id) || !expectedAccount ||
    valueAt(record, "account", "id") !== expectedAccount
  ) return null;
  if (expectedContact && valueAt(record, "contact", "id") !== expectedContact) {
    return null;
  }
  const queryAccount = providerReference(
    valueAt(plan.query, root, "$", "accountId"),
  );
  const queryContact = providerReference(
    valueAt(plan.query, root, "$", "contactId"),
  );
  if (
    (queryAccount && queryAccount !== expectedAccount) ||
    (queryContact && queryContact !== expectedContact)
  ) {
    return null;
  }
  return {
    outcome: { step, recordCount: 1, nextPagePresent: false },
    providerReference: id,
  };
}

function validateAvailability(
  data: JsonRecord,
  providerOrganizationId: string,
): ValidatedProviderResponse | null {
  if (
    !exactKeys(data, ["organization"]) ||
    valueAt(data, "organization", "id") !== providerOrganizationId
  ) return null;
  const tasks = valueAt(data, "organization", "tasks");
  if (
    !isRecord(tasks) || !Array.isArray(tasks.nodes) || tasks.nodes.length > 100
  ) {
    return null;
  }
  for (const task of tasks.nodes) {
    if (
      !isRecord(task) || !providerReference(task.id) ||
      !providerReference(valueAt(task, "job", "id")) ||
      !["startDate", "startTime", "endDate", "endTime"].every((key) =>
        typeof task[key] === "string"
      )
    ) return null;
  }
  if (tasks.nextPage != null && !bounded(tasks.nextPage, 512)) return null;
  return {
    outcome: {
      step: "read_scheduled_job_tasks",
      recordCount: tasks.nodes.length,
      nextPagePresent: typeof tasks.nextPage === "string" &&
        tasks.nextPage.length > 0,
    },
    providerReference: null,
  };
}

function validateBookingMutation(
  step: "create_job" | "create_scheduled_task" | "update_scheduled_task",
  plan: JobTreadQueryPlan,
  data: JsonRecord,
  providerOrganizationId: string,
  expectedLineage: {
    locationId?: string;
    jobId?: string;
    taskId?: string;
  },
): ValidatedProviderResponse | null {
  if (step === "create_job") {
    if (!exactKeys(data, ["createJob"])) return null;
    const record = valueAt(data, "createJob", "createdJob");
    const id = providerReference(valueAt(record, "id"));
    const locationId = providerReference(expectedLineage.locationId);
    const queryLocationId = providerReference(
      valueAt(plan.query, "createJob", "$", "locationId"),
    );
    if (
      !id || !locationId || valueAt(record, "location", "id") !== locationId ||
      queryLocationId !== locationId ||
      valueAt(record, "organization", "id") !== providerOrganizationId
    ) return null;
    return {
      outcome: { step, recordCount: 1, nextPagePresent: false },
      providerReference: id,
    };
  }
  const root = step === "create_scheduled_task" ? "createTask" : "updateTask";
  const resultKey = step === "create_scheduled_task" ? "createdTask" : "task";
  if (!exactKeys(data, [root])) return null;
  const record = valueAt(data, root, resultKey);
  const id = providerReference(valueAt(record, "id"));
  const expectedJob = providerReference(expectedLineage.jobId);
  const queryJob = step === "create_scheduled_task"
    ? providerReference(valueAt(plan.query, root, "$", "targetId"))
    : null;
  const queryTaskId = step === "update_scheduled_task"
    ? providerReference(valueAt(plan.query, root, "$", "id"))
    : null;
  const expectedTaskId = step === "update_scheduled_task"
    ? providerReference(expectedLineage.taskId)
    : null;
  if (
    !id || (queryTaskId && queryTaskId !== id) ||
    (expectedTaskId && expectedTaskId !== id) || !expectedJob ||
    valueAt(record, "job", "id") !== expectedJob ||
    (queryJob && queryJob !== expectedJob) ||
    !exactScheduleEcho(valueAt(plan.query, root), record)
  ) return null;
  return {
    outcome: { step, recordCount: 1, nextPagePresent: false },
    providerReference: id,
  };
}

function validateProviderResponse(
  step: JobTreadExecutableStep,
  plan: JobTreadQueryPlan,
  data: JsonRecord,
  providerOrganizationId: string,
  expectedLineage: {
    accountId?: string;
    contactId?: string;
    locationId?: string;
    jobId?: string;
    taskId?: string;
  },
): ValidatedProviderResponse | null {
  if (step === "grant_membership_read") {
    return validateHealth(data, providerOrganizationId);
  }
  if (step === "lookup_by_external_reference") {
    return validateCustomerLookup(data, providerOrganizationId);
  }
  if (step === "create_account" || step === "update_account") {
    return validateAccountMutation(step, plan, data, providerOrganizationId);
  }
  if (
    step === "create_contact" || step === "update_contact" ||
    step === "create_location" || step === "update_location"
  ) return validateParentMutation(step, plan, data, expectedLineage);
  if (step === "read_scheduled_job_tasks") {
    return validateAvailability(data, providerOrganizationId);
  }
  return validateBookingMutation(
    step,
    plan,
    data,
    providerOrganizationId,
    expectedLineage,
  );
}

function baseAudit(
  request: JobTreadExecutionRequest,
  connector: JobTreadConnectorRecord | null,
): JobTreadExecutionAudit {
  return {
    organizationId: request.organizationId,
    connectorId: connector?.id ?? null,
    capability: request.capability,
    configurationVersion: connector?.configurationVersion ?? null,
    requestFingerprint: null,
    idempotencyKeyHash: null,
    attemptNumber: null,
    outcomeUncertain: false,
  };
}

function manualReview(
  code: ConnectorFailureCode,
  request: JobTreadExecutionRequest,
  connector: JobTreadConnectorRecord | null,
  auditOverrides: Partial<JobTreadExecutionAudit> = {},
  retryable = false,
): JobTreadExecutionResult {
  return {
    status: "manual_review",
    code,
    retryable,
    audit: { ...baseAudit(request, connector), ...auditOverrides },
  };
}

function selectConnector(
  request: JobTreadExecutionRequest,
  records: readonly JobTreadConnectorRecord[],
): JobTreadConnectorRecord | ConnectorFailureCode {
  if (!UUID_PATTERN.test(request.organizationId)) return "connector_missing";
  if (
    records.some((record) =>
      record.organizationId.toLowerCase() !==
        request.organizationId.toLowerCase()
    )
  ) return "organization_lineage_mismatch";
  if (records.length === 0) return "connector_missing";
  if (records.length !== 1) return "connector_ambiguous";
  const connector = records[0];
  if (connector.provider !== "jobtread") return "connector_missing";
  if (!UUID_PATTERN.test(connector.id)) return "connector_ambiguous";
  if (connector.status !== "active" || !connector.runtimeEnabled) {
    return "connector_inactive";
  }
  if (!connector.capabilities.includes(request.capability)) {
    return "capability_unsupported";
  }
  if (!bounded(connector.credentialReference, 256)) {
    return "credential_reference_missing";
  }
  if (
    !connector.providerOrganizationFingerprint ||
    !SHA256_PATTERN.test(connector.providerOrganizationFingerprint)
  ) {
    return "organization_lineage_mismatch";
  }
  if (
    !Number.isInteger(connector.configurationVersion) ||
    connector.configurationVersion < 1
  ) return "connector_inactive";
  return connector;
}

function transportFailure(
  result: Extract<JobTreadPaveResult<unknown>, { status: "error" }>,
  mutation: boolean,
): {
  code: Extract<
    ConnectorFailureCode,
    | "credential_reference_missing"
    | "provider_unavailable"
    | "provider_rejected"
  >;
  retryable: boolean;
  outcomeUncertain: boolean;
} {
  if (result.code === "credential_missing") {
    return {
      code: "credential_reference_missing",
      retryable: false,
      outcomeUncertain: false,
    };
  }
  if (mutation && result.outcomeUncertain) {
    return {
      code: "provider_unavailable",
      retryable: false,
      outcomeUncertain: true,
    };
  }
  if (
    result.code === "provider_rejected" ||
    result.code === "invalid_query" || result.code === "malformed_response"
  ) {
    return {
      code: "provider_rejected",
      retryable: false,
      outcomeUncertain: false,
    };
  }
  return {
    code: "provider_unavailable",
    retryable: !mutation && result.retryable,
    outcomeUncertain: false,
  };
}

/**
 * Create a dormant runner. Nothing imports this module from a production Edge
 * entry point; every database, secret, and transport effect is injected and
 * directly testable.
 */
export function createJobTreadExecutionRunner(
  dependencies: JobTreadExecutionRunnerDependencies,
): (request: JobTreadExecutionRequest) => Promise<JobTreadExecutionResult> {
  return async (request) => {
    if (
      !isRecord(request) ||
      Object.keys(request).some((key) =>
        ![
          "organizationId",
          "capability",
          "executionReference",
          "idempotencyKey",
        ]
          .includes(key)
      ) || !bounded(request.executionReference, 256)
    ) {
      return manualReview("provider_rejected", request, null);
    }
    let records: readonly JobTreadConnectorRecord[];
    try {
      records = await dependencies.connectors.listForOrganization(
        request.organizationId,
      );
    } catch {
      return manualReview("provider_unavailable", request, null, {}, true);
    }
    const selection = selectConnector(request, records);
    if (typeof selection === "string") {
      return manualReview(selection, request, null);
    }
    const connector = selection;

    let prepared;
    try {
      prepared = await dependencies.plans.load({
        organizationId: request.organizationId,
        capability: request.capability,
        executionReference: request.executionReference,
      });
    } catch {
      return manualReview("provider_rejected", request, connector);
    }
    if (
      !prepared ||
      prepared.configurationVersion !== connector.configurationVersion
    ) {
      return manualReview("connector_inactive", request, connector);
    }
    const providerOrganizationId = providerReference(
      prepared.providerOrganizationId,
    );
    const contract = planContract(prepared.plan);
    if (
      !providerOrganizationId || !contract ||
      prepared.plan.capability !== request.capability
    ) {
      return manualReview("capability_unsupported", request, connector);
    }
    if (
      !validatePlanLineage(
        contract.step,
        prepared.plan,
        prepared.expectedLineage,
      )
    ) {
      return manualReview("capability_unsupported", request, connector);
    }
    const providerOrganizationFingerprint = await sha256Hex(
      providerOrganizationId,
    );
    if (
      providerOrganizationFingerprint !==
        connector.providerOrganizationFingerprint
    ) {
      return manualReview("organization_lineage_mismatch", request, connector);
    }
    const embeddedOrganization = queryProviderOrganization(
      contract.step,
      prepared.plan.query,
    );
    if (
      embeddedOrganization && embeddedOrganization !== providerOrganizationId
    ) {
      return manualReview("organization_lineage_mismatch", request, connector);
    }

    let requestFingerprint: string;
    try {
      requestFingerprint = await sha256Hex(canonicalJobTreadJson({
        runnerVersion: JOBTREAD_EXECUTION_RUNNER_VERSION,
        configurationVersion: connector.configurationVersion,
        capability: request.capability,
        plan: prepared.plan,
      }));
    } catch {
      return manualReview("provider_rejected", request, connector);
    }

    const normalizedIdempotencyKey = request.idempotencyKey?.trim() ?? "";
    if (contract.mutation && !normalizedIdempotencyKey) {
      return manualReview("idempotency_key_missing", request, connector, {
        requestFingerprint,
      });
    }
    const idempotencyKeyHash = contract.mutation
      ? await sha256Hex(canonicalJobTreadJson({
        organizationId: request.organizationId.toLowerCase(),
        connectorId: connector.id.toLowerCase(),
        capability: request.capability,
        idempotencyKey: normalizedIdempotencyKey,
      }))
      : null;
    const audit: Partial<JobTreadExecutionAudit> = {
      requestFingerprint,
      idempotencyKeyHash,
      attemptNumber: contract.mutation ? 1 : null,
    };

    let grantKey: string | null;
    try {
      grantKey = await dependencies.credentials.resolve(
        connector.credentialReference as string,
      );
    } catch {
      grantKey = null;
    }
    if (!grantKey?.trim()) {
      return manualReview(
        "credential_reference_missing",
        request,
        connector,
        audit,
      );
    }

    let attemptId: string | null = null;
    if (contract.mutation) {
      let claim: JobTreadAttemptClaimResult;
      try {
        claim = await dependencies.attempts.claim({
          organizationId: request.organizationId,
          connectorId: connector.id,
          operation: request.capability,
          idempotencyKeyHash: idempotencyKeyHash as string,
          requestFingerprint,
          attemptNumber: 1,
        });
      } catch {
        return manualReview(
          "provider_unavailable",
          request,
          connector,
          audit,
        );
      }
      if (claim.status !== "claimed") {
        return manualReview("retry_exhausted", request, connector, audit);
      }
      attemptId = claim.attemptId;
    }

    let transportResult: JobTreadPaveResult<Record<string, unknown>>;
    try {
      transportResult = await dependencies.transport.execute({
        grantKey,
        query: prepared.plan.query,
        mutation: contract.mutation,
      });
    } catch {
      transportResult = {
        status: "error",
        code: "transport_error",
        retryable: true,
        outcomeUncertain: contract.mutation,
        httpStatus: null,
      };
    }

    if (transportResult.status === "error") {
      const failure = transportFailure(transportResult, contract.mutation);
      if (attemptId) {
        try {
          await dependencies.attempts.completeManualReview({
            attemptId,
            failureCode: failure.code,
            outcomeUncertain: failure.outcomeUncertain,
          });
        } catch {
          return manualReview("retry_exhausted", request, connector, {
            ...audit,
            outcomeUncertain: failure.outcomeUncertain,
          });
        }
      }
      return manualReview(failure.code, request, connector, {
        ...audit,
        outcomeUncertain: failure.outcomeUncertain,
      }, failure.retryable);
    }

    const validated = validateProviderResponse(
      contract.step,
      prepared.plan,
      transportResult.data,
      providerOrganizationId,
      prepared.expectedLineage,
    );
    if (!validated) {
      if (attemptId) {
        try {
          await dependencies.attempts.completeManualReview({
            attemptId,
            failureCode: "retry_exhausted",
            outcomeUncertain: true,
          });
        } catch {
          // The started attempt remains reconciliation evidence.
        }
      }
      return manualReview(
        contract.mutation ? "retry_exhausted" : "provider_rejected",
        request,
        connector,
        { ...audit, outcomeUncertain: contract.mutation },
      );
    }

    const providerReferenceHash = validated.providerReference
      ? await sha256Hex(validated.providerReference)
      : null;
    if (attemptId) {
      try {
        await dependencies.attempts.completeSucceeded({
          attemptId,
          providerReferenceHash,
        });
      } catch {
        return manualReview("retry_exhausted", request, connector, {
          ...audit,
          outcomeUncertain: true,
        });
      }
    }
    return {
      status: "ok",
      value: validated.outcome,
      audit: { ...baseAudit(request, connector), ...audit },
    };
  };
}
