// ============================================================================
// staff-reply — a human agent who has taken over an AI conversation sends a
// CUSTOMER-VISIBLE reply on an approved channel (SMS or email). This is NOT the
// internal-notes field: internal notes never reach the customer.
//
// It reuses the existing outbound messaging paths (send-sms → CallRail/queue for
// SMS, Resend for email), respects opt-outs/suppression, records only the
// requested_follow_up consent (never marketing), and writes the outbound reply
// into the conversation timeline as a `staff` message so it appears in the same
// dashboard thread.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBearer, verifyAdmin, isServiceRoleToken } from "../_shared/auth.ts";
import { checkSuppression } from "../_shared/suppression.ts";

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
  const adminId = isServiceRoleToken(token) ? "service" : await verifyAdmin(token, "operations_admin");
  if (!adminId) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

  const conversationId = String(body?.conversationId || "");
  const channel = body?.channel === "email" ? "email" : "sms";
  const message = String(body?.message || "").trim().slice(0, 2000);
  const subject = String(body?.subject || "BluLadder — a reply to your request").slice(0, 200);
  if (!conversationId || !message) return json({ error: "conversationId and message are required" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: convo } = await supabase
    .from("chat_conversations")
    .select("id, prospect_name, prospect_email, prospect_phone, staff_takeover, conversation_state")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo) return json({ error: "Conversation not found" }, 404);

  const to = channel === "sms" ? (convo.prospect_phone || "") : (convo.prospect_email || "");
  if (!to) return json({ error: `No customer ${channel === "sms" ? "phone" : "email"} on file` }, 400);

  // Respect opt-outs / suppression before sending.
  const suppression = await checkSuppression(supabase, channel === "sms" ? { phone: to } : { email: to });
  if (suppression.suppressed) {
    return json({ status: "suppressed", reason: suppression.reason, message: `This ${channel} address is suppressed and was not sent.` });
  }

  // Requested human follow-up consent for the chosen channel — NOT marketing.
  try {
    await supabase.rpc("record_consent", {
      p_channel: channel, p_consent_type: "requested_follow_up", p_status: "granted",
      p_email: channel === "email" ? to : null, p_phone: channel === "sms" ? to : null,
      p_language_shown: "A BluLadder team member is replying to your request.",
      p_source: "staff_takeover_reply", p_conversation_id: conversationId,
    });
  } catch (e) { console.error("record_consent (staff reply) failed:", e); }

  let deliveryStatus = "sent";
  let providerResponse: string | null = null;

  if (channel === "sms") {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      body: JSON.stringify({ to, body: message }),
    });
    providerResponse = `send-sms ${resp.status}`;
    if (!resp.ok) deliveryStatus = "failed";
  } else {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      deliveryStatus = "failed";
      providerResponse = "RESEND_API_KEY missing";
    } else {
      const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;white-space:pre-wrap">${
        message.replace(/[&<>]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
      }</div>`;
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "BluLadder <noreply@bluladder.com>", to: [to], subject, html }),
      });
      providerResponse = `resend ${resp.status}`;
      if (!resp.ok) { deliveryStatus = "failed"; providerResponse = `resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`; }
    }
  }

  // Record the outbound reply in the conversation timeline (staff, not AI).
  await supabase.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "staff",
    content: message,
    tool_name: "staff_reply",
    tool_result: { channel, to, deliveryStatus, providerResponse, adminId },
  });
  await supabase.from("chat_conversations").update({ last_activity_at: new Date().toISOString() }).eq("id", conversationId);

  return json({ status: deliveryStatus, channel, to, providerResponse });
});
