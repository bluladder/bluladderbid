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
import { hasLifecycleBlockingBooking } from "./lifecycleBookingCheck.ts";

// Dedicated inactivity threshold for firm-quote abandonment. This is the
// SINGLE SOURCE OF TRUTH for "how long a firm quote must sit idle before it
// counts as abandoned." It is deliberately NOT derived from campaign step
// delays so that editing campaign copy/timing in the admin cannot silently
// redefine what qualifies as an abandoned quote. Configurable via env.
export const ABANDONMENT_INACTIVITY_MINUTES = (() => {
  const raw = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } })
    .Deno?.env?.get?.("ABANDONMENT_INACTIVITY_MINUTES");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
})();
// Legacy export retained so campaign-event and admin previews that reference
// the old constant continue to compile. Both point at the same threshold.
export const DEFAULT_ABANDONMENT_DELAY_MINUTES = ABANDONMENT_INACTIVITY_MINUTES;

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

// Bounded work for the follow-up completion sweep. Small enough to never
// delay normal queue processing; unfinished enrollments continue on the
// next cron tick.
export const FOLLOW_UP_COMPLETION_BATCH_SIZE = 25;

// Idempotency key for the once-per-enrollment lifecycle transition. Keyed on
// the enrollment id + campaign version so a re-run of the sweep cannot
// double-emit and a bumped campaign version can produce a fresh (rare) event.
export function followUpCompletionIdempotencyKey(
  enrollmentId: string,
  campaignVersion: number | null | undefined,
): string {
  const v = Number.isFinite(Number(campaignVersion)) ? Number(campaignVersion) : 0;
  return `quote_follow_up_completed:${enrollmentId}:v${v}`;
}

export interface FollowUpEnrollmentRow {
  id: string;
  customer_id: string | null;
  campaign_id: string;
  campaign_version: number | null;
  event_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  conversation_id: string | null;
  campaign_event_id: string | null;
  suppressed?: boolean | null;
}

export interface FollowUpEligibilityInput {
  totalMessages: number;
  pendingMessages: number;
  processingMessages: number;
  latestSendAtMs: number | null;
  nowMs: number;
  hasBooking: boolean;
  optedOut: boolean;
  staffTakeover: boolean;
  suppressed: boolean;
  marketingConsentGranted: boolean;
  newerEnrollmentExists: boolean;
  enrollmentStatus: string;
}

// Pure eligibility gate for follow-up completion. Every exclusion reason is
// explicit. Exported for unit tests so the safeguard matrix is provable.
export function evaluateFollowUpCompletion(
  i: FollowUpEligibilityInput,
): AbandonmentDecision {
  if (i.enrollmentStatus !== "active") return { eligible: false, reason: "enrollment_not_active" };
  if (i.totalMessages === 0) return { eligible: false, reason: "no_scheduled_messages" };
  if (i.pendingMessages > 0 || i.processingMessages > 0) return { eligible: false, reason: "messages_still_scheduled" };
  if (i.latestSendAtMs === null) return { eligible: false, reason: "no_final_send_at" };
  if (i.nowMs < i.latestSendAtMs) return { eligible: false, reason: "before_final_send_at" };
  if (i.hasBooking) return { eligible: false, reason: "booking_completed" };
  if (i.optedOut) return { eligible: false, reason: "opted_out" };
  if (i.staffTakeover) return { eligible: false, reason: "staff_takeover" };
  if (i.suppressed) return { eligible: false, reason: "suppressed" };
  if (!i.marketingConsentGranted) return { eligible: false, reason: "no_marketing_consent" };
  if (i.newerEnrollmentExists) return { eligible: false, reason: "superseded_by_newer_enrollment" };
  return { eligible: true, reason: "eligible" };
}

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

