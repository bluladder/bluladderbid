// ============================================================================
// aiSafetyGate — the ONE canonical fail-CLOSED safety gate for every
// autonomous AI action (auto-drafting inbound replies, requesting a slot
// hold, sending a booking-confirmation summary, executing autobook). Every
// autonomous surface MUST route its "is it safe to act right now?" question
// through this module. Callers pass an explicit `action` (auto_reply |
// autobook) so the correct set of switches is verified.
//
// FAIL-CLOSED CONTRACT
//   Any read error, any indeterminate switch value, any missing conversation
//   row, any missing suppression lookup — all block the action. A transient
//   DB blip must NEVER cause the AI to speak or write. The tradeoff is
//   accepted: it is far better to briefly stop auto-replying than to bypass
//   a kill switch or send a message to an opted-out recipient.
//
// The gate never itself sends, writes, or logs to the database. It returns a
// structured decision the caller records / surfaces to staff.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { normalizePhone } from "./sms.ts";

type Supa = any;

/** Action the caller is about to take. Different actions require different
 *  switches (e.g. autobook additionally requires ai_sms_autobook_enabled). */
export type SafetyAction = "auto_reply" | "autobook";

/** Structured skip reason. Stable strings — used by admin UI and tests. */
export type SafetyBlockReason =
  | "ai_sms_kill_switch_disabled"
  | "ai_sms_kill_switch_unreadable"
  | "ai_autobook_switch_disabled"
  | "ai_autobook_switch_unreadable"
  | "conversation_missing"
  | "conversation_unreadable"
  | "conversation_paused"
  | "staff_takeover_active"
  | "phone_suppressed"
  | "phone_suppression_unreadable"
  | "phone_missing";

export interface SafetyDecision {
  allow: boolean;
  action: SafetyAction;
  /** Populated when allow=false. First failing gate wins. */
  reason?: SafetyBlockReason;
  /** Non-fatal detail for logs; never surfaced to customer. */
  detail?: string;
  /** Snapshot of what the gate observed (undefined = indeterminate). */
  checks: {
    aiSmsEnabled?: boolean;
    aiAutobookEnabled?: boolean;
    conversationPaused?: boolean;
    staffTakeoverAt?: string | null;
    phoneOptedOut?: boolean;
  };
}

export interface SafetyEvaluateInput {
  action: SafetyAction;
  conversationId: string | null | undefined;
  phone: string | null | undefined;
  /** Test-only override; when omitted we read production tables. */
  now?: Date;
}

const CONFIG_TABLE = "system_test_config";
const CONFIG_ROW_ID = "default";

/**
 * Read the global AI SMS + autobook kill switches. Any error or missing row
 * yields `undefined` for the affected switch — the caller treats undefined
 * as blocked.
 */
