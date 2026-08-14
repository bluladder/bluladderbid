// deno-lint-ignore-file no-explicit-any
import type {
  ConnectorCapability,
  ConnectorFailureCode,
} from "./connectorContracts.ts";
import type {
  JobTreadAttemptClaimResult,
  JobTreadConnectorRecord,
  JobTreadConnectorStore,
  JobTreadOperationAttemptClaim,
  JobTreadOperationAttemptStore,
} from "./jobtreadExecutionRunner.ts";

export const JOBTREAD_PHASE1I_STORE_VERSION = 1;
export const JOBTREAD_CONNECTOR_TABLE = "organization_crm_connectors";
export const JOBTREAD_ATTEMPT_TABLE =
  "organization_connector_operation_attempts";

export const JOBTREAD_CONNECTOR_SELECT =
  "id, organization_id, provider, status, capabilities, credential_reference, provider_organization_fingerprint, configuration_version, runtime_enabled";
export const JOBTREAD_ATTEMPT_SELECT =
  "id, organization_id, connector_id, operation, idempotency_key_hash, request_fingerprint, attempt_number, status, failure_code, outcome_uncertain, provider_reference_hash, started_at, completed_at";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CAPABILITIES = new Set<ConnectorCapability>([
  "customer_sync",
  "quote_sync",
  "availability_read",
  "booking_create",
  "booking_update",
  "booking_cancel",
  "invoice_handoff",
  "communications_handoff",
  "health",
]);
const ATTEMPT_FAILURE_CODES = new Set<ConnectorFailureCode>([
  "connector_missing",
  "connector_ambiguous",
  "connector_inactive",
  "capability_unsupported",
  "credential_reference_missing",
  "organization_lineage_mismatch",
  "idempotency_key_missing",
  "provider_unavailable",
  "provider_rejected",
  "retry_exhausted",
]);
const TERMINAL_STORE_FAILURE_CODES = new Set([
  "credential_reference_missing",
  "provider_unavailable",
  "provider_rejected",
  "retry_exhausted",
]);

export type JobTreadPhase1IStoreErrorCode =
  | "connector_lookup_unavailable"
  | "connector_row_invalid"
  | "attempt_claim_invalid"
  | "attempt_claim_unavailable"
  | "attempt_row_invalid"
  | "attempt_transition_invalid"
  | "attempt_transition_unavailable"
  | "attempt_reconciliation_unavailable";

export class JobTreadPhase1IStoreError extends Error {
  readonly code: JobTreadPhase1IStoreErrorCode;

  constructor(code: JobTreadPhase1IStoreErrorCode) {
    super(code);
    this.name = "JobTreadPhase1IStoreError";
    this.code = code;
  }
}

export interface JobTreadAttemptReconciliationInput {
  organizationId: string;
  connectorId: string;
  operation: ConnectorCapability;
  idempotencyKeyHash: string;
}

export type JobTreadAttemptReconciliationResult =
  | { status: "missing" }
  | {
    status: "started" | "succeeded" | "manual_review";
    failureCode: ConnectorFailureCode | null;
    outcomeUncertain: boolean;
    providerReferenceHash: string | null;
    requestFingerprint: string;
  };

export interface JobTreadAttemptReconciliationStore {
  reconcile(
    input: JobTreadAttemptReconciliationInput,
  ): Promise<JobTreadAttemptReconciliationResult>;
}

export interface JobTreadPhase1IStores {
  connectors: JobTreadConnectorStore;
  attempts: JobTreadOperationAttemptStore;
  reconciliation: JobTreadAttemptReconciliationStore;
}

