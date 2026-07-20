// ============================================================================
// campaignEmitter — the ONE server-side helper feature code uses to raise a
// campaign lifecycle event. It NEVER inserts enrollments or sends messages
// directly; it always calls the canonical campaign-event function, which owns
// audience matching, consent checks, suppression, idempotency and stop
// conditions. This keeps every emitter honest and prevents parallel systems.
//
// Reliability contract:
//   * bounded per-attempt timeout (never hangs a booking/reply flow),
//   * a small number of retries for TRANSIENT failures (network / 429 / 5xx),
//   * fire-and-forget safe: it never throws into the real flow,
//   * critical lifecycle events are NOT lost silently — on final failure, when
//     a service-role client is supplied, a pending row is persisted directly in
//     the existing campaign_events table (unique idempotency_key => no dup) so
//     the process-sms-queue cron can replay it later.
// ============================================================================
// Minimal structural client type so any supabase-js version (the callers pin
// different patch versions) can be passed without generic-arity conflicts.
export type SupabaseLike = { from: (table: string) => any };

const CRITICAL_EVENTS = new Set([
  "booking_completed",
  "appointment_rescheduled",
  "appointment_cancelled",
  "customer_replied",
  "consent_revoked",
  "manual_staff_takeover",
  "quote_declined",
]);

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3; // 1 initial + 2 retries
const RETRY_DELAY_MS = 300;

export interface EmitEventInput {
  eventName: string;
  idempotencyKey: string;          // deterministic, stable per real record
  email?: string | null;
  phone?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  source: string;
  subject?: string | null;
  metadata?: Record<string, unknown>;
  simulate?: boolean;              // admin preview only — never writes
  supabaseUrl?: string;
  serviceKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  // When provided, a failed CRITICAL event is persisted as a pending row for
  // cron recovery. Pass the function's service-role client.
  recoverySupabase?: SupabaseLike;
}

export interface EmitResult {
  ok: boolean;
  status: number;
  body?: unknown;
  recovered?: boolean; // persisted for later cron recovery
}

function buildBody(input: EmitEventInput) {
  return {
    event_name: input.eventName,
    idempotency_key: input.idempotencyKey,
    email: input.email ?? null,
    phone: input.phone ?? null,
    customer_id: input.customerId ?? null,
    conversation_id: input.conversationId ?? null,
    source: input.source,
    subject: input.subject ?? null,
    metadata: input.metadata ?? {},
    simulate: input.simulate ?? false,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function emitCampaignEvent(input: EmitEventInput): Promise<EmitResult> {
  const url = input.supabaseUrl ?? Deno.env.get("SUPABASE_URL") ?? "";
  const key = input.serviceKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) {
    console.error(`emitCampaignEvent(${input.eventName}): missing service env`);
    return { ok: false, status: 0 };
  }

  const body = buildBody(input);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS;
  let lastStatus = 0;
  let lastBody: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`${url}/functions/v1/campaign-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      lastStatus = resp.status;
      try { lastBody = await resp.json(); } catch { lastBody = null; }
      if (resp.ok) return { ok: true, status: resp.status, body: lastBody };
      // 4xx (except 429) are permanent — do not retry.
      if (resp.status < 500 && resp.status !== 429) break;
    } catch (e) {
      clearTimeout(timer);
      lastStatus = 0;
      lastBody = null;
      // transient (network/abort) — fall through to retry
      if (attempt === maxAttempts) {
        console.error(`emitCampaignEvent(${input.eventName}) transient failure:`, e instanceof Error ? e.message : e);
      }
    }
    if (attempt < maxAttempts) await sleep(RETRY_DELAY_MS * attempt);
  }

  // All attempts failed. Log with event name + source + key ONLY (no PII).
  console.error(`emitCampaignEvent FAILED event=${input.eventName} source=${input.source} key=${input.idempotencyKey} status=${lastStatus}`);

  // Persist critical events for cron recovery (idempotency_key unique => the
  // row is only created once; a race with a completed original is a no-op).
  if (!input.simulate && CRITICAL_EVENTS.has(input.eventName) && input.recoverySupabase) {
    try {
      const { error } = await input.recoverySupabase.from("campaign_events").insert({
        event_name: input.eventName,
        idempotency_key: input.idempotencyKey,
        email: input.email ?? null,
        phone: input.phone ?? null,
        customer_id: input.customerId ?? null,
        conversation_id: input.conversationId ?? null,
        source: input.source,
        subject: input.subject ?? null,
        processed_at: null,
        metadata: { ...(input.metadata ?? {}), __recovery_payload: body },
      });
      if (!error) return { ok: false, status: lastStatus, body: lastBody, recovered: true };
      // Unique violation => an event with this key already exists; not lost.
      return { ok: false, status: lastStatus, body: lastBody, recovered: true };
    } catch (e) {
      console.error(`emitCampaignEvent recovery-persist failed key=${input.idempotencyKey}:`, e instanceof Error ? e.message : e);
    }
  }

  return { ok: false, status: lastStatus, body: lastBody };
}
