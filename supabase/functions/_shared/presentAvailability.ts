// ============================================================================
// presentAvailability — the ONE orchestrator that turns an authoritative
// availability lookup into a customer-facing SMS AND persists an interpretable
// presentation record. Composes:
//
//   * availabilityLookup.getAvailableSlots   — read-only options + preconds
//   * presentation.createPendingPresentation → activate/mark-failed lifecycle
//   * autonomousSendGate.sendAutonomousCallRailSms — action_class="scheduling"
//
// SAFETY / LIFECYCLE INVARIANTS
//   1. Idempotent per (conversation, inbound_sms_id, session, inputs, prefs,
//      slots signature). A duplicate call returns the SAME presentation and
//      does NOT send a second SMS.
//   2. Options persisted BEFORE send. The wire body is formatted from the
//      persisted `options` array — the model cannot rewrite, reorder, or
//      omit slots after persistence.
//   3. Send success  → presentation flipped to `active`, prior active
//                       presentation atomically superseded.
//      Send failure  → presentation flipped to `send_failed`, prior active
//                       presentation UNTOUCHED (customer can still reply to
//                       the old options).
//   4. Never reserves capacity, holds a slot, or creates a booking.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import {
  getAvailableSlots,
  type AvailabilityLookupInput,
  type AvailabilityLookupResult,
  type AvailabilitySlot,
} from "./availabilityLookup.ts";
import {
  activatePresentationAfterSend,
  createPendingPresentation,
  markPresentationSendFailed,
  type PresentationRow,
} from "./presentation.ts";
import { sendAutonomousCallRailSms } from "./autonomousSendGate.ts";
import { getCallRailConfig } from "./sms.ts";

type SB = any;

export interface PresentAvailabilityInput {
  conversationId: string;
  phone: string;
  /** Inbound message that triggered this presentation — part of the
   *  idempotency key so a webhook retry never sends a second SMS. */
  triggeringInboundSmsId: string | null;
  preference: AvailabilityLookupInput;
}

export type PresentAvailabilityStatus =
  | "sent"
  | "reused"
  | "not_ready"
  | "no_slots"
  | "preference_ambiguous"
  | "gate_blocked"
  | "schedule_drifted"
  | "engine_error"
  | "send_failed"
  | "callrail_unconfigured";

export interface PresentAvailabilityResult {
  status: PresentAvailabilityStatus;
  presentation?: PresentationRow | null;
  availability?: AvailabilityLookupResult;
  outboundBody?: string | null;
  smsMessageId?: string | null;
  detail?: string | null;
}

/** Deterministic idempotency key. Same conversation, same triggering inbound,
 *  same session+inputs+preference+slots ⇒ same key ⇒ same presentation row.
 *  A materially different preference or a different slots signature yields a
 *  different key and therefore a NEW presentation. */
export function buildPresentationIdempotencyKey(args: {
  conversationId: string;
  triggeringInboundSmsId: string | null;
  quoteSessionId: string | null;
  inputsKey: string | null;
  pricingVersion: string | null;
  preference: AvailabilityLookupInput;
  slots: AvailabilitySlot[];
}): string {
  const p = args.preference ?? {};
  const prefSig = [
    p.preferred_date ?? "",
    p.preferred_day ?? "",
    p.time_of_day ?? "",
    String(p.max_options ?? ""),
  ].join("|");
  const slotSig = args.slots
    .map((s) => `${s.start_at}~${s.end_at}`)
    .join(",");
  return [
    args.conversationId,
    args.triggeringInboundSmsId ?? "no_inbound",
    args.quoteSessionId ?? "no_session",
    args.inputsKey ?? "no_inputs",
    args.pricingVersion ?? "no_pricing",
    prefSig,
    slotSig,
  ].join("::");
}

/** Deterministic customer-visible message body built from the PERSISTED
 *  options array. The formatter is pure and never re-orders. */
export function formatOptionsMessage(
  presentation: Pick<PresentationRow, "options">,
): string {
  const opts = (presentation.options ?? []) as Array<
    AvailabilitySlot & { option_number: number }
  >;
  if (opts.length === 0) return "";
  const lines = opts.map((o) => {
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: o.timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(o.start_at));
    return `${o.option_number}) ${dateLabel} · ${o.customer_label ?? o.arrival_window_label}`;
  });
  return [
    "Here are the next openings:",
    ...lines,
    "Reply with the option number (1, 2, or 3) to pick one — I'll verify the opening before we confirm.",
  ].join("\n");
}

