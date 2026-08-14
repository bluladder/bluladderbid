// deno-lint-ignore-file no-explicit-any
import type { ConnectorFailureCode } from "./connectorContracts.ts";

export const JOBTREAD_PHASE1I_WEBHOOK_RECEIPT_STORE_VERSION = 1;
export const JOBTREAD_WEBHOOK_RECEIPT_TABLE =
  "organization_connector_webhook_receipts";
export const JOBTREAD_WEBHOOK_RECEIPT_SELECT =
  "id, organization_id, connector_id, provider_event_hash, event_type, payload_fingerprint, source_authenticated, status, failure_code, occurred_at, received_at, processed_at";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RECEIPT_FAILURE_CODES = new Set<ConnectorFailureCode>([
  "organization_lineage_mismatch",
  "provider_unavailable",
  "provider_rejected",
  "capability_unsupported",
]);

export type JobTreadWebhookReceiptStoreErrorCode =
  | "receipt_claim_invalid"
  | "receipt_claim_unavailable"
  | "receipt_row_invalid"
  | "receipt_transition_invalid"
  | "receipt_transition_unavailable"
  | "receipt_reconciliation_invalid"
  | "receipt_reconciliation_unavailable";

export class JobTreadWebhookReceiptStoreError extends Error {
  readonly code: JobTreadWebhookReceiptStoreErrorCode;

  constructor(code: JobTreadWebhookReceiptStoreErrorCode) {
    super(code);
    this.name = "JobTreadWebhookReceiptStoreError";
    this.code = code;
  }
}

export interface JobTreadWebhookReceiptClaim {
  organizationId: string;
  connectorId: string;
  providerEventHash: string;
  eventType: string;
  payloadFingerprint: string;
  sourceAuthenticated: true;
  occurredAt: string | null;
}

export type JobTreadWebhookReceiptClaimResult =
  | { status: "claimed"; receiptId: string }
  | { status: "duplicate" | "conflict" | "in_progress" };

export type JobTreadWebhookReceiptTerminalFailureCode = Extract<
  ConnectorFailureCode,
  | "organization_lineage_mismatch"
  | "provider_unavailable"
  | "provider_rejected"
  | "capability_unsupported"
>;

export interface JobTreadWebhookReceiptReconciliationInput {
  organizationId: string;
  connectorId: string;
  providerEventHash: string;
}

export type JobTreadWebhookReceiptReconciliationResult =
  | { status: "missing" }
  | {
    status: "accepted" | "processed" | "ignored" | "manual_review";
    eventType: string;
    payloadFingerprint: string;
    sourceAuthenticated: true;
    failureCode: JobTreadWebhookReceiptTerminalFailureCode | null;
    occurredAt: string | null;
    receivedAt: string;
    processedAt: string | null;
  };

export interface JobTreadWebhookReceiptStore {
  claim(
    input: JobTreadWebhookReceiptClaim,
  ): Promise<JobTreadWebhookReceiptClaimResult>;
  completeProcessed(input: {
    organizationId: string;
    connectorId: string;
    receiptId: string;
  }): Promise<void>;
  completeIgnored(input: {
    organizationId: string;
    connectorId: string;
    receiptId: string;
  }): Promise<void>;
  completeManualReview(input: {
    organizationId: string;
    connectorId: string;
    receiptId: string;
    failureCode: JobTreadWebhookReceiptTerminalFailureCode;
  }): Promise<void>;
  reconcile(
    input: JobTreadWebhookReceiptReconciliationInput,
  ): Promise<JobTreadWebhookReceiptReconciliationResult>;
}

