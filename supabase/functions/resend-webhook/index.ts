// ============================================================================
// resend-webhook — ingests Resend delivery events (bounce, complaint,
// unsubscribe) and writes to public.email_suppressions.
//
// Auth: Svix-style HMAC. Resend signs the raw body with RESEND_WEBHOOK_SECRET
// (base64) as `svix-signature: v1,<base64(HMAC_SHA256(<svix-id>.<svix-timestamp>.<body>))>`.
// We verify signature and reject replays outside a 5-minute window.
//
// verify_jwt is not required — this endpoint is called by Resend, not users.
// ============================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { recordSuppression, type SuppressionReason } from "../_shared/emailSuppression.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_SKEW_MS = 5 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySignature(
  secret: string,
  msgId: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): Promise<boolean> {
  const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array;
  try { keyBytes = b64ToBytes(secretB64); } catch { return false; }
  const key = await crypto.subtle.importKey(
    "raw", keyBytes,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const toSign = `${msgId}.${timestamp}.${body}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign)),
  );
  const expected = bytesToB64(sig);
  // header format: "v1,<b64> v1,<b64>" (space-separated multi-sig support)
  for (const part of signatureHeader.split(/\s+/)) {
    const [, val] = part.split(",", 2);
    if (val && timingSafeEqual(val, expected)) return true;
  }
  return false;
}

function mapEventType(type: string): SuppressionReason | null {
  const t = type.toLowerCase();
  if (t === "email.bounced" || t === "email.hard_bounced") return "bounced";
  if (t === "email.complained") return "complained";
  if (t === "email.unsubscribed") return "unsubscribed";
  return null;
}

// Which attempt-status a Resend event maps to when we can correlate by
// provider_message_id. `null` means: ignore (informational-only event like
// email.opened / email.clicked).
export type AttemptStatus =
  | "sent" | "delivered" | "delayed" | "bounced" | "complained" | "failed" | "suppressed";
export function mapEventToAttemptStatus(type: string):
  | { status: AttemptStatus; column: string }
  | null
{
  const t = type.toLowerCase();
  if (t === "email.sent")             return { status: "sent",       column: "sent_at"       };
  if (t === "email.delivered")        return { status: "delivered",  column: "delivered_at"  };
  if (t === "email.delivery_delayed") return { status: "delayed",    column: "delayed_at"    };
  if (t === "email.bounced" || t === "email.hard_bounced")
                                      return { status: "bounced",    column: "bounced_at"    };
  if (t === "email.complained")       return { status: "complained", column: "complained_at" };
  if (t === "email.failed")           return { status: "failed",     column: "suppressed_at" };
  return null;
}

// Terminal states must never be regressed by later out-of-order events.
const TERMINAL: ReadonlySet<AttemptStatus> = new Set(["delivered", "bounced", "complained", "failed", "suppressed"]);
// Ranking of forward progression when the current row is non-terminal.
const RANK: Record<AttemptStatus, number> = {
  sent: 1, delayed: 2, delivered: 5, bounced: 5, complained: 5, failed: 5, suppressed: 5,
};
export function shouldApplyTransition(
  currentStatus: string | null | undefined,
  next: AttemptStatus,
): boolean {
  const cur = (currentStatus ?? "accepted") as AttemptStatus | "accepted";
  if (cur !== "accepted" && TERMINAL.has(cur as AttemptStatus)) return false;
  if (cur === "accepted") return true;
  return (RANK[next] ?? 0) >= (RANK[cur as AttemptStatus] ?? 0);
}

// deno-lint-ignore no-explicit-any
function serviceClient(): any {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return json({ error: "webhook_secret_not_configured" }, 500);

  const svixId = req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "";
  const svixTs = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp") ?? "";
  const svixSig = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature") ?? "";
  if (!svixId || !svixTs || !svixSig) return json({ error: "missing_signature_headers" }, 401);

  const tsMs = Number(svixTs) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    return json({ error: "timestamp_out_of_range" }, 401);
  }

  const raw = await req.text();
  const valid = await verifySignature(secret, svixId, svixTs, raw, svixSig);
  if (!valid) return json({ error: "invalid_signature" }, 401);

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  const type = String(payload?.type ?? "");
  const data = payload?.data ?? {};
  const providerMessageId: string | null =
    typeof data?.email_id === "string" ? data.email_id
    : typeof data?.id === "string" ? data.id
    : null;
  const recipients: string[] = Array.isArray(data?.to)
    ? data.to.map((x: unknown) => String(x))
    : data?.email ? [String(data.email)] : [];

  const supabase = serviceClient();

  // Dedupe: refuse to reprocess a svix-id we've already logged. The unique
  // constraint on svix_id makes this race-safe — a duplicate insert throws.
  if (supabase) {
    const { error: dupErr } = await supabase
      .from("resend_webhook_events")
      .insert({
        svix_id: svixId,
        event_type: type,
        provider_message_id: providerMessageId,
        payload,
      });
    if (dupErr) {
      // duplicate key → already processed; ack 200 so Resend stops retrying.
      if (String(dupErr.message).toLowerCase().includes("duplicate")) {
        return json({ ok: true, duplicate: true });
      }
      // Non-duplicate insert error is unexpected but non-fatal for suppression;
      // continue so terminal bounce/complaint state still records.
    }
  }

  // (a) Update the correlated email_send_attempts row (if we can find it).
  const attemptTransition = mapEventToAttemptStatus(type);
  let attemptUpdated = false;
  let attemptSkipped = false;
  if (attemptTransition && providerMessageId && supabase) {
    const { data: rows } = await supabase
      .from("email_send_attempts")
      .select("id,status")
      .eq("provider_message_id", providerMessageId);
    const matched = Array.isArray(rows) ? rows : [];
    for (const row of matched) {
      if (!shouldApplyTransition(row?.status, attemptTransition.status)) {
        attemptSkipped = true;
        continue;
      }
      const patch: Record<string, unknown> = {
        status: attemptTransition.status,
        last_event_at: new Date().toISOString(),
        last_event_type: type,
      };
      patch[attemptTransition.column] = new Date().toISOString();
      if (attemptTransition.status !== "delivered" && attemptTransition.status !== "sent") {
        patch.failure_reason = String(data?.reason ?? data?.bounce?.message ?? type);
      }
      const { error } = await supabase
        .from("email_send_attempts")
        .update(patch)
        .eq("id", row.id);
      if (!error) attemptUpdated = true;
    }
  }

  // (b) For bounce/complaint/unsubscribe, keep the pre-send suppression gate
  // authoritative so future sends short-circuit before touching Resend.
  const reason = mapEventType(type);
  const results: Array<{ email: string; ok: boolean; error?: string }> = [];
  if (reason) {
    for (const to of recipients) {
      const r = await recordSuppression({
        email: to,
        reason,
        source: "resend-webhook",
        providerEventId: svixId,
        notes: type,
      });
      results.push({ email: to, ...r });
    }
  }

  return json({ ok: true, type, reason, attemptUpdated, attemptSkipped, correlated: !!providerMessageId, results });
});