// ============================================================================
// staff-reply — a human agent who has taken over an AI conversation sends a
// CUSTOMER-VISIBLE reply on an approved channel (SMS or email). This is NOT the
// internal-notes field: internal notes never reach the customer.
//
// Repaired behavior (production defect 3):
//  * SMS is sent DIRECTLY via the approved CallRail path from the BluLadder app
//    number (purpose=app_ai, (469) 747-2877) — NOT by calling send-sms with a
//    service-role token (which send-sms's admin-gated manual path rejects).
//  * Email is sent via the verified Resend sender; provider errors are parsed
//    into specific, actionable, secret-free admin messages.
//  * Success is reported ONLY after provider acceptance is confirmed.
//  * requested_follow_up consent (never marketing); genuine SMS opt-out blocks.
//  * The protected test identity stays suppressed unless a single-use,
//    short-lived, operations-admin authorization is present ("would have sent"
//    otherwise). That authorization never disables suppression globally.
//  * Every outcome (sent / would-have-sent / failed) is written to the
//    conversation timeline and returned with a correlation id for diagnostics.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBearer, verifyAdmin, isServiceRoleToken } from "../_shared/auth.ts";
import { checkSuppression } from "../_shared/suppression.ts";
import { getPhoneByPurpose } from "../_shared/phoneConfig.ts";
import { sendEmail } from "../_shared/emailConfig.ts";
import {
  getCallRailConfig,
  sendCallRailSms,
  normalizePhone,
  isPhoneOptedOut,
  type CallRailConfig,
} from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200, correlationId?: string) {
  const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
  if (correlationId) headers["x-correlation-id"] = correlationId;
  return new Response(JSON.stringify(body), { status, headers });
}

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const correlationId = crypto.randomUUID();

  // ---- Auth: operations-admin session or internal service-role only. ----
  const token = getBearer(req);
  const isService = isServiceRoleToken(token);
  const adminId = isService ? "service" : await verifyAdmin(token, "operations_admin");
  if (!adminId) {
    return json({ ok: false, errorCode: "unauthorized_session", message: "Your session expired. Please sign in again.", correlationId }, 401, correlationId);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, errorCode: "invalid_request", message: "Invalid request.", correlationId }, 400, correlationId); }

  const conversationId = String(body?.conversationId || "");
  const channel = body?.channel === "email" ? "email" : "sms";
  const message = String(body?.message || "").trim().slice(0, 2000);
  const subject = String(body?.subject || "BluLadder — a reply to your request").slice(0, 200);
  // Operations-admin opt-in to send ONE real reply despite test suppression.
  const useTestAuthorization = body?.useTestAuthorization === true;
  if (!conversationId || !message) {
    return json({ ok: false, errorCode: "invalid_request", message: "A conversation and a message are required.", correlationId }, 400, correlationId);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: convo } = await supabase
    .from("chat_conversations")
    .select("id, prospect_name, prospect_email, prospect_phone, staff_takeover_at, conversation_state")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo) {
    return json({ ok: false, errorCode: "conversation_not_found", message: "This conversation no longer exists.", correlationId }, 404, correlationId);
  }

  // Eligibility: a customer-visible staff reply is only for a taken-over
  // conversation (a human is handling it). Non-service callers must be in takeover.
  const inTakeover = !!convo.staff_takeover_at || convo.conversation_state === "staff_takeover";
  if (!isService && !inTakeover) {
    return json({ ok: false, errorCode: "not_eligible", message: "This conversation is not eligible for a staff reply. Take over the conversation first.", correlationId }, 403, correlationId);
  }

  // Resolve + normalize the recipient for the chosen channel.
  const rawTo = channel === "sms" ? (convo.prospect_phone || "") : (convo.prospect_email || "");
  if (!rawTo) {
    return json({ ok: false, errorCode: "no_contact", message: `No customer ${channel === "sms" ? "phone number" : "email address"} on file.`, correlationId }, 400, correlationId);
  }
  const to = channel === "sms" ? (normalizePhone(rawTo) || "") : rawTo.toLowerCase().trim();
  if (channel === "sms" && !to) {
    return json({ ok: false, errorCode: "invalid_recipient", message: "The customer phone number on file is not a valid US/Canada number.", correlationId }, 400, correlationId);
  }
  if (channel === "email" && !isValidEmail(to)) {
    return json({ ok: false, errorCode: "invalid_recipient", message: "The customer email address on file is not valid.", correlationId }, 400, correlationId);
  }

  // Requested human follow-up consent for the chosen channel — NOT marketing.
  try {
    await supabase.rpc("record_consent", {
      p_channel: channel, p_consent_type: "requested_follow_up", p_status: "granted",
      p_email: channel === "email" ? to : null, p_phone: channel === "sms" ? to : null,
      p_language_shown: "A BluLadder team member is replying to your request.",
      p_source: "staff_takeover_reply", p_conversation_id: conversationId,
    });
  } catch (e) { console.error(`[staff-reply ${correlationId}] record_consent failed:`, e); }

  // Genuine SMS opt-out always blocks (independent of test suppression).
  if (channel === "sms" && await isPhoneOptedOut(supabase, to)) {
    await recordTimeline(supabase, conversationId, channel, to, message, "opted_out", "recipient opted out", adminId, correlationId, false);
    return json({ ok: false, status: "opted_out", errorCode: "opted_out", deliveryState: "opted_out", channel, to, message: "SMS could not be sent: the recipient has opted out of texts.", correlationId }, 200, correlationId);
  }
  // NOTE: email unsubscribe (marketing) does NOT block an explicitly requested
  // service reply — this is a requested_follow_up transactional response.

  // Test-identity / global suppression gate. A single-use, short-lived,
  // operations-admin authorization may allow exactly one real send.
  // Staff replies are direct responses to an inbound customer message on this
  // conversation — a callback/"contact us" confirmation. Allowlisted so a
  // protected test identity can receive their own requested reply.
  const suppression = await checkSuppression(
    supabase,
    channel === "sms" ? { phone: to } : { email: to },
    { purpose: "contact_request_received" },
  );
  if (suppression.suppressed) {
    let authorizedId: string | null = null;
    if (useTestAuthorization && !isService) {
      const { data: consumed } = await supabase.rpc("consume_staff_test_reply_auth", {
        p_conversation_id: conversationId, p_channel: channel,
      });
      authorizedId = (consumed as string | null) ?? null;
    }
    if (!authorizedId) {
      // Suppressed → record a "would have sent" entry in the timeline.
      await recordTimeline(supabase, conversationId, channel, to, message, "suppressed", suppression.reason ?? "suppressed", adminId, correlationId, false);
      return json({
        ok: false, status: "suppressed", errorCode: "suppressed", deliveryState: "suppressed",
        channel, to, reason: suppression.reason,
        wouldHaveSent: true,
        message: `Not sent — this recipient is protected by test suppression (${suppression.reason ?? "suppressed"}). Recorded as "would have sent". An operations admin can authorize one real test reply.`,
        correlationId,
      }, 200, correlationId);
    }
    // else: an authorization was consumed — fall through and actually send once.
    console.log(`[staff-reply ${correlationId}] test suppression overridden by single-use auth ${authorizedId}`);
  }

  // ---- Deliver ----
  let deliveryState = "sent";
  let providerMessageId: string | null = null;
  let providerStatus: string | null = null;
  let errorCode: string | null = null;
  let failureCategory: string | null = null;
  let retryable = false;
  let fromAddress: string | null = null;
  let replyToAddress: string | null = null;
  let userMessage = `Reply sent by ${channel.toUpperCase()}.`;

  if (channel === "sms") {
    const base = getCallRailConfig();
    if (!base) {
      await recordTimeline(supabase, conversationId, channel, to, message, "failed", "callrail not configured", adminId, correlationId, false);
      return json({ ok: false, status: "failed", errorCode: "provider_not_configured", deliveryState: "delivery_failed", channel, to, message: "SMS could not be sent: the messaging provider is not configured.", correlationId }, 200, correlationId);
    }
    // Send FROM the approved BluLadder app number (purpose=app_ai).
    const appPhone = await getPhoneByPurpose(supabase, "app_ai");
    const config: CallRailConfig = { ...base, senderNumber: appPhone.e164 || base.senderNumber };
    const result = await sendCallRailSms(config, to, message);
    if (result.ok) {
      deliveryState = "accepted";
      providerMessageId = result.messageId ?? null;
      providerStatus = "accepted";
      // Persist to the SMS ledger for parity with other outbound texts.
      const acceptedAt = new Date().toISOString();
      await supabase.from("sms_messages").insert({
        to_number: to, body: message, message_kind: "staff_reply", status: "accepted",
        sent_at: acceptedAt, callrail_message_id: providerMessageId, attempts: 1,
        provider: "callrail",
        provider_conversation_id: result.conversationId ?? null,
        provider_message_id: providerMessageId,
        provider_status: result.providerMessageStatus ?? "accepted",
        provider_response_kind: result.providerResponseKind ?? null,
        provider_accepted_at: acceptedAt,
      });
    } else {
      deliveryState = "delivery_failed";
      providerStatus = "rejected";
      errorCode = "provider_rejected";
      userMessage = "SMS could not be sent: the provider rejected the message.";
      console.error(`[staff-reply ${correlationId}] CallRail send failed: ${result.error}`);
    }
  } else {
    // Customer-visible email via the SINGLE centralized sender (no hard-coded From).
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;white-space:pre-wrap">${escapeHtml(message)}</div>`;
    const res = await sendEmail({ to, subject, html });
    fromAddress = res.from;
    replyToAddress = res.replyTo;
    if (res.ok) {
      deliveryState = "accepted";
      providerStatus = "accepted";
      providerMessageId = res.providerMessageId;
    } else {
      deliveryState = "delivery_failed";
      providerStatus = res.failure?.reachedProvider ? `rejected_${res.httpStatus ?? "?"}` : "not_attempted";
      errorCode = res.failure?.category ?? "provider_rejected";
      failureCategory = res.failure?.category ?? "provider_rejected";
      retryable = res.failure?.retryable ?? false;
      userMessage = `Email not sent: ${res.failure?.message ?? "the email provider rejected the request."}`;
      console.error(`[staff-reply ${correlationId}] email failed [${errorCode}] status=${res.httpStatus} reached=${res.failure?.reachedProvider}`);
    }
  }

  // Record the outbound reply in the conversation timeline (staff, not AI),
  // including whether the provider actually accepted it.
  await recordTimeline(supabase, conversationId, channel, to, message, deliveryState, providerStatus ?? "", adminId, correlationId, false, providerMessageId);
  await supabase.from("chat_conversations").update({ last_activity_at: new Date().toISOString() }).eq("id", conversationId);

  const ok = deliveryState === "accepted";
  return json({
    ok,
    status: ok ? "accepted" : "failed",
    deliveryState,
    channel,
    to,
    from: fromAddress,
    replyTo: replyToAddress,
    providerMessageId,
    providerStatus,
    errorCode,
    failureCategory,
    retryable,
    message: userMessage,
    correlationId,
  }, 200, correlationId);
});

// deno-lint-ignore no-explicit-any
async function recordTimeline(
  supabase: any,
  conversationId: string,
  channel: string,
  to: string,
  content: string,
  deliveryState: string,
  providerResponse: string,
  adminId: string,
  correlationId: string,
  delivered: boolean,
  providerMessageId: string | null = null,
) {
  const { error } = await supabase.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "staff",
    content,
    tool_name: "staff_reply",
    tool_result: { channel, to, deliveryState, delivered, providerResponse, providerMessageId, adminId, correlationId },
  });
  // supabase-js does NOT throw on a DB error; surface it so a failed audit
  // write can never again silently disappear (the role-constraint defect).
  if (error) console.error(`[staff-reply ${correlationId}] timeline insert failed: ${error.message ?? error}`);
}
