// ============================================================================
// campaignSweep — logically-separated abandonment detection + critical-event
// recovery that RUNS INSIDE the existing process-sms-queue cron. There is NO
// separate cron and NO second queue: abandonment events flow through the same
// canonical campaign-event boundary, and recovery replays rows that already
// live in the existing campaign_events table.
//
// The pure helpers (computeEffectiveAbandonmentDelay, evaluateAbandonment,
// abandonmentIdempotencyKey) carry no I/O so they are directly unit-testable.
// ============================================================================
import { emitCampaignEvent, type SupabaseLike } from "./campaignEmitter.ts";

// Fallback delay used only when no quote_abandoned campaign configures one.
export const DEFAULT_ABANDONMENT_DELAY_MINUTES = 1440; // 24h

// Bounded per-invocation work. Small enough to never delay normal SMS/email
// queue processing (which runs first) and to keep each cron tick fast; oldest
// records first, with continuation across subsequent ticks. 25 abandonment
// candidates × (1 re-read + 1 emit) and 25 recovery replays is a few dozen
// short queries — comfortably within a single cron invocation.
export const ABANDONMENT_BATCH_SIZE = 25;
export const RECOVERY_BATCH_SIZE = 25;

// Events whose loss would break lifecycle correctness. Only these are persisted
// as recoverable pending rows and replayed by the cron.
export const CRITICAL_EVENTS = [
  "booking_completed",
  "appointment_rescheduled",
  "appointment_cancelled",
  "customer_replied",
  "consent_revoked",
  "manual_staff_takeover",
] as const;

export function isCriticalEvent(name: string): boolean {
  return (CRITICAL_EVENTS as readonly string[]).includes(name);
}

// Minimum positive configured delay wins; otherwise the fallback. Zero/negative
// / null values are ignored as unconfigured.
export function computeEffectiveAbandonmentDelay(
  configured: (number | null | undefined)[],
  fallback = DEFAULT_ABANDONMENT_DELAY_MINUTES,
): number {
  const valid = configured.filter((n): n is number => typeof n === "number" && n > 0);
  if (!valid.length) return fallback;
  return Math.min(...valid);
}

export interface AbandonmentConvo {
  id: string;
  quote_result: Record<string, unknown> | null;
  pricing_version: number | null;
  last_activity_at: string;
  resolved: boolean;
  booking_status: string | null;
  callback_requested: boolean;
  manual_review_reason: string | null;
  needs_attention?: boolean;
  staff_takeover_at: string | null;
  abandonment_emitted_version: string | null;
  campaign_status?: string | null;
}

// The version tag that identifies "this quote at this pricing version". A new
// pricing version yields a new tag, which is the ONLY re-entry allowed.
export function abandonmentVersionTag(convo: Pick<AbandonmentConvo, "pricing_version">): string {
  return `v${convo.pricing_version ?? 0}`;
}

export function abandonmentIdempotencyKey(convo: Pick<AbandonmentConvo, "id" | "pricing_version">): string {
  // quote_abandoned:{conversation_id}:{pricing_rule_version}:{window}
  return `quote_abandoned:${convo.id}:${abandonmentVersionTag(convo)}:1`;
}

// ---------------------------------------------------------------------------
// Persisted-quote (public.quotes) abandonment helpers.
//
// A firm persisted quote qualifies for `quote_abandoned` when ALL hold:
//   * a real quote id exists (row scanned by definition),
//   * status is one of the firm/held statuses (saved/emailed/viewed/pending),
//   * a positive numeric total exists,
//   * converted_booking_id is null (not booked),
//   * superseded_by is null (not replaced by a newer version),
//   * customer contact info (email or phone) exists,
//   * inactivity delay elapsed since last_activity_at,
//   * abandonment_emitted_version != current versionTag.
//
// Kept pure so it can be unit-tested directly and re-used by admin previews.
// ---------------------------------------------------------------------------
export interface PersistedQuoteRow {
  id: string;
  status: string | null;
  total: number | string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_id: string | null;
  pricing_rule_version: number | null;
  last_activity_at: string;
  converted_booking_id: string | null;
  superseded_by: string | null;
  abandonment_emitted_version: string | null;
  services_json: Record<string, unknown> | null;
  source_session_id: string | null;
  utm_params_json: Record<string, unknown> | null;
  attribution: Record<string, unknown> | null;
}

const FIRM_QUOTE_STATUSES = new Set(["saved", "emailed", "viewed", "pending"]);

export function persistedQuoteVersionTag(q: Pick<PersistedQuoteRow, "pricing_rule_version">): string {
  return `v${q.pricing_rule_version ?? 0}`;
}

export function persistedQuoteIdempotencyKey(q: Pick<PersistedQuoteRow, "id" | "pricing_rule_version">): string {
  return `quote_abandoned:${q.id}:${persistedQuoteVersionTag(q)}:1`;
}