interface AttemptRow {
  id: string;
  organizationId: string;
  connectorId: string;
  operation: ConnectorCapability;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  attemptNumber: 1;
  status: "started" | "succeeded" | "manual_review";
  failureCode: ConnectorFailureCode | null;
  outcomeUncertain: boolean;
  providerReferenceHash: string | null;
  startedAt: string;
  completedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function uuid(value: unknown): string | null {
  const normalized = bounded(value, 36);
  return normalized && UUID_PATTERN.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function sha256(value: unknown): string | null {
  return typeof value === "string" && SHA256_PATTERN.test(value) ? value : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function parseConnectorRow(value: unknown): JobTreadConnectorRecord {
  if (!isRecord(value)) {
    throw new JobTreadPhase1IStoreError("connector_row_invalid");
  }
  const id = uuid(value.id);
  const organizationId = uuid(value.organization_id);
  const status = value.status;
  const capabilities = value.capabilities;
  const credentialReference = value.credential_reference == null
    ? null
    : bounded(value.credential_reference, 256);
  const providerOrganizationFingerprint = value
      .provider_organization_fingerprint == null
    ? null
    : sha256(value.provider_organization_fingerprint);
  const configurationVersion = value.configuration_version;
  if (
    !id || !organizationId || value.provider !== "jobtread" ||
    !["active", "inactive", "degraded"].includes(String(status)) ||
    !Array.isArray(capabilities) ||
    capabilities.some((item) =>
      typeof item !== "string" || !CAPABILITIES.has(item as ConnectorCapability)
    ) || new Set(capabilities).size !== capabilities.length ||
    (value.credential_reference != null && !credentialReference) ||
    (value.provider_organization_fingerprint != null &&
      !providerOrganizationFingerprint) ||
    !Number.isInteger(configurationVersion) ||
    Number(configurationVersion) < 1 ||
    typeof value.runtime_enabled !== "boolean"
  ) throw new JobTreadPhase1IStoreError("connector_row_invalid");
  return {
    id,
    organizationId,
    provider: "jobtread",
    status: status as JobTreadConnectorRecord["status"],
    capabilities: capabilities as ConnectorCapability[],
    credentialReference,
    providerOrganizationFingerprint,
    configurationVersion: Number(configurationVersion),
    runtimeEnabled: value.runtime_enabled,
  };
}

function parseAttemptRow(value: unknown): AttemptRow {
  if (!isRecord(value)) {
    throw new JobTreadPhase1IStoreError("attempt_row_invalid");
  }
  const id = uuid(value.id);
  const organizationId = uuid(value.organization_id);
  const connectorId = uuid(value.connector_id);
  const operation = value.operation;
  const idempotencyKeyHash = sha256(value.idempotency_key_hash);
  const requestFingerprint = sha256(value.request_fingerprint);
  const status = value.status;
  const failureCode = value.failure_code == null
    ? null
    : typeof value.failure_code === "string" &&
        ATTEMPT_FAILURE_CODES.has(value.failure_code as ConnectorFailureCode)
    ? value.failure_code as ConnectorFailureCode
    : undefined;
  const providerReferenceHash = value.provider_reference_hash == null
    ? null
    : sha256(value.provider_reference_hash);
  const startedAt = isoTimestamp(value.started_at);
  const completedAt = value.completed_at == null
    ? null
    : isoTimestamp(value.completed_at);
  if (
    !id || !organizationId || !connectorId ||
    typeof operation !== "string" ||
    !CAPABILITIES.has(operation as ConnectorCapability) ||
    !idempotencyKeyHash || !requestFingerprint || value.attempt_number !== 1 ||
    !["started", "succeeded", "manual_review"].includes(String(status)) ||
    failureCode === undefined || typeof value.outcome_uncertain !== "boolean" ||
    (value.provider_reference_hash != null && !providerReferenceHash) ||
    !startedAt || (value.completed_at != null && !completedAt)
  ) throw new JobTreadPhase1IStoreError("attempt_row_invalid");

  const lifecycleValid = status === "started"
    ? completedAt === null && failureCode === null &&
      value.outcome_uncertain === false && providerReferenceHash === null
    : status === "succeeded"
    ? completedAt !== null && failureCode === null &&
      value.outcome_uncertain === false
    : completedAt !== null && failureCode !== null &&
      (!value.outcome_uncertain ||
        ["provider_unavailable", "retry_exhausted"].includes(failureCode)) &&
      providerReferenceHash === null;
  if (!lifecycleValid) {
    throw new JobTreadPhase1IStoreError("attempt_row_invalid");
  }
  return {
    id,
    organizationId,
    connectorId,
    operation: operation as ConnectorCapability,
    idempotencyKeyHash,
    requestFingerprint,
    attemptNumber: 1,
    status: status as AttemptRow["status"],
    failureCode,
    outcomeUncertain: value.outcome_uncertain,
    providerReferenceHash,
    startedAt,
    completedAt,
  };
}

function validClaim(input: JobTreadOperationAttemptClaim): boolean {
  return !!uuid(input.organizationId) && !!uuid(input.connectorId) &&
    CAPABILITIES.has(input.operation) && !!sha256(input.idempotencyKeyHash) &&
    !!sha256(input.requestFingerprint) && input.attemptNumber === 1;
}

function sameAttempt(
  row: AttemptRow,
  input: JobTreadOperationAttemptClaim,
): boolean {
  return row.organizationId === input.organizationId.toLowerCase() &&
    row.connectorId === input.connectorId.toLowerCase() &&
    row.operation === input.operation &&
    row.idempotencyKeyHash === input.idempotencyKeyHash &&
    row.attemptNumber === 1;
}

async function recoverAttempt(
  supabase: any,
  input: JobTreadOperationAttemptClaim,
): Promise<JobTreadAttemptClaimResult> {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase
      .from(JOBTREAD_ATTEMPT_TABLE)
      .select(JOBTREAD_ATTEMPT_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("connector_id", input.connectorId)
      .eq("operation", input.operation)
      .eq("idempotency_key_hash", input.idempotencyKeyHash)
      .eq("attempt_number", 1)
      .limit(2);
  } catch {
    throw new JobTreadPhase1IStoreError("attempt_claim_unavailable");
  }
  const { data, error } = response;
  if (error || !Array.isArray(data) || data.length !== 1) {
    throw new JobTreadPhase1IStoreError("attempt_claim_unavailable");
  }
  const row = parseAttemptRow(data[0]);
  if (!sameAttempt(row, input)) {
    throw new JobTreadPhase1IStoreError("attempt_row_invalid");
  }
  if (row.requestFingerprint !== input.requestFingerprint) {
    return { status: "conflict" };
  }
  return row.status === "started"
    ? { status: "in_progress" }
    : { status: "duplicate" };
}

function validReconciliationInput(
  input: JobTreadAttemptReconciliationInput,
): boolean {
  return !!uuid(input.organizationId) && !!uuid(input.connectorId) &&
    CAPABILITIES.has(input.operation) && !!sha256(input.idempotencyKeyHash);
}

export function createJobTreadPhase1IStores(
  supabase: any,
  options: { now?: () => string } = {},
): JobTreadPhase1IStores {
  const now = options.now ?? (() => new Date().toISOString());
  const connectors: JobTreadConnectorStore = {
    async listForOrganization(organizationId) {
      if (!uuid(organizationId)) return [];
      let response: { data: unknown; error: unknown };
      try {
        response = await supabase
          .from(JOBTREAD_CONNECTOR_TABLE)
          .select(JOBTREAD_CONNECTOR_SELECT)
          .eq("organization_id", organizationId)
          .eq("provider", "jobtread")
          .limit(2);
      } catch {
        throw new JobTreadPhase1IStoreError("connector_lookup_unavailable");
      }
      const { data, error } = response;
      if (error || !Array.isArray(data)) {
        throw new JobTreadPhase1IStoreError("connector_lookup_unavailable");
      }
      return data.map(parseConnectorRow);
    },
  };

  const attempts: JobTreadOperationAttemptStore = {
    async claim(input) {
      if (!validClaim(input)) {
        throw new JobTreadPhase1IStoreError("attempt_claim_invalid");
      }
      let response: { data: unknown; error: unknown };
      try {
        response = await supabase
          .from(JOBTREAD_ATTEMPT_TABLE)
          .insert({
            organization_id: input.organizationId,
            connector_id: input.connectorId,
            operation: input.operation,
            idempotency_key_hash: input.idempotencyKeyHash,
            request_fingerprint: input.requestFingerprint,
            attempt_number: 1,
            status: "started",
            outcome_uncertain: false,
          })
          .select(JOBTREAD_ATTEMPT_SELECT)
          .maybeSingle();
      } catch {
        return recoverAttempt(supabase, input);
      }
      const { data, error } = response;
      if (error || data == null) return recoverAttempt(supabase, input);
      const row = parseAttemptRow(data);
      if (
        !sameAttempt(row, input) ||
        row.requestFingerprint !== input.requestFingerprint ||
        row.status !== "started"
      ) {
        throw new JobTreadPhase1IStoreError("attempt_row_invalid");
      }
      return { status: "claimed", attemptId: row.id };
    },

    async completeSucceeded(input) {
      if (
        !uuid(input.attemptId) ||
        (input.providerReferenceHash !== null &&
          !sha256(input.providerReferenceHash))
      ) {
        throw new JobTreadPhase1IStoreError("attempt_transition_invalid");
      }
      const completedAt = isoTimestamp(now());
      if (!completedAt) {
        throw new JobTreadPhase1IStoreError("attempt_transition_invalid");
      }
      let response: { data: unknown; error: unknown };
      try {
        response = await supabase
          .from(JOBTREAD_ATTEMPT_TABLE)
          .update({
            status: "succeeded",
            failure_code: null,
            outcome_uncertain: false,
            provider_reference_hash: input.providerReferenceHash,
            completed_at: completedAt,
          })
          .eq("id", input.attemptId)
          .eq("status", "started")
          .is("completed_at", null)
          .select(JOBTREAD_ATTEMPT_SELECT)
          .maybeSingle();
      } catch {
        throw new JobTreadPhase1IStoreError(
          "attempt_transition_unavailable",
        );
      }
      const { data, error } = response;
      if (error || data == null) {
        throw new JobTreadPhase1IStoreError(
          "attempt_transition_unavailable",
        );
      }
      const row = parseAttemptRow(data);
      if (
        row.id !== input.attemptId.toLowerCase() ||
        row.status !== "succeeded" ||
        row.providerReferenceHash !== input.providerReferenceHash
      ) {
        throw new JobTreadPhase1IStoreError("attempt_transition_invalid");
      }
    },

    async completeManualReview(input) {
      if (
        !uuid(input.attemptId) ||
        !TERMINAL_STORE_FAILURE_CODES.has(input.failureCode) ||
        (input.outcomeUncertain &&
          !["provider_unavailable", "retry_exhausted"].includes(
            input.failureCode,
          ))
      ) {
        throw new JobTreadPhase1IStoreError("attempt_transition_invalid");
      }
      const completedAt = isoTimestamp(now());
      if (!completedAt) {
        throw new JobTreadPhase1IStoreError("attempt_transition_invalid");
      }
      let response: { data: unknown; error: unknown };
      try {
        response = await supabase
          .from(JOBTREAD_ATTEMPT_TABLE)
          .update({
            status: "manual_review",
            failure_code: input.failureCode,
            outcome_uncertain: input.outcomeUncertain,
            provider_reference_hash: null,
            completed_at: completedAt,
          })
          .eq("id", input.attemptId)
          .eq("status", "started")
          .is("completed_at", null)
          .select(JOBTREAD_ATTEMPT_SELECT)
          .maybeSingle();
      } catch {
        throw new JobTreadPhase1IStoreError(
          "attempt_transition_unavailable",
        );
      }
      const { data, error } = response;
      if (error || data == null) {
        throw new JobTreadPhase1IStoreError(
          "attempt_transition_unavailable",
        );
      }
      const row = parseAttemptRow(data);
      if (
        row.id !== input.attemptId.toLowerCase() ||
        row.status !== "manual_review" ||
        row.failureCode !== input.failureCode ||
        row.outcomeUncertain !== input.outcomeUncertain
      ) {
        throw new JobTreadPhase1IStoreError("attempt_transition_invalid");
      }
    },
  };

  const reconciliation: JobTreadAttemptReconciliationStore = {
    async reconcile(input) {
      if (!validReconciliationInput(input)) {
        throw new JobTreadPhase1IStoreError("attempt_claim_invalid");
      }
      let response: { data: unknown; error: unknown };
      try {
        response = await supabase
          .from(JOBTREAD_ATTEMPT_TABLE)
          .select(JOBTREAD_ATTEMPT_SELECT)
          .eq("organization_id", input.organizationId)
          .eq("connector_id", input.connectorId)
          .eq("operation", input.operation)
          .eq("idempotency_key_hash", input.idempotencyKeyHash)
          .eq("attempt_number", 1)
          .limit(2);
      } catch {
        throw new JobTreadPhase1IStoreError(
          "attempt_reconciliation_unavailable",
        );
      }
      const { data, error } = response;
      if (error || !Array.isArray(data) || data.length > 1) {
        throw new JobTreadPhase1IStoreError(
          "attempt_reconciliation_unavailable",
        );
      }
      if (data.length === 0) return { status: "missing" };
      const row = parseAttemptRow(data[0]);
      if (
        row.organizationId !== input.organizationId.toLowerCase() ||
        row.connectorId !== input.connectorId.toLowerCase() ||
        row.operation !== input.operation ||
        row.idempotencyKeyHash !== input.idempotencyKeyHash ||
        row.attemptNumber !== 1
      ) {
        throw new JobTreadPhase1IStoreError("attempt_row_invalid");
      }
      return {
        status: row.status,
        failureCode: row.failureCode,
        outcomeUncertain: row.outcomeUncertain,
        providerReferenceHash: row.providerReferenceHash,
        requestFingerprint: row.requestFingerprint,
      };
    },
  };

  return { connectors, attempts, reconciliation };
}
