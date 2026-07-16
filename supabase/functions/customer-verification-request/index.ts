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

// Generic success response — never leaks whether a customer exists.
const GENERIC_OK = { status: "ok", message: "If that phone is reachable, you will receive a code shortly." };

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
    // Always return the same shape/latency regardless of validity.
    const respond = () => new Response(JSON.stringify(GENERIC_OK), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    if (!phone) return respond();

    const cfg = await loadVerificationConfig(supabase);
    const phoneHash = await sha256Hex(phone);
    const ipHash = await sha256Hex(clientIp(req));
    const now = Date.now();
    const cooldownIso = new Date(now - cfg.per_phone_cooldown_seconds * 1000).toISOString();
    const hourAgoIso = new Date(now - 3600_000).toISOString();

    // Rate-limit gates (silent — same generic response).
    const { count: recentCount } = await supabase
      .from("customer_verification_challenges")
      .select("id", { count: "exact", head: true })
      .eq("phone_hash", phoneHash)
      .gte("created_at", cooldownIso);
    if ((recentCount ?? 0) > 0) return respond();

    const { count: hourCount } = await supabase
      .from("customer_verification_challenges")
      .select("id", { count: "exact", head: true })
      .eq("phone_hash", phoneHash)
      .gte("created_at", hourAgoIso);
    if ((hourCount ?? 0) >= cfg.per_phone_max_per_hour) return respond();

    const { count: ipHourCount } = await supabase
      .from("customer_verification_challenges")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", hourAgoIso);
    if ((ipHourCount ?? 0) >= cfg.per_ip_max_per_hour) return respond();

    // Opt-out or test-identity suppression — record the attempt but never send.
    const optedOut = await isPhoneOptedOut(supabase, phone);
    const testSup = await checkSuppression(supabase, { phone });

    const otp = generateOtp();
    const otpHash = await sha256Hex(otp);
    const expiresAt = new Date(now + cfg.otp_ttl_seconds * 1000).toISOString();

    const { data: challenge, error: chErr } = await supabase
      .from("customer_verification_challenges")
      .insert({
        phone_hash: phoneHash,
        otp_hash: otpHash,
        expires_at: expiresAt,
        max_attempts: cfg.max_attempts,
        ip_hash: ipHash,
        delivery_status: "queued",
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

    const config = getCallRailConfig();
    if (!config) {
      await supabase.from("customer_verification_challenges")
        .update({ delivery_status: "provider_rejected" })
        .eq("id", challenge.id);
      return respond();
    }

    const smsBody = `Your BluLadder verification code is ${otp}. It expires in ${Math.round(cfg.otp_ttl_seconds / 60)} minutes. Do not share this code.`;
    // Idempotency key ties the send to the challenge, preventing accidental duplicate sends.
    const result = await sendCallRailSms(config, phone, smsBody);
    await supabase.from("customer_verification_challenges").update({
      callrail_message_id: result.messageId ?? null,
      delivery_status: result.ok ? "sent" : "delivery_failed",
    }).eq("id", challenge.id);

    // Also record in sms_messages for the operator audit trail.
    await supabase.from("sms_messages").insert({
      to_number: phone,
      body: smsBody,
      message_kind: "verification",
      status: result.ok ? "sent" : "failed",
      sent_at: result.ok ? new Date().toISOString() : null,
      callrail_message_id: result.messageId ?? null,
      error: result.ok ? null : (result.error ?? "send failed"),
    });

    return respond();
  } catch (_err) {
    return new Response(JSON.stringify(GENERIC_OK), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});