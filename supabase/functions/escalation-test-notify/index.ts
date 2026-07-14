// ============================================================================
// escalation-test-notify — a CONTROLLED, admin-only action that sends ONE real
// internal escalation alert to the configured primary recipient (Ben) so the
// team can verify the SMS/email pipeline end-to-end. It requires an explicit
// operations-admin call (the UI confirms first) and deliberately BYPASSES the
// test-identity suppression that normally protects +14692150144 during
// automated tests — because this is a human-initiated, one-off verification.
//
// It sends directly (CallRail for SMS, Resend for email), never enqueues bulk,
// and returns the exact provider status for the audit trail.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBearer, verifyAdmin } from "../_shared/auth.ts";
import { getCallRailConfig, sendCallRailSms } from "../_shared/sms.ts";
import { getPhoneByPurpose } from "../_shared/phoneConfig.ts";
import { sendEmail } from "../_shared/emailConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = getBearer(req);
  const adminId = await verifyAdmin(token, "operations_admin");
  if (!adminId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) return json({ error: "Explicit confirmation required" }, 400);
  // Email-only mode: the admin Email Diagnostics panel verifies the email path
  // without dispatching an SMS. Defaults to false (full SMS+email test).
  const emailOnly = body?.emailOnly === true;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: recipient } = await supabase
    .from("escalation_recipients")
    .select("name, phone, email")
    .eq("is_enabled", true)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: settings } = await supabase
    .from("escalation_settings")
    .select("email_alerts_enabled, notify_email")
    .eq("singleton", true)
    .maybeSingle();

  if (!emailOnly && !recipient?.phone) return json({ error: "No enabled escalation recipient with a phone is configured." }, 400);

  const messageBody = [
    "BluLadder internal test alert",
    "This is a controlled test of the escalation notification pipeline.",
    `Requested by admin at ${new Date().toISOString()}`,
    "No customer action is required.",
  ].join("\n");

  let smsStatus = "skipped";
  let smsError: string | null = null;
  const cr = getCallRailConfig();
  if (emailOnly) {
    smsStatus = "skipped";
  } else if (!cr) {
    smsStatus = "not_configured";
    smsError = "CallRail is not configured";
  } else {
    // Send FROM the approved BluLadder app number (purpose=app_ai).
    const appPhone = await getPhoneByPurpose(supabase, "app_ai");
    const cfg = { ...cr, senderNumber: appPhone.e164 || cr.senderNumber };
    const r = await sendCallRailSms(cfg, recipient.phone, messageBody);
    smsStatus = r.ok ? "sent" : "failed";
    smsError = r.ok ? null : (r.error ?? "unknown").slice(0, 200);
  }

  let emailStatus = "skipped";
  let emailError: string | null = null;
  let emailFrom: string | null = null;
  let emailProviderMessageId: string | null = null;
  let emailFailureCategory: string | null = null;
  const emailTo = recipient.email || settings?.notify_email || null;
  if (settings?.email_alerts_enabled && emailTo) {
    const html = `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${
      messageBody.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
    }</pre>`;
    const res = await sendEmail({ to: emailTo, subject: "BluLadder internal test alert", html, fromNameOverride: "BluLadder Alerts" });
    emailFrom = res.from;
    if (res.ok) {
      emailStatus = "sent";
      emailProviderMessageId = res.providerMessageId;
      // Record the last successful real email-send for the Email Diagnostics panel.
      try {
        const now = new Date().toISOString();
        const { data: sr } = await supabase.from("system_issues")
          .select("id").eq("dedupe_key", "email_send_success").maybeSingle();
        if (sr) {
          await supabase.from("system_issues").update({ status: "resolved", last_seen_at: now, details: { last_success_at: now } }).eq("id", sr.id);
        } else {
          await supabase.from("system_issues").insert({ issue_type: "email_delivery", dedupe_key: "email_send_success", severity: "info", status: "resolved", details: { last_success_at: now } });
        }
      } catch { /* health bookkeeping must never break the send result */ }
    } else if (res.failure?.category === "provider_not_configured") {
      emailStatus = "not_configured";
      emailError = res.failure.message;
      emailFailureCategory = res.failure.category;
    } else {
      emailStatus = "failed";
      emailError = res.failure?.message ?? "provider rejected";
      emailFailureCategory = res.failure?.category ?? "provider_rejected";
    }
  }

  return json({
    status: "done",
    recipient: recipient.name,
    sms: { status: smsStatus, error: smsError, to: recipient.phone },
    email: { status: emailStatus, error: emailError, category: emailFailureCategory, from: emailFrom, providerMessageId: emailProviderMessageId, to: emailTo },
    emailOnly,
  });
});
