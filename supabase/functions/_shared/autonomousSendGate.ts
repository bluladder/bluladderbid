// ============================================================================
// autonomousSendGate — the ONE canonical, fail-CLOSED boundary that EVERY
// AI-originated outbound SMS must pass through immediately before the wire
// call to CallRail. Composes:
//
//   1. aiSafetyGate  (kill switch, conversation pause, staff takeover,
//                     STOP suppression, autobook switch)
//   2. identityAnchor (resolved / ambiguous / unresolved / unreadable)
//   3. action-class rules — different actions require different anchors
//
// ACTION CLASSES
//   informational          general business info, hours, service area
//   identity_resolution    the ONE email-disambiguation ask permitted
//                          while identity is ambiguous
//   quote_advancement      attaching a quote session to a customer,
//                          persisting a customer-specific quote step
//   scheduling             choosing / offering a slot for THIS customer
//   booking_confirmation   summarising the appointment for explicit yes/no
//   booking_execution      actually creating the appointment
//
// ENFORCEMENT
//   Callers MUST use `sendAutonomousCallRailSms` (below). There is NO
//   `skipSafety` bypass parameter. Transactional / staff-initiated /
//   compliance (STOP/START) sends stay on their existing dedicated paths
//   and are explicitly out of scope for this gate.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { normalizePhone, sendCallRailSms } from "./sms.ts";
import type { CallRailConfig } from "./sms.ts";
import {
  evaluateAiSafetyGate,
  logGateDecision,
  type SafetyBlockReason,
  type SafetyDecision,
} from "./aiSafetyGate.ts";
import { readIdentityAnchor, type IdentityAnchor } from "./identityAnchor.ts";

type Supa = any;

export type ActionClass =
  | "informational"
  | "identity_resolution"
  | "quote_advancement"
  | "scheduling"
  | "booking_confirmation"
  | "booking_execution";

export type AutonomousBlockReason =
  | SafetyBlockReason
  | "identity_unreadable"
  | "identity_ambiguous"
  | "identity_unresolved"
  | "identity_resolution_required"
  | "identity_resolution_already_sent"
  | "autonomous_send_gate_unreadable"
  | "action_class_not_permitted";

export interface AutonomousGateInput {
  conversationId: string | null | undefined;
  phone: string | null | undefined;
  actionClass: ActionClass;
}

export interface AutonomousGateDecision {
  allow: boolean;
  actionClass: ActionClass;
  reason?: AutonomousBlockReason;
  detail?: string;
  safety?: SafetyDecision;
  identity?: IdentityAnchor;
}

/** Which action classes require a deterministic customer anchor. */
const REQUIRES_RESOLVED = new Set<ActionClass>([
  "quote_advancement",
  "scheduling",
  "booking_confirmation",
  "booking_execution",
]);

const KNOWN_ACTIONS = new Set<ActionClass>([
  "informational",
  "identity_resolution",
  "quote_advancement",
  "scheduling",
  "booking_confirmation",
  "booking_execution",
]);

/**
 * The canonical send-boundary gate. Callers pass the classified action; the
 * gate composes safety + identity rules and returns a structured decision.
 * Never sends anything itself.
 */
export async function evaluateAutonomousSendGate(
  supabase: Supa,
  input: AutonomousGateInput,
): Promise<AutonomousGateDecision> {
  const { conversationId, phone, actionClass } = input;
  const deny = (
    reason: AutonomousBlockReason,
    extra: Partial<AutonomousGateDecision> = {},
  ): AutonomousGateDecision =>
    ({ allow: false, actionClass, reason, ...extra });

  if (!KNOWN_ACTIONS.has(actionClass)) {
    return deny("action_class_not_permitted", { detail: `unknown_action:${actionClass}` });
  }

  // 1. Base safety (kill switch, pause, takeover, suppression).
  //    booking_execution additionally requires the autobook switch.
  let safety: SafetyDecision;
  try {
    safety = await evaluateAiSafetyGate(supabase, {
      action: actionClass === "booking_execution" ? "autobook" : "auto_reply",
      conversationId: conversationId ?? null,
      phone: phone ?? null,
    });
  } catch (e) {
    return deny("autonomous_send_gate_unreadable", { detail: String(e).slice(0, 200) });
  }
  if (!safety.allow) {
    return deny(safety.reason as AutonomousBlockReason, { safety, detail: safety.detail });
  }

  // 2. Identity anchor.
  let identity: IdentityAnchor;
  try {
    identity = await readIdentityAnchor(supabase, conversationId ?? null);
  } catch (e) {
    return deny("identity_unreadable", { detail: String(e).slice(0, 200) });
  }
  if (identity.identity_status === "unreadable") {
    return deny("identity_unreadable", { safety, identity, detail: identity.error });
  }

  // 3. Action-class rules.
  //    informational and identity_resolution never require an anchor —
  //    those messages are how we OBTAIN one.
  if (actionClass === "informational" || actionClass === "identity_resolution") {
    return { allow: true, actionClass, safety, identity };
  }

  // Anything that requires an anchor:
  if (REQUIRES_RESOLVED.has(actionClass)) {
    if (identity.identity_status === "ambiguous") {
      return deny("identity_ambiguous", { safety, identity });
    }
    if (identity.identity_status === "unresolved") {
      return deny("identity_unresolved", { safety, identity });
    }
    // resolved
    return { allow: true, actionClass, safety, identity };
  }

  return deny("action_class_not_permitted");
}

