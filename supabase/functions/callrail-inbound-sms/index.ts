import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { normalizePhone, classifyInbound } from "../_shared/sms.ts";

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

    if (intent === "stop") {
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

    if (intent === "start") {
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

    return new Response(JSON.stringify({ ok: true, action: "logged" }), {
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
