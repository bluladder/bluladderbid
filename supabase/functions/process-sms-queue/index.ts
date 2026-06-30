import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCallRailConfig, sendCallRailSms, isPhoneOptedOut, getCustomerPause } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM_EMAIL = "BluLadder <noreply@bluladder.com>";

/** Send an email through Resend. Returns a SendResult-like object. */
async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  text: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const safeHtml = text
      .split("\n")
      .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
      .join("<br />");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">${safeHtml}</div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: subject || "BluLadder", html }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${body}` };
    let messageId: string | undefined;
    try { messageId = JSON.parse(body)?.id; } catch { /* ignore */ }
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Processes due, pending SMS (campaign follow-ups + any retries). Invoked by cron.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const config = getCallRailConfig();
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("sms_messages")
    .select("id, to_number, to_email, channel, subject, body, attempts, customer_id")
    .eq("status", "pending")
    .lte("send_at", nowIso)
    .order("send_at", { ascending: true })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;

  for (const msg of due || []) {
    // ---- Email channel ----
    if (msg.channel === "email") {
      if (!msg.to_email) {
        await supabase.from("sms_messages").update({
          status: "failed", error: "No recipient email", attempts: (msg.attempts ?? 0) + 1,
        }).eq("id", msg.id);
        failed++;
        continue;
      }
      // Skip leads whose email channel was paused after the message was queued.
      const pauseEmail = await getCustomerPause(supabase, { id: msg.customer_id, email: msg.to_email });
      if (pauseEmail.email_paused) {
        await supabase.from("sms_messages").update({
          status: "cancelled", error: "Email paused for this lead",
        }).eq("id", msg.id);
        continue;
      }
      if (!resendKey) {
        await supabase.from("sms_messages").update({
          status: "failed", error: "Email sending not configured", attempts: (msg.attempts ?? 0) + 1,
        }).eq("id", msg.id);
        failed++;
        continue;
      }
      const er = await sendEmail(resendKey, msg.to_email as string, msg.subject as string, msg.body as string);
      if (er.ok) {
        await supabase.from("sms_messages").update({
          status: "sent", sent_at: new Date().toISOString(),
          callrail_message_id: er.messageId ?? null, attempts: (msg.attempts ?? 0) + 1, error: null,
        }).eq("id", msg.id);
        sent++;
      } else {
        const attempts = (msg.attempts ?? 0) + 1;
        await supabase.from("sms_messages").update({
          status: attempts >= 3 ? "failed" : "pending", error: er.error ?? "send failed", attempts,
        }).eq("id", msg.id);
        failed++;
      }
      continue;
    }

    // Skip recipients who have opted out since the message was queued.
    if (await isPhoneOptedOut(supabase, msg.to_number as string)) {
      await supabase.from("sms_messages").update({
        status: "cancelled", error: "Recipient has opted out of texts",
      }).eq("id", msg.id);
      continue;
    }
    // Skip leads whose text channel was paused after the message was queued.
    const pauseSms = await getCustomerPause(supabase, { id: msg.customer_id, phone: msg.to_number });
    if (pauseSms.sms_paused) {
      await supabase.from("sms_messages").update({
        status: "cancelled", error: "Texting paused for this lead",
      }).eq("id", msg.id);
      continue;
    }
    if (!config) {
      await supabase.from("sms_messages").update({
        status: "failed", error: "CallRail not configured", attempts: (msg.attempts ?? 0) + 1,
      }).eq("id", msg.id);
      failed++;
      continue;
    }
    const result = await sendCallRailSms(config, msg.to_number as string, msg.body as string);
    if (result.ok) {
      await supabase.from("sms_messages").update({
        status: "sent", sent_at: new Date().toISOString(),
        callrail_message_id: result.messageId ?? null, attempts: (msg.attempts ?? 0) + 1, error: null,
      }).eq("id", msg.id);
      sent++;
    } else {
      const attempts = (msg.attempts ?? 0) + 1;
      // Give up after 3 attempts; otherwise leave pending for the next run.
      await supabase.from("sms_messages").update({
        status: attempts >= 3 ? "failed" : "pending", error: result.error ?? "send failed", attempts,
      }).eq("id", msg.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: (due || []).length, sent, failed }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});