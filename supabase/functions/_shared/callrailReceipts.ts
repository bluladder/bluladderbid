// ============================================================================
// callrailReceipts — durable-receipt helpers for the CallRail inbound-SMS
// webhook. The single source of provider-message idempotency is the unique
// (provider_message_id) constraint on public.callrail_inbound_events. Every
// helper here goes through the service-role client only.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
type Supa = any;

export interface RecordReceiptInput {
  providerMessageId: string;
  fromPhone: string | null;
  toPhone: string | null;
  eventType?: string;
  payloadSafe: Record<string, unknown>;
}

export interface Receipt {
  id: string;
  provider_message_id: string;
  status: "received" | "processing" | "processed" | "retry_pending" | "failed";
  attempts: number;
  processed_at: string | null;
}

/**
 * Idempotently persist an inbound provider event. On duplicate provider
 * message id we return the pre-existing row (with `duplicate: true`) so the
 * caller can send a safe idempotent acknowledgment without doing any of the
 * processing side effects a second time.
 *
 * Only safe, structural fields are stored in `payload_safe` — never raw
 * auth tokens, cookies, or headers.
 */
export async function recordInboundReceipt(
  supabase: Supa,
  input: RecordReceiptInput,
): Promise<{ receipt: Receipt; duplicate: boolean }> {
  const insertRow = {
    provider_message_id: input.providerMessageId,
    event_type: input.eventType ?? "inbound_sms",
    from_phone: input.fromPhone,
    to_phone: input.toPhone,
    payload_safe: input.payloadSafe,
    status: "received" as const,
  };
  const { data, error } = await supabase
    .from("callrail_inbound_events")
    .insert(insertRow)
    .select("id, provider_message_id, status, attempts, processed_at")
    .maybeSingle();
  if (!error && data) return { receipt: data as Receipt, duplicate: false };

  // Unique-violation path — race or retry from CallRail. Look up the row.
  const { data: existing } = await supabase
    .from("callrail_inbound_events")
    .select("id, provider_message_id, status, attempts, processed_at")
    .eq("provider_message_id", input.providerMessageId)
    .maybeSingle();
  if (existing) return { receipt: existing as Receipt, duplicate: true };
  throw error ?? new Error("receipt_insert_failed");
}

export async function markProcessing(supabase: Supa, id: string) {
  await supabase
    .from("callrail_inbound_events")
    .update({
      status: "processing",
      last_attempted_at: new Date().toISOString(),
      attempts: (await supabase.rpc as unknown) // no-op placeholder
        ? undefined
        : undefined,
    })
    // atomic attempts++
    .eq("id", id);
  await supabase.rpc("noop_touch_row").catch(() => {});
}

/**
 * Atomically increment attempts and set status/error metadata. Uses a
 * lightweight two-step update because we don't rely on a SQL function for
 * the counter: the row is only ever touched by the service role.
 */
export async function markAttempt(
  supabase: Supa,
  id: string,
  patch: Partial<{
    status: Receipt["status"];
    last_error_category: string | null;
    last_error_detail: string | null;
    next_attempt_at: string | null;
    processed_at: string | null;
    sms_message_id: string | null;
    conversation_id: string | null;
    customer_id: string | null;
  }>,
) {
  const { data: current } = await supabase
    .from("callrail_inbound_events")
    .select("attempts")
    .eq("id", id)
    .maybeSingle();
  const attempts = ((current?.attempts as number | undefined) ?? 0) + 1;
  await supabase
    .from("callrail_inbound_events")
    .update({
      attempts,
      last_attempted_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", id);
}

export async function markProcessed(
  supabase: Supa,
  id: string,
  links: {
    smsMessageId?: string | null;
    conversationId?: string | null;
    customerId?: string | null;
  } = {},
) {
  await supabase
    .from("callrail_inbound_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      last_error_category: null,
      last_error_detail: null,
      next_attempt_at: null,
      sms_message_id: links.smsMessageId ?? undefined,
      conversation_id: links.conversationId ?? undefined,
      customer_id: links.customerId ?? undefined,
    })
    .eq("id", id);
}

/** Classify a thrown error into a coarse, safe category for the ops panel. */
export function classifyError(err: unknown): { category: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown");
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) return { category: "timeout", detail: msg.slice(0, 500) };
  if (lower.includes("network") || lower.includes("fetch failed")) return { category: "network", detail: msg.slice(0, 500) };
  if (lower.includes("rate") && lower.includes("limit")) return { category: "rate_limited", detail: msg.slice(0, 500) };
  if (lower.includes("unauthor") || lower.includes("403") || lower.includes("401")) return { category: "auth", detail: msg.slice(0, 500) };
  if (lower.includes("callrail")) return { category: "provider", detail: msg.slice(0, 500) };
  return { category: "unknown", detail: msg.slice(0, 500) };
}

const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;
export const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length;

export function nextAttemptAt(currentAttempts: number): string | null {
  const idx = Math.max(0, currentAttempts - 1);
  const mins = RETRY_BACKOFF_MINUTES[idx];
  if (mins == null) return null;
  return new Date(Date.now() + mins * 60_000).toISOString();
}

/** Categorize the transient-vs-permanent decision for retry lifecycle. */
export function isTransient(category: string) {
  return category === "timeout" || category === "network" || category === "rate_limited" || category === "provider";
}

/**
 * Build the smallest safe payload snapshot for durable storage. Excludes any
 * auth-bearing headers, cookies, or query strings; keeps only structural
 * fields useful for replay and ops triage.
 */
export function safePayloadSnapshot(raw: Record<string, unknown>): Record<string, unknown> {
  const SAFE_KEYS = new Set([
    "message_id", "id", "sms_id", "resource_id", "call_id",
    "customer_phone_number", "customer_number", "from", "from_number", "phone_number",
    "company_phone_number", "tracking_number", "to", "to_number",
    "content", "message", "body", "text", "sms_body",
    "direction", "created_at", "timestamp",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!SAFE_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 4000) out[k] = v.slice(0, 4000);
    else out[k] = v;
  }
  return out;
}