interface ReceiptRow {
  id: string;
  organizationId: string;
  connectorId: string;
  providerEventHash: string;
  eventType: string;
  payloadFingerprint: string;
  sourceAuthenticated: true;
  status: "accepted" | "processed" | "ignored" | "manual_review";
  failureCode: JobTreadWebhookReceiptTerminalFailureCode | null;
  occurredAt: string | null;
  receivedAt: string;
  processedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length === 36 && UUID_PATTERN.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function sha256(value: unknown): string | null {
  return typeof value === "string" && SHA256_PATTERN.test(value) ? value : null;
}

function eventType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function parseReceiptRow(value: unknown): ReceiptRow {
  if (!isRecord(value)) {
    throw new JobTreadWebhookReceiptStoreError("receipt_row_invalid");
  }
  const id = uuid(value.id);
  const organizationId = uuid(value.organization_id);
  const connectorId = uuid(value.connector_id);
  const providerEventHash = sha256(value.provider_event_hash);
  const normalizedEventType = eventType(value.event_type);
  const payloadFingerprint = sha256(value.payload_fingerprint);
  const status = value.status;
  const failureCode = value.failure_code == null
    ? null
    : typeof value.failure_code === "string" &&
        RECEIPT_FAILURE_CODES.has(value.failure_code as ConnectorFailureCode)
    ? value.failure_code as JobTreadWebhookReceiptTerminalFailureCode
    : undefined;
  const occurredAt = value.occurred_at == null
    ? null
    : isoTimestamp(value.occurred_at);
  const receivedAt = isoTimestamp(value.received_at);
  const processedAt = value.processed_at == null
    ? null
    : isoTimestamp(value.processed_at);
  if (
    !id || !organizationId || !connectorId || !providerEventHash ||
    !normalizedEventType || normalizedEventType !== value.event_type ||
    !payloadFingerprint || value.source_authenticated !== true ||
    !["accepted", "processed", "ignored", "manual_review"].includes(
      String(status),
    ) || failureCode === undefined ||
    (value.occurred_at != null && !occurredAt) || !receivedAt ||
    (value.processed_at != null && !processedAt)
  ) {
    throw new JobTreadWebhookReceiptStoreError("receipt_row_invalid");
  }
  const lifecycleValid = status === "accepted"
    ? processedAt === null && failureCode === null
    : status === "manual_review"
    ? processedAt !== null && failureCode !== null
    : processedAt !== null && failureCode === null;
  if (!lifecycleValid) {
    throw new JobTreadWebhookReceiptStoreError("receipt_row_invalid");
  }
  return {
    id,
    organizationId,
    connectorId,
    providerEventHash,
    eventType: normalizedEventType,
    payloadFingerprint,
    sourceAuthenticated: true,
    status: status as ReceiptRow["status"],
    failureCode,
    occurredAt,
    receivedAt,
    processedAt,
  };
}

function normalizeClaim(input: JobTreadWebhookReceiptClaim):
  | {
    organizationId: string;
    connectorId: string;
    providerEventHash: string;
    eventType: string;
    payloadFingerprint: string;
    sourceAuthenticated: true;
    occurredAt: string | null;
  }
  | null {
  const organizationId = uuid(input.organizationId);
  const connectorId = uuid(input.connectorId);
  const providerEventHash = sha256(input.providerEventHash);
  const normalizedEventType = eventType(input.eventType);
  const payloadFingerprint = sha256(input.payloadFingerprint);
  const occurredAt = input.occurredAt == null
    ? null
    : isoTimestamp(input.occurredAt);
  if (
    !organizationId || !connectorId || !providerEventHash ||
    !normalizedEventType || !payloadFingerprint ||
    input.sourceAuthenticated !== true ||
    (input.occurredAt != null && !occurredAt)
  ) return null;
  return {
    organizationId,
    connectorId,
    providerEventHash,
    eventType: normalizedEventType,
    payloadFingerprint,
    sourceAuthenticated: true,
    occurredAt,
  };
}

function sameClaim(
  row: ReceiptRow,
  input: NonNullable<ReturnType<typeof normalizeClaim>>,
): boolean {
  return row.organizationId === input.organizationId &&
    row.connectorId === input.connectorId &&
    row.providerEventHash === input.providerEventHash &&
    row.eventType === input.eventType &&
    row.payloadFingerprint === input.payloadFingerprint &&
    row.sourceAuthenticated === true && row.occurredAt === input.occurredAt;
}

async function selectExactReceipt(
  supabase: any,
  input: {
    organizationId: string;
    connectorId: string;
    providerEventHash: string;
  },
  unavailableCode:
    | "receipt_claim_unavailable"
    | "receipt_reconciliation_unavailable",
): Promise<ReceiptRow | null> {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase
      .from(JOBTREAD_WEBHOOK_RECEIPT_TABLE)
      .select(JOBTREAD_WEBHOOK_RECEIPT_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("connector_id", input.connectorId)
      .eq("provider_event_hash", input.providerEventHash)
      .limit(2);
  } catch {
    throw new JobTreadWebhookReceiptStoreError(unavailableCode);
  }
  if (
    response.error || !Array.isArray(response.data) ||
    response.data.length > 1
  ) {
    throw new JobTreadWebhookReceiptStoreError(unavailableCode);
  }
  if (response.data.length === 0) return null;
  const row = parseReceiptRow(response.data[0]);
  if (
    row.organizationId !== input.organizationId ||
    row.connectorId !== input.connectorId ||
    row.providerEventHash !== input.providerEventHash
  ) {
    throw new JobTreadWebhookReceiptStoreError("receipt_row_invalid");
  }
  return row;
}

async function transitionReceipt(
  supabase: any,
  now: () => string,
  input: {
    organizationId: string;
    connectorId: string;
    receiptId: string;
    status: "processed" | "ignored" | "manual_review";
    failureCode: JobTreadWebhookReceiptTerminalFailureCode | null;
  },
): Promise<void> {
  const organizationId = uuid(input.organizationId);
  const connectorId = uuid(input.connectorId);
  const receiptId = uuid(input.receiptId);
  const processedAt = isoTimestamp(now());
  if (
    !organizationId || !connectorId || !receiptId || !processedAt ||
    (input.status === "manual_review"
      ? !input.failureCode || !RECEIPT_FAILURE_CODES.has(input.failureCode)
      : input.failureCode !== null)
  ) {
    throw new JobTreadWebhookReceiptStoreError("receipt_transition_invalid");
  }
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase
      .from(JOBTREAD_WEBHOOK_RECEIPT_TABLE)
      .update({
        status: input.status,
        failure_code: input.failureCode,
        processed_at: processedAt,
      })
      .eq("organization_id", input.organizationId)
      .eq("connector_id", input.connectorId)
      .eq("id", input.receiptId)
      .eq("status", "accepted")
      .is("processed_at", null)
      .select(JOBTREAD_WEBHOOK_RECEIPT_SELECT)
      .maybeSingle();
  } catch {
    throw new JobTreadWebhookReceiptStoreError(
      "receipt_transition_unavailable",
    );
  }
  if (response.error || response.data == null) {
    throw new JobTreadWebhookReceiptStoreError(
      "receipt_transition_unavailable",
    );
  }
  const row = parseReceiptRow(response.data);
  if (
    row.organizationId !== organizationId || row.connectorId !== connectorId ||
    row.id !== receiptId || row.status !== input.status ||
    row.failureCode !== input.failureCode || row.processedAt !== processedAt
  ) {
    throw new JobTreadWebhookReceiptStoreError("receipt_transition_invalid");
  }
}

