// ============================================================================
// Canonical QuoteSession -> chat_conversations projection.
//
// QuoteSessionFields remain the form authority. This adapter publishes the
// confirmed subset required by existing conversation, delivery and booking
// code. It does not ask questions or compute a second workflow state.
// ============================================================================

import type { ConversationFacts } from "../conversationState.ts";
import {
  type FieldStatus,
  type QuoteSession,
  type QuoteSessionFields,
} from "../quoteSession.ts";
import { evaluateQuoteIntake } from "../salesEngine/quoteIntakeContract.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const PROJECTION_VERSION = "quote-session-projection-v1";

type ProjectionFactStatus = Partial<
  Record<keyof QuoteSessionFields, FieldStatus>
>;

interface ProjectionMetadata {
  version: string;
  sessionId: string;
  fieldStatus: ProjectionFactStatus;
  projectedAt: string;
}

export interface ConversationProjectionRow {
  id: string;
  organization_id: string | null;
  updated_at?: string | null;
  quote_session_id?: string | null;
  services_discussed?: unknown;
  prospect_name?: string | null;
  prospect_email?: string | null;
  prospect_phone?: string | null;
  service_address?: string | null;
  service_area_status?: string | null;
  service_area_result?: unknown;
  quote_result?: unknown;
  conversation_state?: string | null;
  facts?: unknown;
  customer_id?: string | null;
  property_id?: string | null;
  booking_status?: string | null;
  selected_slot_id?: string | null;
}

export function quoteSessionConversationLineageConflict(
  session: QuoteSession,
  conversation: ConversationProjectionRow,
): string | null {
  if (!session.conversationIds.includes(conversation.id)) {
    return "conversation_lineage_conflict";
  }
  if (
    conversation.quote_session_id &&
    conversation.quote_session_id !== session.id
  ) return "quote_session_lineage_conflict";
  if (
    conversation.customer_id && session.customerId &&
    conversation.customer_id !== session.customerId
  ) return "customer_lineage_conflict";
  if (
    conversation.property_id && session.propertyId &&
    conversation.property_id !== session.propertyId
  ) return "property_lineage_conflict";
  return null;
}

const STATUS_RANK: Record<FieldStatus, number> = {
  unknown: 0,
  unanswered: 0,
  defaulted: 1,
  derived: 2,
  captured: 3,
  verified: 4,
  corrected: 5,
};

function existingMetadata(facts: unknown): ProjectionMetadata | null {
  if (!facts || typeof facts !== "object") return null;
  const candidate = (facts as Record<string, unknown>).canonicalProjection;
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (value.version !== PROJECTION_VERSION) return null;
  return value as unknown as ProjectionMetadata;
}

function mayProjectContact(args: {
  field: "name" | "email" | "phone" | "address" | "serviceAreaStatus";
  incoming: unknown;
  incomingStatus?: FieldStatus;
  existing: unknown;
  existingStatus?: FieldStatus;
  phoneContactConfirmed?: boolean;
}): boolean {
  if (
    args.incoming === null || args.incoming === undefined ||
    args.incoming === ""
  ) {
    return false;
  }
  const status = args.incomingStatus ?? "unknown";
  const explicitlyConfirmed = status === "verified" || status === "corrected" ||
    (args.field === "phone" && args.phoneContactConfirmed === true);
  if (!explicitlyConfirmed) return false;
  if (
    args.existing === null || args.existing === undefined ||
    args.existing === ""
  ) {
    return true;
  }
  if (String(args.existing) === String(args.incoming)) return true;
  const previousRank = STATUS_RANK[args.existingStatus ?? "verified"];
  return STATUS_RANK[status] >= previousRank;
}

function mayProjectFact(args: {
  incoming: unknown;
  incomingStatus?: FieldStatus;
  existing: unknown;
  existingStatus?: FieldStatus;
}): boolean {
  if (args.incoming === null || args.incoming === undefined) return false;
  if (args.existing === null || args.existing === undefined) return true;
  if (String(args.existing) === String(args.incoming)) return true;
  return STATUS_RANK[args.incomingStatus ?? "unknown"] >=
    STATUS_RANK[args.existingStatus ?? "verified"];
}

function canonicalConversationState(session: QuoteSession): string {
  const step = session.lastStep ?? "";
  if (step === "booking_confirmed") return "booked";
  if (step === "booking_submitting") return "booking_in_progress";
  if (step === "confirming_booking") return "awaiting_booking_confirmation";
  if (step === "awaiting_slot_selection") return "checking_availability";
  if (step === "availability_blocked") return "error_recovery";
  if (session.quoteStatus === "manual_review") return "manual_review";
  if (session.quoteStatus === "firm" || session.quoteStatus === "estimated") {
    return "quote_ready";
  }
  return session.fields.services?.length
    ? "collecting_property_details"
    : "identifying_need";
}

