import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCallRailConfig, sendCallRailSms, isPhoneOptedOut, getCustomerPause } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM_EMAIL = "BluLadder <noreply@bluladder.com>";

// Exponential-ish backoff (in minutes) applied before each retry, indexed by
// the attempt number that just failed (1st failure -> 5 min, 2nd -> 30 min, ...).
const RETRY_BACKOFF_MINUTES = [5, 30, 120];

function nextRetryIso(attempts: number): string {
  const idx = Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1);
  const minutes = RETRY_BACKOFF_MINUTES[Math.max(0, idx)];
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

/**
 * Build the update payload for a failed send. Permanent failures (bad
 * recipient / misconfiguration) are never retried; transient failures are
 * rescheduled with backoff until max_attempts is reached.
 */
function failureUpdate(
  prevAttempts: number,
  maxAttempts: number,
  errorMsg: string,
  permanent = false,
): Record<string, unknown> {
  const attempts = (prevAttempts ?? 0) + 1;
  const limit = maxAttempts && maxAttempts > 0 ? maxAttempts : 3;
  if (permanent || attempts >= limit) {
    return { status: "failed", error: errorMsg, attempts, next_retry_at: null };
  }
  const retryAt = nextRetryIso(attempts);
  return { status: "pending", error: errorMsg, attempts, send_at: retryAt, next_retry_at: retryAt };
}

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

  // Atomically claim a batch of due messages. The RPC marks each row as
  // 'processing' under a row lock (SKIP LOCKED) so overlapping runs — now that
  // the queue fires every minute — can never grab or send the same message
  // twice. It also recovers rows stuck in 'processing' from a crashed run.
  const { data: due, error } = await supabase.rpc("claim_due_sms", { p_limit: 50 });

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
        await supabase.from("sms_messages").update(
          failureUpdate(msg.attempts, msg.max_attempts, "No recipient email", true),
        ).eq("id", msg.id);
        failed++;
        continue;
      }
      // Skip leads whose email channel was paused after the message was queued.
      const pauseEmail = await getCustomerPause(supabase, { id: msg.customer_id, email: msg.to_email });
      if (pauseEmail.email_paused) {
        await supabase.from("sms_messages").update({
          status: "cancelled", error: "Email paused for this lead", next_retry_at: null,
        }).eq("id", msg.id);
        continue;
      }
      if (!resendKey) {
        await supabase.from("sms_messages").update(
          failureUpdate(msg.attempts, msg.max_attempts, "Email sending not configured", true),
        ).eq("id", msg.id);
        failed++;
        continue;
      }
      const er = await sendEmail(resendKey, msg.to_email as string, msg.subject as string, msg.body as string);
      if (er.ok) {
        await supabase.from("sms_messages").update({
          status: "sent", sent_at: new Date().toISOString(),
          callrail_message_id: er.messageId ?? null, attempts: (msg.attempts ?? 0) + 1, error: null, next_retry_at: null,
        }).eq("id", msg.id);
        sent++;
      } else {
        await supabase.from("sms_messages").update(
          failureUpdate(msg.attempts, msg.max_attempts, er.error ?? "send failed"),
        ).eq("id", msg.id);
        failed++;
      }
      continue;
    }

    // Skip recipients who have opted out since the message was queued.
    if (await isPhoneOptedOut(supabase, msg.to_number as string)) {
      await supabase.from("sms_messages").update({
        status: "cancelled", error: "Recipient has opted out of texts", next_retry_at: null,
      }).eq("id", msg.id);
      continue;
    }
    // Skip leads whose text channel was paused after the message was queued.
    const pauseSms = await getCustomerPause(supabase, { id: msg.customer_id, phone: msg.to_number });
    if (pauseSms.sms_paused) {
      await supabase.from("sms_messages").update({
        status: "cancelled", error: "Texting paused for this lead", next_retry_at: null,
      }).eq("id", msg.id);
      continue;
    }
    if (!config) {
      await supabase.from("sms_messages").update(
        failureUpdate(msg.attempts, msg.max_attempts, "CallRail not configured", true),
      ).eq("id", msg.id);
      failed++;
      continue;
    }
    const result = await sendCallRailSms(config, msg.to_number as string, msg.body as string);
    if (result.ok) {
      await supabase.from("sms_messages").update({
        status: "sent", sent_at: new Date().toISOString(),
        callrail_message_id: result.messageId ?? null, attempts: (msg.attempts ?? 0) + 1, error: null, next_retry_at: null,
      }).eq("id", msg.id);
      sent++;
    } else {
      // Give up after max_attempts; otherwise reschedule with backoff.
      await supabase.from("sms_messages").update(
        failureUpdate(msg.attempts, msg.max_attempts, result.error ?? "send failed"),
      ).eq("id", msg.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: (due || []).length, sent, failed }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});