export async function presentAvailability(
  supabase: SB,
  input: PresentAvailabilityInput,
): Promise<PresentAvailabilityResult> {
  const availability = await getAvailableSlots(
    supabase,
    input.conversationId,
    input.preference,
  );

  if (availability.status === "gate_blocked") {
    return { status: "gate_blocked", availability, detail: availability.gate_reason ?? null };
  }
  if (availability.status === "not_ready") {
    return { status: "not_ready", availability };
  }
  if (availability.status === "preference_ambiguous") {
    return { status: "preference_ambiguous", availability };
  }
  if (availability.status === "schedule_drifted") {
    return { status: "schedule_drifted", availability, detail: availability.detail ?? null };
  }
  if (availability.status === "engine_error") {
    return { status: "engine_error", availability, detail: availability.detail ?? null };
  }
  if (availability.status !== "ok" || availability.slots.length === 0) {
    return { status: "no_slots", availability };
  }

  // Pull authoritative context for the presentation row.
  const [convoRes, sessRes] = await Promise.all([
    supabase
      .from("chat_conversations")
      .select("id, quote_session_id, property_id")
      .eq("id", input.conversationId)
      .maybeSingle(),
    supabase
      .from("quote_sessions")
      .select("id, fields")
      .eq("conversation_id", input.conversationId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const convo = (convoRes as any).data ?? null;
  const session = (sessRes as any).data ?? null;
  const lastQuote = (session?.fields ?? {}).lastQuoteResult ?? null;
  const inputsKey: string | null = lastQuote?.inputsKey ?? null;
  const pricingVersion: string | null =
    availability.readiness?.quote?.pricing_version ??
    lastQuote?.ruleVersion ??
    null;

  const idempotencyKey = buildPresentationIdempotencyKey({
    conversationId: input.conversationId,
    triggeringInboundSmsId: input.triggeringInboundSmsId,
    quoteSessionId: session?.id ?? null,
    inputsKey,
    pricingVersion,
    preference: input.preference,
    slots: availability.slots,
  });

  const pending = await createPendingPresentation(supabase, {
    conversationId: input.conversationId,
    idempotencyKey,
    quoteSessionId: session?.id ?? convo?.quote_session_id ?? null,
    propertyId: convo?.property_id ?? null,
    inputsKey,
    pricingVersion,
    quoteSignature: null,
    authoritativeDurationMinutes:
      availability.readiness?.duration?.minutes ?? null,
    canonicalTotalCents: Math.round(
      Number(availability.readiness?.quote?.canonical_total ?? 0) * 100,
    ),
    slots: availability.slots,
    // Phase 5: persist the canonical backend identity anchored at
    // presentation time so downstream selection handling can prove
    // deterministic equality without hashing.
    resolvedCustomerId:
      availability.readiness?.identity?.resolved_customer_id ?? null,
    identityResolutionMethod:
      availability.readiness?.identity?.resolution_method ?? null,
  });
  if (!pending.row) {
    return { status: "engine_error", availability, detail: pending.error ?? "presentation_create_failed" };
  }

  // Idempotent short-circuit: same key ⇒ same row. If it's already active or
  // pending_send from a prior call, do NOT send again.
  if (pending.reused) {
    return {
      status: "reused",
      presentation: pending.row,
      availability,
      outboundBody: pending.row.outbound_message_preview ?? null,
      smsMessageId: pending.row.outbound_sms_id ?? null,
    };
  }

  // Format from the PERSISTED row (not the raw engine response).
  const body = formatOptionsMessage(pending.row);

  const callrail = getCallRailConfig();
  if (!callrail) {
    await markPresentationSendFailed(supabase, pending.row.id, "callrail_unconfigured");
    return { status: "callrail_unconfigured", presentation: pending.row, availability };
  }

  const outcome = await sendAutonomousCallRailSms(supabase, {
    conversationId: input.conversationId,
    phone: input.phone,
    actionClass: "scheduling",
    body,
    callRail: callrail,
    messageKind: "ai_availability_options",
    where: "presentAvailability",
    extraLog: {
      presentation_id: pending.row.id,
      idempotency_key: idempotencyKey,
    },
  });

  if (!outcome.sent) {
    await markPresentationSendFailed(
      supabase,
      pending.row.id,
      outcome.decision.reason ?? outcome.error ?? "send_failed",
    );
    return {
      status: outcome.decision.reason ? "gate_blocked" : "send_failed",
      presentation: pending.row,
      availability,
      outboundBody: body,
      detail: outcome.decision.reason ?? outcome.error ?? null,
    };
  }

  const activated = await activatePresentationAfterSend(supabase, pending.row.id, {
    outboundSmsId: outcome.smsMessageId ?? null,
    outboundMessagePreview: body,
  });

  return {
    status: "sent",
    presentation: activated,
    availability,
    outboundBody: body,
    smsMessageId: outcome.smsMessageId ?? null,
  };
}