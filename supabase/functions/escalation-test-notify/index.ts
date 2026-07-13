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

  if (!recipient?.phone) return json({ error: "No enabled escalation recipient with a phone is configured." }, 400);

  const messageBody = [
    "BluLadder internal test alert",
    "This is a controlled test of the escalation notification pipeline.",
    `Requested by admin at ${new Date().toISOString()}`,
    "No customer action is required.",
  ].join("\n");

  let smsStatus = "skipped";
  let smsError: string | null = null;
  const cr = getCallRailConfig();
  if (!cr) {
    smsStatus = "not_configured";
    smsError = "CallRail is not configured";
  } else {
    const r = await sendCallRailSms(cr, recipient.phone, messageBody);
    smsStatus = r.ok ? "sent" : "failed";
    smsError = r.ok ? null : (r.error ?? "unknown").slice(0, 200);
  }

  let emailStatus = "skipped";
  let emailError: string | null = null;
  const emailTo = recipient.email || settings?.notify_email || null;
  if (settings?.email_alerts_enabled && emailTo) {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) { emailStatus = "not_configured"; emailError = "RESEND_API_KEY missing"; }
    else {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "BluLadder Alerts <noreply@bluladder.com>",
          to: [emailTo],
          subject: "BluLadder internal test alert",
          html: `<pre style="font-family:system-ui,sans-serif">${messageBody}</pre>`,
        }),
      });
      emailStatus = resp.ok ? "sent" : "failed";
      emailError = resp.ok ? null : `resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
    }
  }

  return json({
    status: "done",
    recipient: recipient.name,
    sms: { status: smsStatus, error: smsError, to: recipient.phone },
    email: { status: emailStatus, error: emailError, to: emailTo },
  });
});