function canonicalBookingStatus(session: QuoteSession): string {
  const status = session.fields.voiceJourney?.booking?.status;
  if (status === "confirmed") return "confirmed";
  if (status === "recovery_pending") return "needs_attention";
  if (status === "failed") return "failed";
  if (session.quoteStatus === "firm" || session.quoteStatus === "estimated") {
    return "quoted";
  }
  return "none";
}

function quoteFacts(fields: QuoteSessionFields): ConversationFacts["quote"] {
  const last = fields.lastQuoteResult;
  if (!last) return null;
  const total = typeof last.estimatedTotal === "number"
    ? last.estimatedTotal
    : typeof last.total === "number"
    ? last.total
    : null;
  const status = typeof last.status === "string" ? last.status : undefined;
  return {
    status,
    firm: last.finalQuoteDisposition
      ? last.finalQuoteDisposition === "firm"
      : status === "firm",
    total,
    serviceSubtotal: typeof last.serviceSubtotal === "number"
      ? last.serviceSubtotal
      : null,
    estimatedTax: typeof last.estimatedTax === "number"
      ? last.estimatedTax
      : null,
    estimatedTotal: total,
    taxPolicyVersion: typeof last.taxPolicyVersion === "string"
      ? last.taxPolicyVersion
      : null,
    lineItems: Array.isArray(last.lineItems) ? last.lineItems : [],
    pricingVersion: typeof last.ruleVersion === "number"
      ? last.ruleVersion
      : null,
    engineVersion: typeof last.engineVersion === "string"
      ? last.engineVersion
      : null,
    inputsKey: typeof last.inputsKey === "string" ? last.inputsKey : undefined,
  };
}

/** Pure projection builder. Contact/address columns are confirmed-only. */
export function buildQuoteSessionConversationProjection(args: {
  session: QuoteSession;
  conversation: ConversationProjectionRow;
  now?: string;
}): Record<string, unknown> {
  const { session, conversation } = args;
  const fields = session.fields;
  const priorFacts =
    conversation.facts && typeof conversation.facts === "object"
      ? conversation.facts as ConversationFacts & Record<string, unknown>
      : {} as ConversationFacts & Record<string, unknown>;
  const priorProjection = existingMetadata(priorFacts);
  const previousStatus = priorProjection?.fieldStatus ?? {};
  const patch: Record<string, unknown> = {
    quote_session_id: session.id,
    services_discussed: evaluateQuoteIntake(
      fields as unknown as Record<string, unknown>,
    ).services,
    quote_result: fields.lastQuoteResult ?? null,
    conversation_state: canonicalConversationState(session),
    customer_id: session.customerId ?? conversation.customer_id ?? null,
    property_id: session.propertyId ?? conversation.property_id ?? null,
    booking_status: canonicalBookingStatus(session),
    selected_slot_id: fields.voiceJourney?.availability?.selectedSlotId ?? null,
    last_activity_at: args.now ?? new Date().toISOString(),
  };

  const candidates = [
    ["name", "prospect_name"],
    ["email", "prospect_email"],
    ["phone", "prospect_phone"],
    ["address", "service_address"],
    ["serviceAreaStatus", "service_area_status"],
  ] as const;
  for (const [field, column] of candidates) {
    const incoming = fields[field];
    if (
      mayProjectContact({
        field,
        incoming,
        incomingStatus: session.fieldStatus[field],
        existing: conversation[column],
        existingStatus: previousStatus[field],
        phoneContactConfirmed:
          fields.callerIdConfirmationStatus === "contact_confirmed" ||
          fields.callerIdConfirmationStatus === "confirmed",
      })
    ) patch[column] = incoming;
  }
  if (patch.service_area_status) {
    patch.service_area_result = fields.serviceAreaResult ?? null;
  }

  const contact = { ...(priorFacts.contact ?? {}) };
  if (patch.prospect_name) contact.name = String(patch.prospect_name);
  if (patch.prospect_email) contact.email = String(patch.prospect_email);
  if (patch.prospect_phone) {
    contact.phone = String(patch.prospect_phone);
    contact.phoneConfirmed = true;
  }
  const property = { ...(priorFacts.property ?? {}) };
  const propertyCandidates = [
    ["squareFootage", "squareFootage"],
    ["stories", "stories"],
    ["windowCleaningSides", "windowCleaningType"],
    ["condition", "condition"],
    ["roofType", "roofType"],
    ["roofSeverity", "roofSeverity"],
    ["drivewaySqft", "drivewaySqft"],
    ["drivewaySurface", "drivewaySurface"],
    ["pressureWashSqft", "pressureWashSqft"],
    ["pressureWashSurface", "pressureWashSurface"],
  ] as const;
  for (const [field, factKey] of propertyCandidates) {
    const incoming = fields[field];
    if (
      mayProjectFact({
        incoming,
        incomingStatus: session.fieldStatus[field],
        existing: property[factKey],
        existingStatus: previousStatus[field],
      })
    ) property[factKey] = incoming as never;
  }
  const facts: ConversationFacts & Record<string, unknown> = {
    ...priorFacts,
    services: patch.services_discussed as string[],
    property,
    quote: quoteFacts(fields),
    bookingStatus: patch.booking_status as string,
    selectedSlotId: patch.selected_slot_id as string | null,
    contact,
    quoteByText: fields.voiceJourney?.delivery
      ? {
        pending: fields.voiceJourney.delivery.status === "pending" ||
          fields.voiceJourney.delivery.status === "queued" ||
          fields.voiceJourney.delivery.status === "retry_pending",
        lastReason: fields.voiceJourney.delivery.status,
        missingField: null,
      }
      : priorFacts.quoteByText,
    canonicalProjection: {
      version: PROJECTION_VERSION,
      sessionId: session.id,
      fieldStatus: session.fieldStatus,
      projectedAt: patch.last_activity_at,
    },
  };
  if (patch.service_address) facts.address = String(patch.service_address);
  if (patch.service_area_status) {
    facts.serviceArea = {
      ...((fields.serviceAreaResult ?? {}) as Record<string, unknown>),
      status: String(patch.service_area_status),
      formattedAddress: String(patch.service_address ?? fields.address ?? ""),
    } as ConversationFacts["serviceArea"];
  }
  patch.facts = facts;
  return patch;
}