export function evaluatePersistedQuoteAbandonment(
  q: PersistedQuoteRow,
  nowMs: number,
  delayMinutes: number,
): AbandonmentDecision {
  if (!FIRM_QUOTE_STATUSES.has(String(q.status ?? ""))) return { eligible: false, reason: "no_firm_quote" };
  if (q.converted_booking_id) return { eligible: false, reason: "booking_completed" };
  if (q.superseded_by) return { eligible: false, reason: "superseded" };
  const totalNum = typeof q.total === "number" ? q.total : Number(q.total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return { eligible: false, reason: "no_positive_total" };
  if (!q.customer_email && !q.customer_phone) return { eligible: false, reason: "no_contact_info" };
  const lastMs = new Date(q.last_activity_at).getTime();
  if (!Number.isFinite(lastMs)) return { eligible: false, reason: "invalid_activity_ts" };
  if (nowMs - lastMs < delayMinutes * 60_000) return { eligible: false, reason: "within_delay" };
  if (q.abandonment_emitted_version === persistedQuoteVersionTag(q)) {
    return { eligible: false, reason: "already_emitted" };
  }
  return { eligible: true, reason: "eligible" };
}

export interface AbandonmentDecision {
  eligible: boolean;
  reason: string;
}

// Pure eligibility gate. Every exclusion reason is explicit. A quote qualifies
// ONLY when a firm quote exists, the delay elapsed, nothing superseded it, and
// this exact version has not already been emitted.
export function evaluateAbandonment(
  convo: AbandonmentConvo,
  nowMs: number,
  delayMinutes: number,
): AbandonmentDecision {
  const status = convo.quote_result && typeof convo.quote_result === "object"
    ? String((convo.quote_result as Record<string, unknown>).status ?? "")
    : "";
  if (status !== "firm") return { eligible: false, reason: "no_firm_quote" };
  if (convo.resolved) return { eligible: false, reason: "resolved" };
  if (convo.staff_takeover_at) return { eligible: false, reason: "staff_takeover" };
  // On a chat conversation a completed booking is 'confirmed'; 'booked'/
  // 'converted' are accepted too for robustness against other lead sources.
  if (["confirmed", "booked", "converted"].includes(String(convo.booking_status ?? ""))) {
    return { eligible: false, reason: "booking_completed" };
  }
  if (convo.callback_requested) return { eligible: false, reason: "callback_active" };
  if (convo.manual_review_reason && String(convo.manual_review_reason).trim()) {
    return { eligible: false, reason: "manual_review_superseded" };
  }
  if (convo.campaign_status === "customer_replied") {
    return { eligible: false, reason: "customer_replied" };
  }
  const lastMs = new Date(convo.last_activity_at).getTime();
  if (!Number.isFinite(lastMs)) return { eligible: false, reason: "invalid_activity_ts" };
  if (nowMs - lastMs < delayMinutes * 60_000) return { eligible: false, reason: "within_delay" };
  if (convo.abandonment_emitted_version === abandonmentVersionTag(convo)) {
    return { eligible: false, reason: "already_emitted" };
  }
  return { eligible: true, reason: "eligible" };
}

// ---------------------------------------------------------------------------
// Impure runners — invoked from process-sms-queue after normal queue work.
// ---------------------------------------------------------------------------

export interface SweepResult {
  scanned: number;
  emitted: number;
  skipped: number;
  reasons: Record<string, number>;
}

export async function runAbandonmentSweep(
  supabase: SupabaseLike,
  opts: { batchSize?: number; nowMs?: number } = {},
): Promise<SweepResult> {
  const batchSize = opts.batchSize ?? ABANDONMENT_BATCH_SIZE;
  const nowMs = opts.nowMs ?? Date.now();
  const result: SweepResult = { scanned: 0, emitted: 0, skipped: 0, reasons: {} };

  // Effective delay from configured quote_abandoned campaigns (any status).
  const { data: camps } = await supabase
    .from("sms_campaigns")
    .select("abandonment_delay_minutes")
    .eq("event_name", "quote_abandoned");
  const delayMinutes = computeEffectiveAbandonmentDelay(
    (camps ?? []).map((c: { abandonment_delay_minutes: number | null }) => c.abandonment_delay_minutes),
  );

  const cutoffIso = new Date(nowMs - delayMinutes * 60_000).toISOString();

  // Bounded, oldest-first candidate scan using the partial index.
  const { data: candidates } = await supabase
    .from("chat_conversations")
    .select("id, quote_result, pricing_version, last_activity_at, resolved, booking_status, callback_requested, manual_review_reason, needs_attention, staff_takeover_at, abandonment_emitted_version, campaign_status, prospect_email, prospect_phone, services_discussed, service_area_status")
    .eq("resolved", false)
    .is("staff_takeover_at", null)
    .lt("last_activity_at", cutoffIso)
    .order("last_activity_at", { ascending: true })
    .limit(batchSize);

  for (const row of (candidates ?? []) as any[]) {
    result.scanned++;

    // Re-read the single row immediately before emit so a booking/reply/
    // takeover/consent change that landed after the batch fetch excludes it.
    const { data: fresh } = await supabase
      .from("chat_conversations")
      .select("id, quote_result, pricing_version, last_activity_at, resolved, booking_status, callback_requested, manual_review_reason, needs_attention, staff_takeover_at, abandonment_emitted_version, campaign_status, prospect_email, prospect_phone, services_discussed, service_area_status")
      .eq("id", row.id)
      .maybeSingle();
    if (!fresh) { result.skipped++; result.reasons["vanished"] = (result.reasons["vanished"] ?? 0) + 1; continue; }

    const decision = evaluateAbandonment(fresh as AbandonmentConvo, Date.now(), delayMinutes);
    if (!decision.eligible) {
      result.skipped++;
      result.reasons[decision.reason] = (result.reasons[decision.reason] ?? 0) + 1;
      continue;
    }

    const versionTag = abandonmentVersionTag(fresh as AbandonmentConvo);
    const emit = await emitCampaignEvent({
      eventName: "quote_abandoned",
      idempotencyKey: abandonmentIdempotencyKey(fresh as AbandonmentConvo),
      email: (fresh as any).prospect_email ?? null,
      phone: (fresh as any).prospect_phone ?? null,
      conversationId: fresh.id,
      source: "abandonment-sweep",
      subject: "Quote abandoned",
      metadata: {
        lead_source: "ai_chat",
        quote_status: "firm",
        pricing_version: (fresh as any).pricing_version ?? null,
        service_types: Array.isArray((fresh as any).services_discussed) ? (fresh as any).services_discussed : [],
        service_area_status: (fresh as any).service_area_status ?? null,
        total: (fresh as any).quote_result?.total ?? null,
        abandonment_window: 1,
      },
    });

    // Mark emitted only when the event was accepted or already existed, so a
    // transient failure is retried next tick (no silent loss).
    if (emit.ok || (emit.body as any)?.idempotent) {
      await supabase.from("chat_conversations")
        .update({ abandonment_emitted_version: versionTag, abandonment_swept_at: new Date().toISOString() })
        .eq("id", fresh.id);
      result.emitted++;
    } else {
      result.skipped++;
      result.reasons["emit_failed"] = (result.reasons["emit_failed"] ?? 0) + 1;
    }
  }

  return result;
}

export interface RecoveryResult {
  recovered: number;
  failed: number;
}

// Replays critical campaign_events that were recorded but never processed
// (e.g. the original emit's response was lost). Re-POSTing the SAME
// idempotency_key makes campaign-event process the existing pending row — it
// never creates a duplicate.
export async function recoverPendingCampaignEvents(
  supabase: SupabaseLike,
  opts: { batchSize?: number; supabaseUrl?: string; serviceKey?: string; graceMs?: number } = {},
): Promise<RecoveryResult> {
  const batchSize = opts.batchSize ?? RECOVERY_BATCH_SIZE;
  const url = opts.supabaseUrl ?? Deno.env.get("SUPABASE_URL") ?? "";
  const key = opts.serviceKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const graceMs = opts.graceMs ?? 60_000;
  const res: RecoveryResult = { recovered: 0, failed: 0 };

  const beforeIso = new Date(Date.now() - graceMs).toISOString();
  const { data: pending } = await supabase
    .from("campaign_events")
    .select("id, event_name, idempotency_key, email, phone, customer_id, conversation_id, source, subject, metadata")
    .is("processed_at", null)
    .in("event_name", CRITICAL_EVENTS as unknown as string[])
    .lt("created_at", beforeIso)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  for (const ev of (pending ?? []) as any[]) {
    const recoveryPayload = (ev.metadata && ev.metadata.__recovery_payload) || {};
    const body = {
      event_name: ev.event_name,
      idempotency_key: ev.idempotency_key,
      email: recoveryPayload.email ?? ev.email ?? null,
      phone: recoveryPayload.phone ?? ev.phone ?? null,
      customer_id: recoveryPayload.customer_id ?? ev.customer_id ?? null,
      conversation_id: recoveryPayload.conversation_id ?? ev.conversation_id ?? null,
      source: ev.source ?? "recovery",
      subject: ev.subject ?? null,
      metadata: recoveryPayload.metadata ?? ev.metadata ?? {},
    };
    try {
      const resp = await fetch(`${url}/functions/v1/campaign-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify(body),
      });
      if (resp.ok) res.recovered++; else res.failed++;
      try { await resp.text(); } catch { /* consume */ }
    } catch (e) {
      res.failed++;
      console.error(`recoverPendingCampaignEvents failed for ${ev.event_name} key=${ev.idempotency_key}:`, e instanceof Error ? e.message : e);
    }
  }
  return res;
}