// ---------------------------------------------------------------------------
// runPersistedQuoteAbandonmentSweep — scans public.quotes for firm, unbooked,
// non-superseded persisted quotes whose inactivity delay has elapsed, and
// emits `quote_abandoned` via emitCampaignEvent for each eligible row. Runs
// inside process-sms-queue AFTER the chat sweep and AFTER normal queue work,
// bounded by RECOVERY_BATCH_SIZE so it never delays deliveries.
// ---------------------------------------------------------------------------
export async function runPersistedQuoteAbandonmentSweep(
  supabase: SupabaseLike,
  opts: { batchSize?: number; nowMs?: number } = {},
): Promise<SweepResult> {
  const batchSize = opts.batchSize ?? ABANDONMENT_BATCH_SIZE;
  const nowMs = opts.nowMs ?? Date.now();
  const result: SweepResult = { scanned: 0, emitted: 0, skipped: 0, reasons: {} };

  // Fixed inactivity threshold — NOT min(campaign step delays). Admin edits to
  // campaign copy or step timing cannot change what qualifies as abandoned.
  const delayMinutes = ABANDONMENT_INACTIVITY_MINUTES;
  const cutoffIso = new Date(nowMs - delayMinutes * 60_000).toISOString();

  const { data: candidates } = await supabase
    .from("quotes")
    .select("id, status, total, customer_email, customer_phone, customer_id, pricing_rule_version, last_activity_at, converted_booking_id, superseded_by, abandonment_emitted_version, services_json, source_session_id, utm_params_json, attribution")
    .is("converted_booking_id", null)
    .is("superseded_by", null)
    .in("status", ["saved", "emailed", "viewed", "pending"])
    .lt("last_activity_at", cutoffIso)
    .order("last_activity_at", { ascending: true })
    .limit(batchSize);

  for (const row of (candidates ?? []) as PersistedQuoteRow[]) {
    result.scanned++;

    // Re-read immediately before emit so a booking/supersede/reply/consent
    // change since the batch fetch excludes it.
    const { data: fresh } = await supabase
      .from("quotes")
      .select("id, status, total, customer_email, customer_phone, customer_id, pricing_rule_version, last_activity_at, converted_booking_id, superseded_by, abandonment_emitted_version, services_json, source_session_id, utm_params_json, attribution")
      .eq("id", row.id)
      .maybeSingle();
    if (!fresh) { result.skipped++; result.reasons["vanished"] = (result.reasons["vanished"] ?? 0) + 1; continue; }

    const q = fresh as PersistedQuoteRow;
    const decision = evaluatePersistedQuoteAbandonment(q, Date.now(), delayMinutes);
    if (!decision.eligible) {
      result.skipped++;
      result.reasons[decision.reason] = (result.reasons[decision.reason] ?? 0) + 1;
      continue;
    }

    const totalNum = typeof q.total === "number" ? q.total : Number(q.total);
    const svc = q.services_json && typeof q.services_json === "object" ? q.services_json as Record<string, unknown> : {};
    const svcArr = Array.isArray((svc as any).services)
      ? ((svc as any).services as Array<{ name?: string }>).map((s) => s?.name).filter((n): n is string => !!n)
      : [];

    const versionTag = persistedQuoteVersionTag(q);
    const emit = await emitCampaignEvent({
      eventName: "quote_abandoned",
      idempotencyKey: persistedQuoteIdempotencyKey(q),
      email: q.customer_email ?? null,
      phone: q.customer_phone ?? null,
      customerId: q.customer_id ?? null,
      source: "persisted-quote-abandonment-sweep",
      subject: "Persisted quote abandoned",
      metadata: {
        lead_source: "website_quote",
        quote_status: "firm",
        quote_id: q.id,
        pricing_rule_version: q.pricing_rule_version ?? null,
        service_types: svcArr,
        total: Number.isFinite(totalNum) ? totalNum : null,
        abandonment_window: 1,
      },
    });

    if (emit.ok || (emit.body as any)?.idempotent) {
      await supabase.from("quotes")
        .update({ abandonment_emitted_version: versionTag, abandonment_swept_at: new Date().toISOString() })
        .eq("id", q.id);
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

// ---------------------------------------------------------------------------
// runFollowUpCompletionSweep — end-of-sequence lifecycle transition.
//
// Finds enrollments on campaigns marked `is_terminal_phase = true` whose
// scheduled messages have all been resolved (sent/cancelled/failed) and whose
// last scheduled send time has already passed. For each, rechecks the
// authoritative safeguards (booking, opt-out, staff takeover, marketing
// consent, suppression, no newer follow-up enrollment supersedes this one),
// marks the enrollment `completed`, and emits `quote_follow_up_completed`
// through the canonical campaignEmitter → campaign-event boundary.
//
// Emit is idempotent (see followUpCompletionIdempotencyKey) so a re-run of
// the sweep cannot double-enroll into the post-12-month long-term nurture.
// Runs inside process-sms-queue AFTER normal delivery so it never delays
// sends, and its bounded batch keeps a single tick fast.
// ---------------------------------------------------------------------------
export async function runFollowUpCompletionSweep(
  supabase: SupabaseLike,
  opts: { batchSize?: number; nowMs?: number } = {},
): Promise<SweepResult> {
  const batchSize = opts.batchSize ?? FOLLOW_UP_COMPLETION_BATCH_SIZE;
  const nowMs = opts.nowMs ?? Date.now();
  const result: SweepResult = { scanned: 0, emitted: 0, skipped: 0, reasons: {} };

  // Which campaigns are terminal phases? Cached in-memory per invocation.
  const { data: terminalCamps } = await (supabase as any)
    .from("sms_campaigns")
    .select("id")
    .eq("is_terminal_phase", true);
  const terminalIds: string[] = ((terminalCamps ?? []) as { id: string }[]).map((c) => c.id);
  if (!terminalIds.length) return result;

  // Oldest-first active enrollments on those campaigns.
  const { data: enrollments } = await (supabase as any)
    .from("campaign_enrollments")
    .select("id, customer_id, campaign_id, campaign_version, event_name, email, phone, status, conversation_id, campaign_event_id, suppressed, created_at")
    .eq("status", "active")
    .in("campaign_id", terminalIds)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  for (const enr of ((enrollments ?? []) as (FollowUpEnrollmentRow & { created_at: string })[])) {
    result.scanned++;

    // Message-state check. We only advance if every queued message for this
    // enrollment has already been resolved (sent/cancelled/failed) AND the
    // last scheduled send-time has passed. This guarantees no in-flight
    // marketing send can race with completion.
    const { data: msgs } = await (supabase as any)
      .from("sms_messages")
      .select("status, send_at")
      .eq("enrollment_id", enr.id);
    const rows = (msgs ?? []) as { status: string; send_at: string | null }[];
    let pending = 0, processing = 0, latest: number | null = null;
    for (const m of rows) {
      if (m.status === "pending") pending++;
      if (m.status === "processing") processing++;
      if (m.send_at) {
        const t = new Date(m.send_at).getTime();
        if (Number.isFinite(t)) latest = latest === null ? t : Math.max(latest, t);
      }
    }

    // Safeguards — recheck against authoritative sources immediately before
    // recording the transition. A lead that booked, opted out, replied into
    // staff follow-up, revoked marketing consent, became suppressed, or has
    // a newer follow-up enrollment must NEVER transition.
    // Read the source event metadata first so the booking check can be scoped
    // to the source-quote lifecycle (not customer-lifetime). A repeat customer
    // with a completed historical job before the source quote must remain
    // eligible; only bookings tied to THIS quote / lifecycle should block.
    let originalMeta: Record<string, unknown> = {};
    if (enr.campaign_event_id) {
      const { data: ev } = await (supabase as any)
        .from("campaign_events").select("metadata").eq("id", enr.campaign_event_id).maybeSingle();
      originalMeta = (ev?.metadata as Record<string, unknown>) ?? {};
    }
    const sourceQuoteId = (originalMeta.quote_id as string | null | undefined) ?? null;
    const lifecycleAnchorIso = (enr as { created_at: string }).created_at ?? null;
    const hasBooking = await hasLifecycleBlockingBooking(supabase, {
      customerId: enr.customer_id,
      quoteId: sourceQuoteId,
      anchorIso: lifecycleAnchorIso,
    });
    let optedOut = false;
    if (enr.phone) {
      const { data: opt } = await (supabase as any)
        .from("sms_optouts").select("phone").eq("phone", enr.phone).maybeSingle();
      optedOut = !!opt;
    }
    let staffTakeover = false;
    if (enr.conversation_id) {
      const { data: convo } = await (supabase as any)
        .from("chat_conversations").select("staff_takeover_at, campaign_status")
        .eq("id", enr.conversation_id).maybeSingle();
      staffTakeover = !!(convo && (convo.staff_takeover_at || convo.campaign_status === "customer_replied"));
    }
    const suppression = await checkSuppressionSafe(supabase, { email: enr.email, phone: enr.phone });
    // Marketing consent on either channel qualifies the identity for the
    // long-term nurture destination. The destination campaign's own consent
    // gate re-checks at enrollment time, but blocking here avoids emitting a
    // pointless "eligible" event we know will fail consent later.
    const marketingGranted = await hasMarketingConsent(supabase, enr.email, enr.phone);
    // Newer follow-up? A more recent enrollment for the same customer on any
    // quote_abandoned campaign means this journey has been superseded.
    let newerEnrollmentExists = false;
    if (enr.customer_id) {
      const { data: newer } = await (supabase as any)
        .from("campaign_enrollments")
        .select("id, created_at")
        .eq("customer_id", enr.customer_id)
        .eq("event_name", "quote_abandoned")
        .neq("id", enr.id)
        .gt("created_at", (enr as { created_at: string }).created_at)
        .limit(1);
      newerEnrollmentExists = !!(newer && newer.length);
    }

    const decision = evaluateFollowUpCompletion({
      totalMessages: rows.length,
      pendingMessages: pending,
      processingMessages: processing,
      latestSendAtMs: latest,
      nowMs,
      hasBooking,
      optedOut,
      staffTakeover,
      suppressed: suppression,
      marketingConsentGranted: marketingGranted,
      newerEnrollmentExists,
      enrollmentStatus: enr.status,
    });
    if (!decision.eligible) {
      result.skipped++;
      result.reasons[decision.reason] = (result.reasons[decision.reason] ?? 0) + 1;
      // For terminal states that can never resolve to eligible without an
      // enrollment reset (booking, opt-out, takeover, no consent, superseded)
      // we still stop the enrollment so it doesn't linger as "active".
      if (["booking_completed", "opted_out", "staff_takeover", "no_marketing_consent", "superseded_by_newer_enrollment", "suppressed"].includes(decision.reason)) {
        await (supabase as any).from("campaign_enrollments").update({
          status: "stopped",
          stopped_reason: decision.reason,
          stopped_at: new Date().toISOString(),
        }).eq("id", enr.id);
      }
      continue;
    }

    // originalMeta was already read above so the booking safeguard could scope
    // itself to the source-quote lifecycle. Reuse it verbatim here to preserve
    // first-touch context on the emitted completion event.
    const idempotencyKey = followUpCompletionIdempotencyKey(enr.id, enr.campaign_version);
    const emit = await emitCampaignEvent({
      eventName: "quote_follow_up_completed",
      idempotencyKey,
      email: enr.email,
      phone: enr.phone,
      customerId: enr.customer_id,
      conversationId: enr.conversation_id,
      source: "follow-up-completion-sweep",
      subject: "Unbooked quote follow-up sequence completed",
      metadata: {
        quote_id: originalMeta.quote_id ?? null,
        original_event_id: enr.campaign_event_id,
        source_campaign_id: enr.campaign_id,
        source_campaign_version: enr.campaign_version,
        source_event_name: enr.event_name,
        source_enrollment_id: enr.id,
        final_send_at: latest ? new Date(latest).toISOString() : null,
        completed_at: new Date(nowMs).toISOString(),
        attribution: originalMeta.attribution ?? null,
        utm_params_json: originalMeta.utm_params_json ?? null,
        service_types: Array.isArray(originalMeta.service_types) ? originalMeta.service_types : [],
        pricing_rule_version: originalMeta.pricing_rule_version ?? null,
      },
      recoverySupabase: supabase,
    });

    if (emit.ok || (emit.body as { idempotent?: boolean })?.idempotent) {
      await (supabase as any).from("campaign_enrollments").update({
        status: "completed",
        stopped_reason: "completed_12_month_sequence",
        stopped_at: new Date(nowMs).toISOString(),
      }).eq("id", enr.id).eq("status", "active");
      result.emitted++;
    } else {
      result.skipped++;
      result.reasons["emit_failed"] = (result.reasons["emit_failed"] ?? 0) + 1;
    }
  }

  return result;
}

// deno-lint-ignore no-explicit-any
async function checkSuppressionSafe(supabase: any, target: { email: string | null; phone: string | null }): Promise<boolean> {
  try {
    const mod = await import("./suppression.ts");
    const r = await mod.checkSuppression(supabase, target);
    return !!r.suppressed;
  } catch {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function hasMarketingConsent(supabase: any, email: string | null, phone: string | null): Promise<boolean> {
  const or: string[] = [];
  if (email) or.push(`email.eq.${email}`);
  if (phone) or.push(`phone.eq.${phone}`);
  if (!or.length) return false;
  const { data } = await supabase
    .from("communication_consent")
    .select("consent_type")
    .eq("status", "granted")
    .eq("consent_type", "marketing")
    .or(or.join(","))
    .limit(1);
  return !!(data && data.length);
}