export type QuoteSessionProjectionResult =
  | {
    status: "projected" | "noop";
    attempts: number;
    /** Exact tenant-scoped session snapshot already read for projection. */
    session?: QuoteSession;
  }
  | { status: "conflict" | "error"; reason: string; attempts: number };

export function quoteSessionFromPersistenceRow(
  row: Record<string, unknown>,
): QuoteSession {
  return {
    id: String(row.id),
    organizationId: row.organization_id as string | null,
    channel: row.channel as QuoteSession["channel"],
    conversationIds: (row.conversation_ids as string[]) ?? [],
    customerId: row.customer_id as string | null,
    propertyId: row.property_id as string | null,
    quoteId: row.quote_id as string | null,
    fields: (row.fields as QuoteSessionFields) ?? {},
    fieldStatus: (row.field_status as QuoteSession["fieldStatus"]) ?? {},
    requiredRemaining: (row.required_remaining as string[]) ?? [],
    lastStep: row.last_step as string | null,
    quoteStatus: (row.quote_status as QuoteSession["quoteStatus"]) ?? "none",
    bookingReady: !!row.booking_ready,
    phoneE164: row.phone_e164 as string | null,
    emailNormalized: row.email_normalized as string | null,
    updatedAt: row.updated_at as string | null,
  };
}

export async function readScopedQuoteSession(
  supabase: SB,
  sessionId: string,
  organizationId: string,
): Promise<QuoteSession | null> {
  const result = await supabase.from("quote_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return !result?.error && result?.data
    ? quoteSessionFromPersistenceRow(result.data)
    : null;
}

/** Scoped optimistic projection with one winner re-read/rebase. */
export async function projectQuoteSessionToConversation(
  supabase: SB,
  args: {
    sessionId: string;
    conversationId: string;
    organizationId: string;
  },
): Promise<QuoteSessionProjectionResult> {
  try {
    const sessionRead = await supabase.from("quote_sessions")
      .select("*")
      .eq("id", args.sessionId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();
    if (sessionRead?.error || !sessionRead?.data) {
      return {
        status: "error",
        reason: "quote_session_unavailable",
        attempts: 0,
      };
    }
    const session = quoteSessionFromPersistenceRow(sessionRead.data);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const conversationRead = await supabase.from("chat_conversations")
        .select(
          "id, organization_id, updated_at, quote_session_id, services_discussed, prospect_name, prospect_email, prospect_phone, service_address, service_area_status, service_area_result, quote_result, conversation_state, facts, customer_id, property_id, booking_status, selected_slot_id",
        )
        .eq("id", args.conversationId)
        .eq("organization_id", args.organizationId)
        .maybeSingle();
      if (conversationRead?.error || !conversationRead?.data) {
        return {
          status: "error",
          reason: "conversation_unavailable",
          attempts: attempt,
        };
      }
      const conversation = conversationRead.data as ConversationProjectionRow;
      const lineageConflict = quoteSessionConversationLineageConflict(
        session,
        conversation,
      );
      if (lineageConflict) {
        return {
          status: "error",
          reason: lineageConflict,
          attempts: attempt,
        };
      }
      let update = supabase.from("chat_conversations")
        .update(
          buildQuoteSessionConversationProjection({ session, conversation }),
        )
        .eq("id", args.conversationId)
        .eq("organization_id", args.organizationId);
      if (conversation.updated_at) {
        update = update.eq("updated_at", conversation.updated_at);
      }
      const written = await update.select("id").maybeSingle();
      if (written?.error) {
        return {
          status: "error",
          reason: "conversation_projection_failed",
          attempts: attempt,
        };
      }
      if (written?.data) {
        return { status: "projected", attempts: attempt, session };
      }
    }
    return { status: "conflict", reason: "conversation_changed", attempts: 2 };
  } catch {
    return {
      status: "error",
      reason: "conversation_projection_failed",
      attempts: 0,
    };
  }
}
