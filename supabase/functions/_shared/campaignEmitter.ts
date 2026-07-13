// ============================================================================
// campaignEmitter — the ONE server-side helper feature code uses to raise a
// campaign lifecycle event. It NEVER inserts enrollments or sends messages
// directly; it always calls the canonical campaign-event function, which owns
// audience matching, consent checks, suppression, idempotency and stop
// conditions. This keeps every emitter honest and prevents parallel systems.
//
// It is intentionally fire-and-forget safe: a failure to emit must never break
// the real booking / reply / consent flow that produced the event.
// ============================================================================

export interface EmitEventInput {
  eventName: string;
  idempotencyKey: string;          // deterministic, stable per real record
  email?: string | null;
  phone?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  source: string;                  // e.g. "jobber-create-booking", "callrail"
  subject?: string | null;
  metadata?: Record<string, unknown>;
  simulate?: boolean;              // admin preview only — never writes
  supabaseUrl?: string;
  serviceKey?: string;
}

export interface EmitResult {
  ok: boolean;
  status: number;
  body?: unknown;
}

export async function emitCampaignEvent(input: EmitEventInput): Promise<EmitResult> {
  const url = input.supabaseUrl ?? Deno.env.get("SUPABASE_URL") ?? "";
  const key = input.serviceKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) {
    console.error(`emitCampaignEvent(${input.eventName}): missing service env`);
    return { ok: false, status: 0 };
  }
  try {
    const resp = await fetch(`${url}/functions/v1/campaign-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify({
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
      }),
    });
    let body: unknown = null;
    try { body = await resp.json(); } catch { /* non-JSON */ }
    if (!resp.ok) {
      console.error(`emitCampaignEvent(${input.eventName}) -> ${resp.status}`, body);
    }
    return { ok: resp.ok, status: resp.status, body };
  } catch (e) {
    console.error(`emitCampaignEvent(${input.eventName}) failed:`, e);
    return { ok: false, status: 0 };
  }
}