export function createJobTreadPhase1IWebhookReceiptStore(
  supabase: any,
  options: { now?: () => string } = {},
): JobTreadWebhookReceiptStore {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async claim(rawInput) {
      const input = normalizeClaim(rawInput);
      if (!input) {
        throw new JobTreadWebhookReceiptStoreError("receipt_claim_invalid");
      }
      let response: { data: unknown; error: unknown };
      try {
        response = await supabase
          .from(JOBTREAD_WEBHOOK_RECEIPT_TABLE)
          .insert({
            organization_id: input.organizationId,
            connector_id: input.connectorId,
            provider_event_hash: input.providerEventHash,
            event_type: input.eventType,
            payload_fingerprint: input.payloadFingerprint,
            source_authenticated: true,
            status: "accepted",
            occurred_at: input.occurredAt,
          })
          .select(JOBTREAD_WEBHOOK_RECEIPT_SELECT)
          .maybeSingle();
      } catch {
        const recovered = await selectExactReceipt(
          supabase,
          input,
          "receipt_claim_unavailable",
        );
        if (!recovered) {
          throw new JobTreadWebhookReceiptStoreError(
            "receipt_claim_unavailable",
          );
        }
        if (!sameClaim(recovered, input)) return { status: "conflict" };
        return recovered.status === "accepted"
          ? { status: "in_progress" }
          : { status: "duplicate" };
      }
      if (response.error || response.data == null) {
        const recovered = await selectExactReceipt(
          supabase,
          input,
          "receipt_claim_unavailable",
        );
        if (!recovered) {
          throw new JobTreadWebhookReceiptStoreError(
            "receipt_claim_unavailable",
          );
        }
        if (!sameClaim(recovered, input)) return { status: "conflict" };
        return recovered.status === "accepted"
          ? { status: "in_progress" }
          : { status: "duplicate" };
      }
      const row = parseReceiptRow(response.data);
      if (!sameClaim(row, input) || row.status !== "accepted") {
        throw new JobTreadWebhookReceiptStoreError("receipt_row_invalid");
      }
      return { status: "claimed", receiptId: row.id };
    },

    completeProcessed({ organizationId, connectorId, receiptId }) {
      return transitionReceipt(supabase, now, {
        organizationId,
        connectorId,
        receiptId,
        status: "processed",
        failureCode: null,
      });
    },

    completeIgnored({ organizationId, connectorId, receiptId }) {
      return transitionReceipt(supabase, now, {
        organizationId,
        connectorId,
        receiptId,
        status: "ignored",
        failureCode: null,
      });
    },

    completeManualReview({
      organizationId,
      connectorId,
      receiptId,
      failureCode,
    }) {
      return transitionReceipt(supabase, now, {
        organizationId,
        connectorId,
        receiptId,
        status: "manual_review",
        failureCode,
      });
    },

    async reconcile(input) {
      const organizationId = uuid(input.organizationId);
      const connectorId = uuid(input.connectorId);
      const providerEventHash = sha256(input.providerEventHash);
      if (!organizationId || !connectorId || !providerEventHash) {
        throw new JobTreadWebhookReceiptStoreError(
          "receipt_reconciliation_invalid",
        );
      }
      const row = await selectExactReceipt(
        supabase,
        { organizationId, connectorId, providerEventHash },
        "receipt_reconciliation_unavailable",
      );
      if (!row) return { status: "missing" };
      return {
        status: row.status,
        eventType: row.eventType,
        payloadFingerprint: row.payloadFingerprint,
        sourceAuthenticated: true,
        failureCode: row.failureCode,
        occurredAt: row.occurredAt,
        receivedAt: row.receivedAt,
        processedAt: row.processedAt,
      };
    },
  };
}
