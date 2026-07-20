import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { normalizePhone, classifyInbound, getCallRailConfig, sendCallRailSms } from "../_shared/sms.ts";
import { classifyInboundIntent, renderBookingAutoReply } from "../_shared/bookingIntent.ts";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { routeInboundSmsToOrchestrator, SMS_REPLY_MAX_CHARS } from "../_shared/smsOrchestrator.ts";
import { sharedRateLimit } from "../_shared/rateLimit.ts";
import {
  recordInboundReceipt, markAttempt, markProcessed,
  classifyError, isTransient, nextAttemptAt, MAX_ATTEMPTS, safePayloadSnapshot,
} from "../_shared/callrailReceipts.ts";

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

    // Higher-fidelity intent classifier used for BOOK-IT / escalation routing.
    const richIntent = classifyInboundIntent(content);
    const intent = classifyInbound(content);

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

    // Log the inbound reply for visibility in the message log. We do this
    // AFTER durable receipt so a duplicate never inserts a second row.
    const { data: inboundRow } = await supabase.from("sms_messages").insert({
      to_number: phone,
      body: content || "(empty)",
      message_kind: "inbound",
      status: "inbound",
      sent_at: nowIso,
      provider_message_id: providerMessageId,
    }).select("id").maybeSingle();
    const inboundSmsId = (inboundRow?.id as string | undefined) ?? null;

    // Wrap the rest of processing so any thrown error lands the event in a
    // retry/dead-letter state instead of a silent 200.
    const runProcessing = async () => {
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
          if (quote?.id) {
            // Mint a fresh opaque resume URL at reply-time so the customer
            // never receives a bare /quote/<uuid> that would leak PII.
            const { mintResumeUrl } = await import("../_shared/resumeLink.ts");
            quoteLink = await mintResumeUrl(supabase, quote.id, { reason: "callrail_book_it_reply" });
          }
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
      return { action: "opted_out" };
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
      return { action: "opted_in" };
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
        // deno-lint-ignore no-explicit-any
        supabase: supabase as any, phoneE164: phone, userMessage: content, providerMessageId,
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
      throw e;
    }

    return { action: aiAction };
    };

    try {
      const result = await runProcessing();
      await markProcessed(supabase, receiptId, { smsMessageId: inboundSmsId });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (procErr) {
      const { category, detail } = classifyError(procErr);
      // Read current attempts to decide retry vs dead-letter.
      const { data: cur } = await supabase
        .from("callrail_inbound_events")
        .select("attempts")
        .eq("id", receiptId)
        .maybeSingle();
      const attemptsAfter = ((cur?.attempts as number | undefined) ?? 0) + 1;
      const canRetry = isTransient(category) && attemptsAfter < MAX_ATTEMPTS;
      await markAttempt(supabase, receiptId, {
        status: canRetry ? "retry_pending" : "failed",
        last_error_category: category,
        last_error_detail: detail,
        next_attempt_at: canRetry ? nextAttemptAt(attemptsAfter) : null,
        sms_message_id: inboundSmsId,
      });
      // Always 200 to CallRail — retries happen off the durable receipt via
      // ops replay / scheduled sweep, not by asking the provider to redeliver.
      return new Response(
        JSON.stringify({ ok: false, action: canRetry ? "retry_pending" : "failed", category }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (error) {
    console.error("callrail-inbound-sms error:", error);
    // Always 200 so the webhook provider does not retry-storm.
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
