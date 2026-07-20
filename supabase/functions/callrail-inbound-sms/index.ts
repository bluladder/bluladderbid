import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { normalizePhone } from "../_shared/sms.ts";
import { sharedRateLimit } from "../_shared/rateLimit.ts";
import { recordInboundReceipt, safePayloadSnapshot } from "../_shared/callrailReceipts.ts";
import { processPersistedCallRailEvent } from "../_shared/callrailEventProcessor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CallRail inbound-text webhook. Detects STOP/START replies and updates opt-out state.
// Configured in CallRail under Integrations -> Webhooks for the "Text message" event.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verify the request actually came from CallRail. We require a shared secret
  // token (configured in the CallRail webhook URL as `?token=...` or sent as
  // the `x-webhook-token` header). Without this, anyone could forge STOP/START
  // payloads to silently opt any phone number out of notifications.
  //
  // In production we FAIL CLOSED if the secret is not configured. Preview/dev
  // environments (no DENO_DEPLOYMENT_ID and APP_ENV != "production") may run
  // without a secret so local tests do not require a live CallRail account.
  const expectedToken = Deno.env.get("CALLRAIL_WEBHOOK_SECRET");
  const isProduction =
    !!Deno.env.get("DENO_DEPLOYMENT_ID") || Deno.env.get("APP_ENV") === "production";
  if (!expectedToken) {
    if (isProduction) {
      console.error("callrail-inbound-sms: CALLRAIL_WEBHOOK_SECRET missing in production — refusing request");
      return new Response(JSON.stringify({ error: "Webhook not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    const url = new URL(req.url);
    const providedToken =
      req.headers.get("x-webhook-token") ||
      url.searchParams.get("token") ||
      "";
    if (providedToken !== expectedToken) {
      console.warn("callrail-inbound-sms: rejected request with missing/invalid token");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Cap volume even for a valid-token caller — a leaked secret shouldn't allow
  // a flood that fans out into AI orchestrator calls.
  const shared = await sharedRateLimit(req, {
    key: "callrail-inbound-sms",
    limit: 300,
    windowMs: 60_000,
  });
  if (!shared.allowed) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // CallRail may send JSON or form-encoded; parse both.
    let payload: Record<string, unknown> = {};
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      payload = await req.json().catch(() => ({}));
    } else {
      const form = await req.formData().catch(() => null);
      if (form) {
        for (const [k, v] of form.entries()) payload[k] = typeof v === "string" ? v : String(v);
      } else {
        // last resort: try JSON anyway
        payload = await req.json().catch(() => ({}));
      }
    }

    const pick = (...keys: string[]): string | null => {
      for (const k of keys) {
        const val = payload[k];
        if (typeof val === "string" && val.trim()) return val.trim();
      }
      return null;
    };

    // Snapshot only structural fields for durable receipt — never headers or
    // auth tokens. This is what admin ops replay reads from.
    const payloadSafe = safePayloadSnapshot(payload);

    // The customer's number is the "from" on an inbound message.
    const rawPhone = pick(
      "customer_phone_number", "customer_number", "from", "from_number", "phone_number",
    );
    const content = pick("content", "message", "body", "text", "sms_body") || "";
    const direction = (pick("direction") || "inbound").toLowerCase();
    const toRawPhone = pick("company_phone_number", "tracking_number", "to", "to_number");

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      console.log("inbound-sms: no usable phone in payload", JSON.stringify(payload).slice(0, 500));
      return new Response(JSON.stringify({ ok: true, ignored: "no_phone" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only act on inbound (customer -> us) messages.
    if (direction && direction !== "inbound" && direction !== "incoming") {
      return new Response(JSON.stringify({ ok: true, ignored: "outbound" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nowIso = new Date().toISOString();

    // Provider-message id — the durable idempotency key. Fallback synthesises
    // one from phone + minute-bucket + content prefix so retries collapse.
    const providerMessageId =
      pick("message_id", "id", "sms_id", "resource_id", "call_id") ||
      `${phone}:${nowIso.slice(0, 16)}:${(content || "").slice(0, 40)}`;

    // ---------------------------------------------------------------------
    // Durable receipt: persist the provider event BEFORE any side effects.
    // The unique constraint on provider_message_id is the single source of
    // truth for idempotency — a duplicate delivery short-circuits with a
    // safe idempotent ack and NEVER re-runs downstream logic (AI reply,
    // campaign event, opt-out toggle, booking auto-reply).
    // ---------------------------------------------------------------------
    let receiptId: string;
    try {
      const { receipt, duplicate } = await recordInboundReceipt(supabase, {
        providerMessageId,
        fromPhone: phone,
        toPhone: normalizePhone(toRawPhone) ?? toRawPhone ?? null,
        payloadSafe: { ...payloadSafe, direction, normalized_phone: phone },
      });
      receiptId = receipt.id;
      if (duplicate) {
        console.log(`inbound-sms: duplicate provider_message_id ${providerMessageId} — idempotent ack`);
        return new Response(
          JSON.stringify({ ok: true, action: "duplicate", status: receipt.status }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch (e) {
      // If the receipt insert itself fails we cannot safely ack the event —
      // return 500 so CallRail retries and the event eventually persists.
      console.error("callrail-inbound-sms: receipt persist failed", e);
      return new Response(JSON.stringify({ error: "receipt_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delegate to the canonical persisted-event processor. This is the same
    // pipeline used by the automatic retry sweep and admin replay, so no
    // path can diverge from another.
    const result = await processPersistedCallRailEvent(supabase, receiptId);
    return new Response(
      JSON.stringify({ ok: result.ok, action: result.action, ...(result.category ? { category: result.category } : {}) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("callrail-inbound-sms error:", error);
    // Always 200 so the webhook provider does not retry-storm.
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