/**
 * Sole permitted call site for autonomous outbound SMS. Evaluates the gate,
 * blocks if not explicitly allowed, otherwise dispatches to CallRail and
 * writes the sms_messages row. Never accepts a `skipSafety` flag.
 *
 * Returns a structured result the caller records / surfaces to admin.
 */
export interface AutonomousSendInput {
  conversationId: string | null | undefined;
  phone: string | null | undefined;
  actionClass: ActionClass;
  body: string;
  callRail: CallRailConfig;
  /** message_kind stamped on the sms_messages row. */
  messageKind: string;
  /** Optional dedupe of "one identity resolution ask per ambiguous window"
   *  when actionClass === "identity_resolution". */
  dedupeIdentityResolution?: boolean;
  /** Correlation for structured logging. */
  where?: string;
  extraLog?: Record<string, unknown>;
}

export interface AutonomousSendResult {
  sent: boolean;
  decision: AutonomousGateDecision;
  /** CallRail's provider message id, when the send succeeded. */
  messageId?: string | null;
  /** Our own sms_messages.id — needed to attach outbound delivery evidence
   *  to a presentation record. Null when the write failed. */
  smsMessageId?: string | null;
  error?: string;
  /** True when this call returned a prior send for the same
   *  outboundIdempotencyKey WITHOUT invoking CallRail again. */
  idempotentReplay?: boolean;
}

export async function sendAutonomousCallRailSms(
  supabase: Supa,
  input: AutonomousSendInput,
): Promise<AutonomousSendResult> {
  const phoneNorm = normalizePhone(input.phone ?? null);
  const decision = await evaluateAutonomousSendGate(supabase, {
    conversationId: input.conversationId,
    phone: phoneNorm ?? input.phone,
    actionClass: input.actionClass,
  });

  // Optional dedupe: at most ONE identity-resolution SMS while the thread is
  // ambiguous, so retry/replay of the same inbound event can't produce a
  // second "what email should I use?" message.
  if (
    decision.allow &&
    input.actionClass === "identity_resolution" &&
    input.dedupeIdentityResolution !== false &&
    phoneNorm
  ) {
    try {
      // Dedupe by (to_number, message_kind) within a 24h window — the
      // sms_messages table has no conversation_id column so we scope by
      // phone + message_kind, which is stable per thread.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("sms_messages")
        .select("id")
        .eq("to_number", phoneNorm)
        .eq("message_kind", input.messageKind)
        .in("status", ["sent", "queued", "pending"])
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        const blocked: AutonomousGateDecision = {
          allow: false,
          actionClass: input.actionClass,
          reason: "identity_resolution_already_sent",
          safety: decision.safety,
          identity: decision.identity,
        };
        logGateDecision(input.where ?? "autonomousSendGate", {
          allow: false, action: "auto_reply", reason: undefined, checks: decision.safety?.checks ?? {},
        }, {
          ...(input.extraLog ?? {}),
          gate_reason: "identity_resolution_already_sent",
          action_class: input.actionClass,
        });
        return { sent: false, decision: blocked };
      }
    } catch (e) {
      // Dedupe read failed → fail closed on the identity-resolution send.
      const blocked: AutonomousGateDecision = {
        allow: false,
        actionClass: input.actionClass,
        reason: "autonomous_send_gate_unreadable",
        detail: String(e).slice(0, 200),
        safety: decision.safety,
        identity: decision.identity,
      };
      return { sent: false, decision: blocked };
    }
  }

  // Structured log for every decision — the ops team greps on this.
  logGateDecision(input.where ?? "autonomousSendGate", {
    allow: decision.allow,
    action: input.actionClass === "booking_execution" ? "autobook" : "auto_reply",
    reason: decision.reason as SafetyBlockReason | undefined,
    checks: decision.safety?.checks ?? {},
  }, {
    ...(input.extraLog ?? {}),
    action_class: input.actionClass,
    identity_status: decision.identity?.identity_status ?? null,
    gate_reason: decision.reason ?? null,
  });

  if (!decision.allow) {
    return { sent: false, decision };
  }

  if (!phoneNorm) {
    return {
      sent: false,
      decision: { ...decision, allow: false, reason: "phone_missing" },
    };
  }

  const result = await sendCallRailSms(input.callRail, phoneNorm, input.body);
  const nowIso = new Date().toISOString();
  const { data: inserted } = await supabase
    .from("sms_messages")
    .insert({
      to_number: phoneNorm,
      body: input.body,
      message_kind: input.messageKind,
      status: result.ok ? "sent" : "failed",
      provider_message_id: result.messageId ?? null,
      error: result.ok ? null : result.error ?? null,
      sent_at: result.ok ? nowIso : null,
    })
    .select("id")
    .maybeSingle();
  return {
    sent: result.ok,
    decision,
    messageId: result.messageId ?? null,
    smsMessageId: (inserted?.id as string | undefined) ?? null,
    error: result.ok ? undefined : result.error ?? undefined,
  };
}