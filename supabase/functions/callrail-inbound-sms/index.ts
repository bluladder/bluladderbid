import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { normalizePhone, classifyInbound, getCallRailConfig, sendCallRailSms } from "../_shared/sms.ts";
import { classifyInboundIntent, renderBookingAutoReply } from "../_shared/bookingIntent.ts";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { routeInboundSmsToOrchestrator, SMS_REPLY_MAX_CHARS } from "../_shared/smsOrchestrator.ts";
import { sharedRateLimit } from "../_shared/rateLimit.ts";

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
  // token (configured in the CallRail webhook URL as `?token=...` or sent as the
  // `x-webhook-token` header). Without this, anyone could forge STOP/START
  // payloads to silently opt any phone number out of notifications.
  const expectedToken = Deno.env.get("CALLRAIL_WEBHOOK_SECRET");
  if (expectedToken) {
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

    // The customer's number is the "from" on an inbound message.
    const rawPhone = pick(
      "customer_phone_number", "customer_number", "from", "from_number", "phone_number",
    );
    const content = pick("content", "message", "body", "text", "sms_body") || "";
    const direction = (pick("direction") || "inbound").toLowerCase();

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

    // Log the inbound reply for visibility in the message log.
    await supabase.from("sms_messages").insert({
      to_number: phone,
      body: content || "(empty)",
      message_kind: "inbound",
      status: "inbound",
      sent_at: new Date().toISOString(),
    });

    const intent = classifyInbound(content);
    const nowIso = new Date().toISOString();

    // Higher-fidelity intent classifier used for BOOK-IT / escalation routing.
    const richIntent = classifyInboundIntent(content);

    // Compliance precedence (authoritative): STOP/HELP > escalation > booking >
    // START > other. The legacy `classifyInbound()` treats a bare "yes" (or any
    // reply starting with "yes") as START, which mis-classifies natural booking
    // replies like "yes, let's do it" as an opt-in. We use richIntent as the
    // authoritative decision for STOP/START handling; the legacy intent is
    // preserved only as metadata on the customer_replied event.
    const complianceIntent: "stop" | "start" | null =
      richIntent.kind === "stop" ? "stop"
      : richIntent.kind === "start" ? "start"
      : null;

    // customer_replied — one event per inbound message. The idempotency key is
    // the CallRail/provider message id (fallback: phone+content hash) so replayed
    // webhooks never create duplicate events. The campaign engine applies the
    // configured reply behaviour (pause/stop nurture) and leaves transactional
    // workflows untouched. STOP/START opt-out handling below remains authoritative.
    const providerMessageId =
      pick("message_id", "id", "sms_id", "resource_id", "call_id") ||
      `${phone}:${nowIso.slice(0, 16)}:${(content || "").slice(0, 40)}`;
    try {
      await emitCampaignEvent({
        eventName: "customer_replied",
        idempotencyKey: `customer_replied:${providerMessageId}`,
        phone,
        source: "callrail",
        subject: "Inbound SMS reply",
        recoverySupabase: supabase,
        metadata: { intent, provider_message_id: providerMessageId },
      });
    } catch (e) {
      console.error("customer_replied emit failed:", e);
    }

    // ===== Escalation routing (compliance/booking take precedence below) =====
    // Complaints, damage/safety, billing disputes, and explicit human requests
    // route to manual staff takeover instead of the AI-assisted path. This
    // event is already allowlisted as a STOP scope=all, so it halts campaign
    // and AI automation and preserves the transcript for a human.
    if (
      complianceIntent === null &&
      richIntent.kind === "escalation"
    ) {
      try {
        await emitCampaignEvent({
          eventName: "manual_staff_takeover",
          idempotencyKey: `manual_staff_takeover:${providerMessageId}`,
          phone,
          source: "callrail",
          subject: `Inbound reply escalation: ${richIntent.category}`,
          recoverySupabase: supabase,
          metadata: {
            reason: richIntent.category,
            provider_message_id: providerMessageId,
            inbound_preview: (content || "").slice(0, 200),
          },
        });
      } catch (e) {
        console.error("manual_staff_takeover emit failed:", e);
      }
    }

    // ===== BOOK-IT auto-reply =========================================
    // Booking-intent replies get an automatic acknowledgement pointing at
    // the customer's most recent quote. No slot is ever chosen from an
    // ambiguous "book it" — the customer picks a specific time on the web.
    // Compliance keywords (STOP/START) and escalation categories short-
    // circuit before this block runs.
    if (
      complianceIntent === null &&
      richIntent.kind === "booking"
    ) {
      try {
        // Best-effort: find the most recent quote associated with this
        // phone. Falls back to a generic quotes landing if none exists.
        const appUrl = getAppUrl();
        let quoteLink = `${appUrl}/quote`;
        let firstName: string | null = null;

        const { data: customer } = await supabase
          .from("customers")
          .select("id, first_name")
          .eq("phone", phone)
          .maybeSingle();
        if (customer) {
          firstName = customer.first_name ?? null;
          const { data: quote } = await supabase
            .from("quotes")
            .select("id, updated_at")
            .eq("customer_id", customer.id)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (quote?.id) quoteLink = `${appUrl}/quote/${quote.id}`;
        }

        const callrail = getCallRailConfig();
        if (callrail) {
          const reply = renderBookingAutoReply({ firstName, quoteLink });
          const result = await sendCallRailSms(callrail, phone, reply);
          await supabase.from("sms_messages").insert({
            to_number: phone,
            body: reply,
            message_kind: "auto_reply_booking_intent",
            status: result.ok ? "sent" : "failed",
            provider_message_id: result.messageId ?? null,
            error: result.ok ? null : result.error ?? null,
            sent_at: result.ok ? new Date().toISOString() : null,
          });
        } else {
          console.warn("BOOK-IT reply skipped: CallRail not configured");
        }
      } catch (e) {
        console.error("BOOK-IT auto-reply failed:", e);
      }
    }

    if (complianceIntent === "stop") {
      await supabase.from("sms_opt_outs").upsert({
        phone,
        opted_out: true,
        source: "customer_reply",
        reason: "Replied STOP",
        last_inbound_body: content,
        opted_out_at: nowIso,
      }, { onConflict: "phone" });

      // Cancel any queued/pending messages to this number.
      await supabase.from("sms_messages")
        .update({ status: "cancelled", error: "Recipient opted out (STOP)" })
        .eq("to_number", phone)
        .eq("status", "pending");

      console.log(`inbound-sms: opted OUT ${phone}`);
      return new Response(JSON.stringify({ ok: true, action: "opted_out" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (complianceIntent === "start") {
      await supabase.from("sms_opt_outs").upsert({
        phone,
        opted_out: false,
        source: "customer_reply",
        reason: "Replied START",
        last_inbound_body: content,
        opted_in_at: nowIso,
      }, { onConflict: "phone" });

      console.log(`inbound-sms: opted IN ${phone}`);
      return new Response(JSON.stringify({ ok: true, action: "opted_in" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== Conversational routing =====================================
    // Any inbound that survived compliance (STOP/START/HELP) and escalation
    // gates — including booking-intent replies that the auto-reply above
    // acknowledged — is routed through the canonical AI orchestrator so the
    // customer can actually converse over SMS. If CallRail isn't configured
    // (dev/preview), we still run the orchestrator so tests can assert
    // routing, but we do not attempt to send.
    let aiAction: string = "logged";
    try {
      const callrail = getCallRailConfig();
      const result = await routeInboundSmsToOrchestrator({
        supabase, phoneE164: phone, userMessage: content, providerMessageId,
      });
      aiAction = "ai_replied";
      if (callrail && result.reply) {
        // BOOK-IT branch above already sent one segment with the resume link;
        // avoid double-texting for the same inbound.
        const alreadySentBookIt =
          complianceIntent === null && richIntent.kind === "booking";
        if (!alreadySentBookIt) {
          const send = await sendCallRailSms(callrail, phone, result.reply.slice(0, SMS_REPLY_MAX_CHARS));
          await supabase.from("sms_messages").insert({
            to_number: phone,
            body: result.reply,
            message_kind: "ai_conversation",
            status: send.ok ? "sent" : "failed",
            provider_message_id: send.messageId ?? null,
            error: send.ok ? null : send.error ?? null,
            sent_at: send.ok ? new Date().toISOString() : null,
          });
          aiAction = send.ok ? "ai_replied" : "ai_reply_failed";
        }
      }
    } catch (e) {
      console.error("SMS orchestrator route failed:", e);
      aiAction = "ai_error";
    }

    return new Response(JSON.stringify({ ok: true, action: aiAction }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("callrail-inbound-sms error:", error);
    // Always 200 so the webhook provider does not retry-storm.
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
