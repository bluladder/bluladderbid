// Passwordless customer verification — REQUEST endpoint.
// Generates a 6-digit OTP, stores only its hash, and sends it via the existing
// CallRail SMS integration. Response is intentionally generic and reveals no
// information about whether the phone number matches an existing customer.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizePhone,
  getCallRailConfig,
  sendCallRailSms,
  isPhoneOptedOut,
} from "../_shared/sms.ts";
import { checkSuppression } from "../_shared/suppression.ts";
import { sendEmail } from "../_shared/emailConfig.ts";
import { normalizeEmailAddr } from "../_shared/emailSuppression.ts";
import {
  sha256Hex,
  generateOtp,
  loadVerificationConfig,
  clientIp,
} from "../_shared/customerVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OTP_GRACE_SECONDS = 20 * 60;
const EMAIL_SUBJECT = "Your BluLadder verification code";

// Generic success response — never leaks whether a customer exists.
const GENERIC_OK = { status: "ok", message: "If that contact method is reachable, you will receive a code shortly." };

const validEmail = (raw: string | null) => !!raw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c] as string));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const raw = typeof body?.phone === "string" ? body.phone : "";
    const phone = normalizePhone(raw);
    const email = normalizeEmailAddr(typeof body?.email === "string" ? body.email : "");
    // Always return the same shape/latency regardless of validity.
    const respond = () => new Response(JSON.stringify(GENERIC_OK), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    if (!phone && !validEmail(email)) return respond();

    const cfg = await loadVerificationConfig(supabase);
    const phoneHash = phone ? await sha256Hex(phone) : null;
    const emailHash = email ? await sha256Hex(email) : null;
    const ipHash = await sha256Hex(clientIp(req));
    const now = Date.now();
    const cooldownIso = new Date(now - cfg.per_phone_cooldown_seconds * 1000).toISOString();
    const hourAgoIso = new Date(now - 3600_000).toISOString();

    // Rate-limit gates (silent — same generic response).
    const { count: recentCount } = await supabase
      .from("customer_verification_challenges")
      .select("id", { count: "exact", head: true })
      .eq(phoneHash ? "phone_hash" : "recipient_hint", phoneHash ?? emailHash)
      .gte("created_at", cooldownIso);
    if ((recentCount ?? 0) > 0) return respond();

    const { count: hourCount } = await supabase
      .from("customer_verification_challenges")
      .select("id", { count: "exact", head: true })
      .eq(phoneHash ? "phone_hash" : "recipient_hint", phoneHash ?? emailHash)
      .gte("created_at", hourAgoIso);
    if ((hourCount ?? 0) >= cfg.per_phone_max_per_hour) return respond();

    const { count: ipHourCount } = await supabase
      .from("customer_verification_challenges")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", hourAgoIso);
    if ((ipHourCount ?? 0) >= cfg.per_ip_max_per_hour) return respond();

    // Opt-out or test-identity suppression — record the attempt but never send.
    const optedOut = phone ? await isPhoneOptedOut(supabase, phone) : false;
    // Portal OTP is an explicit user-initiated verification challenge with
    // rate limiting + short expiry already enforced above. Allowlisted for
    // protected test identities so owners can log into their own portal.
    const testSup = await checkSuppression(
      supabase,
      phone ? { phone } : { email },
      { purpose: "verification" },
    );

    const otp = generateOtp();
    const otpHash = await sha256Hex(otp);
    const expiresAt = new Date(now + cfg.otp_ttl_seconds * 1000).toISOString();
    const usableUntil = new Date(now + (cfg.otp_ttl_seconds + OTP_GRACE_SECONDS) * 1000).toISOString();

    const { data: challenge, error: chErr } = await supabase
      .from("customer_verification_challenges")
      .insert({
        phone_hash: phoneHash,
        otp_hash: otpHash,
        expires_at: expiresAt,
        max_attempts: cfg.max_attempts,
        ip_hash: ipHash,
        channel: phone ? "sms" : "email",
        provider: phone ? "callrail" : "resend",
        delivery_status: "queued",
        usable_until: usableUntil,
        recipient_hint: emailHash,
      })
      .select("id, correlation_id")
      .single();
    if (chErr || !challenge) return respond();

    if (optedOut || testSup.suppressed) {
      await supabase.from("customer_verification_challenges")
        .update({ delivery_status: testSup.suppressed ? "suppressed_test_identity" : "suppressed_optout" })
        .eq("id", challenge.id);
      return respond();
    }

    if (email && !phone) {
      const textBody = `Your BluLadder verification code is ${otp}. It expires in ${Math.round((cfg.otp_ttl_seconds + OTP_GRACE_SECONDS) / 60)} minutes. Do not share this code.`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.6;font-size:16px;">
          <p>Your BluLadder verification code is:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0;">${escapeHtml(otp)}</p>
          <p>This code expires in ${Math.round((cfg.otp_ttl_seconds + OTP_GRACE_SECONDS) / 60)} minutes. Do not share it.</p>
        </div>`;
      const result = await sendEmail({ to: email, subject: EMAIL_SUBJECT, html });
      const acceptedAt = result.ok ? new Date().toISOString() : null;
      await supabase.from("customer_verification_challenges").update({
        provider_message_id: result.providerMessageId,
        provider_status: result.ok ? "accepted" : (result.failure?.category ?? "rejected"),
        provider_response_kind: result.failure?.category ?? "email",
        provider_accepted_at: acceptedAt,
        delivery_status: result.ok ? "accepted" : (result.failure?.category === "suppressed" ? "suppressed_email" : "delivery_failed"),
      }).eq("id", challenge.id);
      await supabase.from("sms_messages").insert({
        channel: "email",
        to_email: email,
        subject: EMAIL_SUBJECT,
        body: textBody,
        message_kind: "verification",
        status: result.ok ? "accepted" : "failed",
        sent_at: acceptedAt,
        callrail_message_id: result.providerMessageId,
        provider: "resend",
        provider_message_id: result.providerMessageId,
        provider_status: result.ok ? "accepted" : (result.failure?.category ?? "rejected"),
        provider_response_kind: result.failure?.category ?? "email",
        provider_accepted_at: acceptedAt,
        error: result.ok ? null : (result.failure?.message ?? "send failed"),
        attempts: 1,
      });
      return respond();
    }

    const config = getCallRailConfig();
    if (!config) {
      await supabase.from("customer_verification_challenges")
        .update({ delivery_status: "provider_rejected" })
        .eq("id", challenge.id);
      return respond();
    }

    const smsBody = `Your BluLadder verification code is ${otp}. It expires in ${Math.round(cfg.otp_ttl_seconds / 60)} minutes. Do not share this code.`;
    const result = await sendCallRailSms(config, phone, smsBody);
    const acceptedAt = result.ok ? new Date().toISOString() : null;
    const providerStatus = result.providerMessageStatus ?? (result.ok ? "accepted" : "rejected");
    const smsDeliveryStatus = result.ok && providerStatus !== "failed" ? "accepted" : "delivery_failed";
    await supabase.from("customer_verification_challenges").update({
      callrail_message_id: result.messageId ?? null,
      provider_conversation_id: result.conversationId ?? null,
      provider_message_id: result.messageId ?? null,
      provider_status: providerStatus,
      provider_response_kind: result.providerResponseKind ?? null,
      provider_accepted_at: acceptedAt,
      delivery_status: smsDeliveryStatus,
    }).eq("id", challenge.id);

    // Also record in sms_messages for the operator audit trail.
    await supabase.from("sms_messages").insert({
      to_number: phone,
      body: smsBody,
      message_kind: "verification",
      status: result.ok ? "accepted" : "failed",
      sent_at: acceptedAt,
      callrail_message_id: result.messageId ?? null,
      provider: "callrail",
      provider_conversation_id: result.conversationId ?? null,
      provider_message_id: result.messageId ?? null,
      provider_status: providerStatus,
      provider_response_kind: result.providerResponseKind ?? null,
      provider_accepted_at: acceptedAt,
      error: result.ok ? null : (result.error ?? "send failed"),
      attempts: 1,
    });

    return respond();
  } catch (_err) {
    return new Response(JSON.stringify(GENERIC_OK), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});