export async function readGlobalSwitches(
  supabase: Supa,
): Promise<{
  aiSmsEnabled?: boolean;
  aiAutobookEnabled?: boolean;
  error?: string;
}> {
  try {
    const { data, error } = await supabase
      .from(CONFIG_TABLE)
      .select("ai_sms_enabled, ai_sms_autobook_enabled")
      .eq("id", CONFIG_ROW_ID)
      .maybeSingle();
    if (error) return { error: error.message ?? String(error) };
    if (!data) return { error: "config_row_missing" };
    const sms = typeof data.ai_sms_enabled === "boolean" ? data.ai_sms_enabled : undefined;
    const auto = typeof data.ai_sms_autobook_enabled === "boolean"
      ? data.ai_sms_autobook_enabled : undefined;
    return { aiSmsEnabled: sms, aiAutobookEnabled: auto };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

/**
 * Read per-conversation pause + staff-takeover state. Missing row and any
 * error both return `error` — caller treats as blocked.
 */
export async function readConversationState(
  supabase: Supa,
  conversationId: string,
): Promise<{
  paused?: boolean;
  staffTakeoverAt?: string | null;
  error?: string;
}> {
  try {
    const { data, error } = await supabase
      .from("chat_conversations")
      .select("ai_autoreply_paused, staff_takeover_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) return { error: error.message ?? String(error) };
    if (!data) return { error: "conversation_missing" };
    return {
      paused: typeof data.ai_autoreply_paused === "boolean"
        ? data.ai_autoreply_paused : undefined,
      staffTakeoverAt: (data.staff_takeover_at as string | null) ?? null,
    };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

/**
 * Fail-CLOSED suppression check. Distinct from the fail-open helper in sms.ts
 * (which is used inside outbound message senders that already have their own
 * safeguards). Autonomous AI action must never proceed when suppression is
 * unreadable.
 */
export async function readPhoneOptedOut(
  supabase: Supa,
  phone: string,
): Promise<{ optedOut?: boolean; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("sms_opt_outs")
      .select("opted_out")
      .eq("phone", phone)
      .maybeSingle();
    if (error) return { error: error.message ?? String(error) };
    return { optedOut: !!(data && data.opted_out === true) };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

/**
 * Evaluate whether an autonomous AI action may proceed right now. Returns a
 * structured decision. Any indeterminate state ⇒ allow=false.
 */
export async function evaluateAiSafetyGate(
  supabase: Supa,
  input: SafetyEvaluateInput,
): Promise<SafetyDecision> {
  const checks: SafetyDecision["checks"] = {};
  const deny = (reason: SafetyBlockReason, detail?: string): SafetyDecision =>
    ({ allow: false, action: input.action, reason, detail, checks });

  // 1. phone must be present + normalizable (needed for suppression lookup).
  const normalizedPhone = normalizePhone(input.phone ?? null);
  if (!normalizedPhone) return deny("phone_missing");

  // 2. conversation id must be present (autonomous action always ties to
  //    a resolved thread — anonymous ingestion never reaches this gate).
  if (!input.conversationId) return deny("conversation_missing");

  // 3. global switches — kill switch is the most critical gate; check first.
  const globals = await readGlobalSwitches(supabase);
  checks.aiSmsEnabled = globals.aiSmsEnabled;
  checks.aiAutobookEnabled = globals.aiAutobookEnabled;
  if (globals.error !== undefined || globals.aiSmsEnabled === undefined) {
    return deny("ai_sms_kill_switch_unreadable", globals.error);
  }
  if (globals.aiSmsEnabled === false) return deny("ai_sms_kill_switch_disabled");

  if (input.action === "autobook") {
    if (globals.aiAutobookEnabled === undefined) {
      return deny("ai_autobook_switch_unreadable");
    }
    if (globals.aiAutobookEnabled === false) {
      return deny("ai_autobook_switch_disabled");
    }
  }

  // 4. per-conversation pause + staff takeover.
  const conv = await readConversationState(supabase, input.conversationId);
  checks.conversationPaused = conv.paused;
  checks.staffTakeoverAt = conv.staffTakeoverAt ?? null;
  if (conv.error === "conversation_missing") return deny("conversation_missing");
  if (conv.error) return deny("conversation_unreadable", conv.error);
  if (conv.paused === undefined) return deny("conversation_unreadable", "paused_indeterminate");
  if (conv.paused === true) return deny("conversation_paused");
  if (conv.staffTakeoverAt) return deny("staff_takeover_active", conv.staffTakeoverAt);

  // 5. suppression / STOP.
  const opt = await readPhoneOptedOut(supabase, normalizedPhone);
  checks.phoneOptedOut = opt.optedOut;
  if (opt.error !== undefined || opt.optedOut === undefined) {
    return deny("phone_suppression_unreadable", opt.error);
  }
  if (opt.optedOut === true) return deny("phone_suppressed");

  return { allow: true, action: input.action, checks };
}

/**
 * Convenience: emit a structured console line the ops team can grep on. The
 * gate itself is silent — callers own logging so the block reason can be
 * correlated with the specific inbound event / conversation.
 */
export function logGateDecision(
  where: string,
  decision: SafetyDecision,
  extra?: Record<string, unknown>,
) {
  const line = {
    at: "aiSafetyGate",
    where,
    action: decision.action,
    allow: decision.allow,
    reason: decision.reason ?? null,
    detail: decision.detail ?? null,
    checks: decision.checks,
    ...(extra ?? {}),
  };
  if (decision.allow) console.info(JSON.stringify(line));
  else console.warn(JSON.stringify(line));
}